import { config } from '../config.js';
import { db, json, audit, recordCost, getSettings, tx } from '../db.js';
import { DEFAULT_OPTIONS, lintScript, estimateSeconds } from './scriptEngine.js';
import { checkContact, withinCallingWindow } from './compliance.js';
import { getContact } from './contacts.js';
import { activeAI } from '../providers/ai/index.js';
import { getTTS } from '../providers/tts/index.js';
import { activeDelivery } from '../providers/delivery/index.js';
import { aiCost, ttsCost } from './pricing.js';
import { audioUrl } from './audio.js';
import * as ghl from '../providers/crm/ghl.js';

const err = (status, message) => Object.assign(new Error(message), { status });

export function getCampaign(id) {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!c) throw err(404, 'Campaign not found');
  return { ...c, options: { ...DEFAULT_OPTIONS, ...json(c.options, {}) } };
}

export function createCampaign({ name, options = {}, contactIds = [] }) {
  if (!name?.trim()) throw err(400, 'Campaign name is required');
  const info = db.prepare('INSERT INTO campaigns (name, options) VALUES (?, ?)').run(name.trim(), JSON.stringify({ ...DEFAULT_OPTIONS, ...options }));
  const id = Number(info.lastInsertRowid);
  addContacts(id, contactIds);
  audit('campaign.create', 'campaign', id, { name, contacts: contactIds.length });
  return getCampaign(id);
}

export function updateCampaign(id, { name, options }) {
  const c = getCampaign(id);
  if (['running', 'completed'].includes(c.status)) throw err(409, 'Running or completed campaigns cannot be edited');
  const merged = { ...c.options, ...(options || {}) };
  if (options?.voice) merged.voice = { ...c.options.voice, ...options.voice };
  db.prepare("UPDATE campaigns SET name = ?, options = ?, updated_at = datetime('now') WHERE id = ?").run(name?.trim() || c.name, JSON.stringify(merged), id);
  return getCampaign(id);
}

export function deleteCampaign(id) {
  const c = getCampaign(id);
  if (c.status === 'running') throw err(409, 'Stop the campaign before deleting it');
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  audit('campaign.delete', 'campaign', id, { name: c.name });
}

export function addContacts(campaignId, contactIds) {
  const stmt = db.prepare('INSERT OR IGNORE INTO campaign_contacts (campaign_id, contact_id, industry) SELECT ?, id, industry FROM contacts WHERE id = ?');
  let added = 0;
  tx(() => { for (const id of contactIds) added += Number(stmt.run(campaignId, id).changes); });
  return { added };
}

export function removeContacts(campaignId, ccIds) {
  const stmt = db.prepare("DELETE FROM campaign_contacts WHERE id = ? AND campaign_id = ? AND delivery_status IN ('not_sent','skipped','failed','manual')");
  let removed = 0;
  tx(() => { for (const id of ccIds) removed += Number(stmt.run(id, campaignId).changes); });
  return { removed };
}

export function listCampaigns() {
  return db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id) contacts,
      (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND script_status = 'approved') approved,
      (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND audio_id IS NOT NULL) audio,
      (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND delivery_status IN ('sent','delivered','handed_off')) sent,
      (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND delivery_status = 'delivered') delivered,
      (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND delivery_status = 'failed') failed,
      (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND delivery_status = 'queued') queued,
      (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND compliance_status = 'blocked') blocked,
      (SELECT COUNT(DISTINCT r.campaign_contact_id) FROM replies r JOIN campaign_contacts cc ON cc.id = r.campaign_contact_id WHERE cc.campaign_id = c.id) replies,
      (SELECT COALESCE(SUM(amount),0) FROM costs WHERE campaign_id = c.id) cost,
      (SELECT GROUP_CONCAT(DISTINCT industry) FROM campaign_contacts WHERE campaign_id = c.id) industries
    FROM campaigns c ORDER BY c.created_at DESC, c.id DESC`).all()
    .map((c) => ({ ...c, options: json(c.options, {}), costPerDelivery: c.sent ? c.cost / c.sent : null }));
}

export function campaignRows(campaignId) {
  const c = getCampaign(campaignId);
  const settings = getSettings();
  return db.prepare(`
    SELECT cc.*, k.first_name, k.last_name, k.business_name, k.phone, k.city, k.state, k.source, k.line_type, k.consent_voice, k.consent_sms,
      a.hash audio_hash, a.duration_sec audio_duration, a.voice audio_voice, a.cost audio_cost,
      (SELECT COUNT(*) FROM replies r WHERE r.campaign_contact_id = cc.id) reply_count
    FROM campaign_contacts cc JOIN contacts k ON k.id = cc.contact_id LEFT JOIN audio_files a ON a.id = cc.audio_id
    WHERE cc.campaign_id = ? ORDER BY k.business_name COLLATE NOCASE, k.first_name`).all(campaignId)
    .map((r) => ({
      ...r,
      compliance_notes: json(r.compliance_notes, []),
      audio_url: r.audio_hash ? `/media/${r.audio_hash}.mp3` : null,
      audio_stale: !!r.audio_id && r.script_status !== 'approved',
      lint: r.script ? lintScript(r.script, c.options, settings) : null,
    }));
}

export function editScript(campaignId, ccId, { script, sms_text }) {
  const cc = db.prepare('SELECT * FROM campaign_contacts WHERE id = ? AND campaign_id = ?').get(ccId, campaignId);
  if (!cc) throw err(404, 'Not found');
  if (!['not_sent', 'failed', 'skipped', 'manual'].includes(cc.delivery_status)) throw err(409, 'Already sent; scripts are locked');
  if (script !== undefined && script.trim() !== (cc.script || '').trim()) {
    // Any change invalidates approval and detaches the old audio (it stays cached).
    db.prepare("UPDATE campaign_contacts SET script = ?, script_source = 'edited', script_status = 'draft', audio_id = NULL WHERE id = ?").run(script.trim(), ccId);
  }
  if (sms_text !== undefined) db.prepare('UPDATE campaign_contacts SET sms_text = ? WHERE id = ?').run(sms_text.trim(), ccId);
  return db.prepare('SELECT * FROM campaign_contacts WHERE id = ?').get(ccId);
}

export function setScriptStatus(campaignId, ccIds, status) {
  if (!['approved', 'draft', 'rejected'].includes(status)) throw err(400, 'Bad status');
  const settings = getSettings();
  let changed = 0; const refused = [];
  tx(() => {
    for (const id of ccIds) {
      const cc = db.prepare('SELECT * FROM campaign_contacts WHERE id = ? AND campaign_id = ?').get(id, campaignId);
      if (!cc?.script) continue;
      if (status === 'approved') {
        const contact = getContact(cc.contact_id);
        const comp = checkContact(contact, { channel: 'voice', campaignId, settings });
        db.prepare('UPDATE campaign_contacts SET compliance_status = ?, compliance_notes = ? WHERE id = ?').run(comp.status, JSON.stringify(comp.notes), id);
        if (comp.status === 'blocked') { refused.push(id); continue; }
        if (/\{[a-z_]+\}/.test(cc.script)) { refused.push(id); continue; }
      }
      changed += Number(db.prepare('UPDATE campaign_contacts SET script_status = ? WHERE id = ?').run(status, id).changes);
    }
  });
  audit(`scripts.${status}`, 'campaign', campaignId, { count: changed, refused: refused.length });
  return { changed, refused };
}

export function recheckCompliance(campaignId) {
  const settings = getSettings();
  const rows = db.prepare('SELECT id, contact_id FROM campaign_contacts WHERE campaign_id = ?').all(campaignId);
  const out = { ok: 0, warn: 0, blocked: 0 };
  tx(() => {
    for (const r of rows) {
      const comp = checkContact(getContact(r.contact_id), { channel: 'voice', campaignId, settings });
      db.prepare('UPDATE campaign_contacts SET compliance_status = ?, compliance_notes = ? WHERE id = ?').run(comp.status, JSON.stringify(comp.notes), r.id);
      out[comp.status]++;
    }
  });
  return out;
}

// ---------------------------------------------------------------- estimator --
export function estimate(campaignId) {
  const c = getCampaign(campaignId);
  const rows = campaignRows(campaignId);
  const o = c.options;
  const eligible = rows.filter((r) => r.compliance_status !== 'blocked');
  const ai = activeAI();
  const tts = getTTS(o.voice?.provider || 'auto');
  const delivery = activeDelivery();

  // AI: one base call per industry needing generation; + per contact for business-level
  const needScripts = eligible.filter((r) => !r.script);
  const industries = new Set(needScripts.map((r) => r.industry || 'other'));
  const cachedBases = 0;
  let aiEst = 0;
  if (o.useAI && ai) {
    const model = ai.model();
    aiEst += (industries.size - cachedBases) * aiCost(model, 1100, 700);
    if (o.personalization === 'business') aiEst += needScripts.length * aiCost(model, 650, 180);
  }

  // TTS: characters for eligible scripts that don't already have current audio
  const avgChars = Math.round((Number(o.duration) || 30) * 2.8 * 5.6);
  let chars = 0;
  for (const r of eligible) if (!r.audio_id) chars += r.script ? r.script.length : avgChars;
  const ttsProvider = tts ? tts.name : 'openai';
  const ttsModel = tts ? tts.model() : config.tts.openaiModel;
  const ttsEst = ttsCost(ttsProvider, ttsModel, chars);

  const toSend = eligible.filter((r) => ['not_sent', 'failed', 'queued', 'manual'].includes(r.delivery_status)).length;
  const deliveryEst = delivery.canSend ? toSend * config.delivery.costPerDrop : 0;
  const smsSegments = o.sendSms ? eligible.filter((r) => r.consent_sms && r.source === 'ghl').reduce((s, r) => s + Math.max(1, Math.ceil((r.sms_text || '').length / 153)), 0) : 0;
  const smsEst = smsSegments * config.sms.costPerSegment;

  const actual = db.prepare('SELECT category, COALESCE(SUM(amount),0) amount FROM costs WHERE campaign_id = ? GROUP BY category').all(campaignId);
  const act = Object.fromEntries(actual.map((a) => [a.category, a.amount]));
  const sent = rows.filter((r) => ['sent', 'delivered', 'handed_off'].includes(r.delivery_status)).length;
  const actualTotal = Object.values(act).reduce((s, v) => s + v, 0);
  return {
    contacts: rows.length, eligible: eligible.length, blocked: rows.length - eligible.length, toSend,
    estimated: { ai: aiEst, tts: ttsEst, delivery: deliveryEst, sms: smsEst, total: aiEst + ttsEst + deliveryEst + smsEst },
    actual: { ai: act.ai || 0, tts: act.tts || 0, delivery: act.delivery || 0, sms: act.sms || 0, total: actualTotal },
    costPerDelivery: sent ? actualTotal / sent : null,
    assumptions: {
      ai: o.useAI ? (ai ? `${ai.name} ${ai.model()} · ${industries.size} base call(s)${o.personalization === 'business' ? ` + ${needScripts.length} personalization call(s)` : ''}` : 'AI selected but not configured → free templates') : 'Free template engine',
      tts: `${ttsProvider}:${ttsModel} · ${chars.toLocaleString()} chars not yet generated (cached audio is free)`,
      delivery: delivery.canSend ? `${delivery.label} · $${config.delivery.costPerDrop}/drop (set VOICEDROP_COST_PER_DROP)` : 'Manual download (no delivery cost)',
      sms: o.sendSms ? `${smsSegments} segment(s) × $${config.sms.costPerSegment} (GHL contacts with SMS consent)` : 'Follow-up SMS off',
      avgSeconds: eligible.length ? Math.round(eligible.reduce((s, r) => s + (r.script ? estimateSeconds(r.script) : o.duration), 0) / eligible.length) : 0,
    },
  };
}

// ------------------------------------------------------------------- launch --
export function reviewChecklist(campaignId) {
  const c = getCampaign(campaignId);
  const rows = campaignRows(campaignId);
  const settings = getSettings();
  const delivery = activeDelivery();
  const eligible = rows.filter((r) => r.compliance_status !== 'blocked');
  const ready = eligible.filter((r) => r.script_status === 'approved' && r.audio_id);
  const checks = [
    { key: 'legal', ok: !!settings.legalReviewAcknowledged, label: 'Legal review acknowledged in Settings → Compliance' },
    { key: 'stop', ok: !settings.globalStop, label: 'Global stop is off' },
    { key: 'delivery', ok: delivery.canSend && delivery.ready, label: delivery.canSend ? (delivery.ready ? `Delivery provider: ${delivery.label}` : `${delivery.label} needs credentials and PUBLIC_BASE_URL`) : 'No delivery provider configured (manual download mode)' },
    { key: 'ready', ok: ready.length > 0, label: `${ready.length} of ${eligible.length} eligible contacts have approved script + audio` },
    { key: 'pending', ok: ready.length === eligible.length, warnOnly: true, label: eligible.length - ready.length ? `${eligible.length - ready.length} eligible contacts are not approved/voiced and will be skipped` : 'Every eligible contact is approved and voiced' },
    { key: 'blocked', ok: true, warnOnly: true, label: `${rows.length - eligible.length} contacts blocked by compliance will be skipped` },
    { key: 'callback', ok: !!settings.callbackNumber, warnOnly: true, label: settings.callbackNumber ? 'Callback number set for sender identification' : 'No callback number set (recommended for sender identification)' },
  ];
  return { campaign: c, checks, canLaunch: checks.every((x) => x.ok || x.warnOnly), readyCount: ready.length };
}

export function launch(campaignId, { confirmName, scheduledAt = null, approver = 'owner' }) {
  const review = reviewChecklist(campaignId);
  const c = review.campaign;
  if (!review.canLaunch) throw err(409, 'Launch checklist is not complete: ' + review.checks.filter((x) => !x.ok && !x.warnOnly).map((x) => x.label).join('; '));
  if ((confirmName || '').trim() !== c.name) throw err(400, 'Type the exact campaign name to confirm launch');
  if (['running', 'completed'].includes(c.status)) throw err(409, `Campaign is already ${c.status}`);
  const when = scheduledAt ? new Date(scheduledAt) : null;
  if (when && isNaN(when)) throw err(400, 'Invalid schedule time');
  tx(() => {
    db.prepare(`UPDATE campaign_contacts SET delivery_status = 'queued' WHERE campaign_id = ? AND script_status = 'approved' AND audio_id IS NOT NULL
      AND compliance_status != 'blocked' AND delivery_status IN ('not_sent','manual')`).run(campaignId);
    db.prepare(`UPDATE campaign_contacts SET delivery_status = 'skipped', delivery_error = 'Not approved, not voiced, or blocked at launch'
      WHERE campaign_id = ? AND delivery_status = 'not_sent'`).run(campaignId);
    db.prepare(`UPDATE campaigns SET status = ?, scheduled_at = ?, launched_at = datetime('now'), approved_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(when && when > new Date() ? 'scheduled' : 'running', when ? when.toISOString() : null, approver, campaignId);
  });
  audit('campaign.launch', 'campaign', campaignId, { approver, scheduledAt: when?.toISOString() || 'now', queued: review.readyCount });
  return getCampaign(campaignId);
}

export function setRunState(campaignId, action) {
  const c = getCampaign(campaignId);
  const map = { pause: ['running', 'scheduled'], resume: ['paused'], stop: ['running', 'paused', 'scheduled'] };
  if (!map[action]?.includes(c.status)) throw err(409, `Cannot ${action} a ${c.status} campaign`);
  const next = action === 'pause' ? 'paused' : action === 'resume' ? (c.scheduled_at && new Date(c.scheduled_at) > new Date() ? 'scheduled' : 'running') : 'stopped';
  db.prepare("UPDATE campaigns SET status = ?, updated_at = datetime('now') WHERE id = ?").run(next, campaignId);
  if (action === 'stop') db.prepare("UPDATE campaign_contacts SET delivery_status = 'skipped', delivery_error = 'Campaign stopped' WHERE campaign_id = ? AND delivery_status = 'queued'").run(campaignId);
  audit(`campaign.${action}`, 'campaign', campaignId);
  return getCampaign(campaignId);
}

export function retryFailed(campaignId, ccIds = null) {
  const c = getCampaign(campaignId);
  if (!['running', 'paused', 'completed'].includes(c.status)) throw err(409, 'Only launched campaigns can retry deliveries');
  const rows = db.prepare("SELECT id FROM campaign_contacts WHERE campaign_id = ? AND delivery_status = 'failed' AND delivery_attempts < 3").all(campaignId)
    .filter((r) => !ccIds || ccIds.includes(r.id));
  for (const r of rows) db.prepare("UPDATE campaign_contacts SET delivery_status = 'queued', delivery_error = NULL WHERE id = ?").run(r.id);
  if (rows.length && c.status === 'completed') db.prepare("UPDATE campaigns SET status = 'running', completed_at = NULL WHERE id = ?").run(campaignId);
  audit('campaign.retry', 'campaign', campaignId, { count: rows.length });
  return { requeued: rows.length };
}

// Single-contact send from an approved, launched (or launch-ready) campaign.
export async function sendOne(campaignId, ccId, { confirm }) {
  if (!confirm) throw err(400, 'Explicit confirmation is required');
  const review = reviewChecklist(campaignId);
  const blocking = review.checks.filter((x) => !x.ok && !x.warnOnly && x.key !== 'ready');
  if (blocking.length) throw err(409, blocking.map((x) => x.label).join('; '));
  const cc = db.prepare('SELECT * FROM campaign_contacts WHERE id = ? AND campaign_id = ?').get(ccId, campaignId);
  if (!cc) throw err(404, 'Not found');
  if (cc.script_status !== 'approved' || !cc.audio_id) throw err(409, 'Approve the script and generate audio first');
  if (['sent', 'delivered', 'handed_off', 'sending'].includes(cc.delivery_status)) throw err(409, 'Already sent');
  db.prepare("UPDATE campaign_contacts SET delivery_status = 'queued' WHERE id = ?").run(ccId);
  audit('delivery.send_one', 'campaign_contact', ccId, { campaignId });
  return processOne(getCampaign(campaignId), db.prepare('SELECT * FROM campaign_contacts WHERE id = ?').get(ccId));
}

// ------------------------------------------------------------------- worker --
function callbackUrl(provider) {
  return config.publicBaseUrl ? `${config.publicBaseUrl}/webhooks/voicedrop/${provider}?token=${encodeURIComponent(config.webhookSecret)}` : null;
}

async function processOne(campaign, cc, now = new Date()) {
  const settings = getSettings();
  const contact = getContact(cc.contact_id);
  const comp = checkContact(contact, { channel: 'voice', campaignId: campaign.id, settings });
  if (comp.status === 'blocked') {
    db.prepare("UPDATE campaign_contacts SET delivery_status = 'skipped', compliance_status = 'blocked', compliance_notes = ?, delivery_error = ? WHERE id = ?")
      .run(JSON.stringify(comp.notes), comp.notes.filter((n) => n.level === 'block').map((n) => n.msg).join('; '), cc.id);
    audit('delivery.blocked', 'campaign_contact', cc.id, comp.notes, 'system');
    return { status: 'skipped', reason: 'compliance' };
  }
  const win = withinCallingWindow(contact, now, settings);
  if (!win.ok) return { status: 'deferred', reason: `Outside calling window (${win.start}–${win.end} ${win.tz})` };

  const delivery = activeDelivery();
  if (!delivery.canSend || !delivery.ready) return { status: 'deferred', reason: 'Delivery provider not ready' };
  const audio = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(cc.audio_id);
  db.prepare("UPDATE campaign_contacts SET delivery_status = 'sending', delivery_attempts = delivery_attempts + 1 WHERE id = ?").run(cc.id);
  try {
    const res = await delivery.send({
      to: contact.phone, audioUrl: audioUrl(audio, true), callerId: settings.callbackNumber, contact,
      campaignContactId: cc.id, callbackUrl: callbackUrl(delivery.name), campaign,
    });
    db.prepare(`UPDATE campaign_contacts SET delivery_status = ?, provider = ?, provider_message_id = ?, sent_at = datetime('now'), delivery_error = NULL,
      delivered_at = CASE WHEN ? = 'delivered' THEN datetime('now') ELSE delivered_at END WHERE id = ?`)
      .run(res.status, delivery.name, res.providerMessageId, res.status, cc.id);
    db.prepare('INSERT INTO deliveries (campaign_contact_id, kind, provider, provider_message_id, status, detail) VALUES (?,?,?,?,?,?)')
      .run(cc.id, 'voicedrop', delivery.name, res.providerMessageId, res.status, 'accepted by provider');
    recordCost({ campaignId: campaign.id, category: 'delivery', provider: delivery.name, units: 1, unit: 'drop', amount: config.delivery.costPerDrop });
    // Settle follow-up SMS eligibility now so the campaign doesn't wait on SMS that can never send.
    const smsSkip = !campaign.options.sendSms ? 'disabled' : contact.source !== 'ghl' ? 'not a GHL contact' : !contact.consent_sms ? 'no SMS consent' : null;
    if (smsSkip) db.prepare("UPDATE campaign_contacts SET sms_status = ? WHERE id = ? AND sms_status = 'not_sent'").run(`skipped: ${smsSkip}`, cc.id);
    await workflowTag(contact, 'delivered', settings);
    return { status: res.status };
  } catch (e) {
    db.prepare("UPDATE campaign_contacts SET delivery_status = 'failed', delivery_error = ? WHERE id = ?").run(e.message.slice(0, 500), cc.id);
    db.prepare('INSERT INTO deliveries (campaign_contact_id, kind, provider, status, detail) VALUES (?,?,?,?,?)').run(cc.id, 'voicedrop', delivery.name, 'failed', e.message.slice(0, 500));
    return { status: 'failed', error: e.message };
  }
}

export async function workflowTag(contact, event, settings = getSettings()) {
  if (!settings.writeBackTags || contact.source !== 'ghl' || !ghl.ghlConfigured()) return;
  const tag = `${settings.tagPrefix || 'voicedrop'}-${event}`;
  try { await ghl.addTags(contact.external_id, [tag]); audit('ghl.tag', 'contact', contact.id, { tag }, 'system'); }
  catch (e) { audit('ghl.tag_failed', 'contact', contact.id, { tag, error: e.message }, 'system'); }
}

async function sendFollowupSms(campaign, cc, now = new Date()) {
  const settings = getSettings();
  const contact = getContact(cc.contact_id);
  const claim = db.prepare("UPDATE campaign_contacts SET sms_status = 'sending' WHERE id = ? AND sms_status = 'not_sent'").run(cc.id);
  if (!claim.changes) return; // another tick already took it (prevents duplicate follow-ups)
  const skip = (why) => db.prepare('UPDATE campaign_contacts SET sms_status = ? WHERE id = ?').run(`skipped: ${why}`, cc.id);
  if (contact.source !== 'ghl' || !ghl.ghlConfigured()) return skip('not a GHL contact');
  const comp = checkContact(contact, { channel: 'sms', campaignId: -1, settings });
  const blocking = comp.notes.filter((n) => n.level === 'block' && n.code !== 'duplicate');
  if (blocking.length) return skip(blocking[0].msg);
  if (!withinCallingWindow(contact, now, settings).ok) {
    db.prepare("UPDATE campaign_contacts SET sms_status = 'not_sent' WHERE id = ?").run(cc.id);
    return;
  }
  try {
    const r = await ghl.sendSms(contact.external_id, cc.sms_text);
    db.prepare("UPDATE campaign_contacts SET sms_status = 'sent', sms_message_id = ?, sms_sent_at = datetime('now') WHERE id = ?").run(r.messageId || null, cc.id);
    db.prepare('INSERT INTO deliveries (campaign_contact_id, kind, provider, provider_message_id, status) VALUES (?,?,?,?,?)').run(cc.id, 'sms', 'ghl', r.messageId || null, 'sent');
    recordCost({ campaignId: campaign.id, category: 'sms', provider: 'ghl', units: Math.ceil(cc.sms_text.length / 153), unit: 'segments', amount: Math.ceil(cc.sms_text.length / 153) * config.sms.costPerSegment });
    await workflowTag(contact, 'sms-sent', settings);
  } catch (e) {
    db.prepare('UPDATE campaign_contacts SET sms_status = ? WHERE id = ?').run(`failed: ${e.message.slice(0, 200)}`, cc.id);
  }
}

let ticking = false;
export async function tick(now = new Date()) {
  if (ticking) return; ticking = true;
  try {
    const settings = getSettings();
    if (settings.globalStop) return;
    db.prepare("UPDATE campaigns SET status = 'running' WHERE status = 'scheduled' AND scheduled_at <= ?").run(now.toISOString());
    const perTick = Math.max(1, Math.round(config.delivery.ratePerMinute / 4)); // tick every 15 s
    for (const campaign of db.prepare("SELECT * FROM campaigns WHERE status = 'running'").all()) {
      const c = getCampaign(campaign.id);
      const queued = db.prepare("SELECT * FROM campaign_contacts WHERE campaign_id = ? AND delivery_status = 'queued' ORDER BY id LIMIT ?").all(c.id, perTick * 5);
      let sent = 0;
      for (const cc of queued) {
        if (sent >= perTick) break;
        const r = await processOne(c, cc, now);
        if (r.status !== 'deferred') sent++;
      }
      if (c.options.sendSms) {
        const due = db.prepare(`SELECT * FROM campaign_contacts WHERE campaign_id = ? AND sms_status = 'not_sent' AND sms_text IS NOT NULL
          AND delivery_status IN ('sent','delivered','handed_off') AND sent_at <= datetime('now', ?) LIMIT 10`).all(c.id, `-${Number(settings.smsFollowupDelayMin) || 0} minutes`);
        for (const cc of due) await sendFollowupSms(c, cc, now);
      }
      const left = db.prepare("SELECT COUNT(*) n FROM campaign_contacts WHERE campaign_id = ? AND delivery_status IN ('queued','sending')").get(c.id).n;
      const smsLeft = c.options.sendSms ? db.prepare("SELECT COUNT(*) n FROM campaign_contacts WHERE campaign_id = ? AND sms_status = 'not_sent' AND delivery_status IN ('sent','delivered','handed_off')").get(c.id).n : 0;
      if (!left && !smsLeft) {
        db.prepare("UPDATE campaigns SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(c.id);
        audit('campaign.completed', 'campaign', c.id, null, 'system');
      }
    }
  } finally { ticking = false; }
}

export function handleDeliveryCallback(providerName, events) {
  let updated = 0;
  for (const ev of events) {
    let cc = ev.providerMessageId ? db.prepare('SELECT * FROM campaign_contacts WHERE provider_message_id = ?').get(ev.providerMessageId) : null;
    if (!cc && ev.externalId?.startsWith('cc_')) cc = db.prepare('SELECT * FROM campaign_contacts WHERE id = ?').get(Number(ev.externalId.slice(3)));
    if (!cc) continue;
    db.prepare(`UPDATE campaign_contacts SET delivery_status = ?, delivery_error = CASE WHEN ? = 'failed' THEN ? ELSE NULL END,
      delivered_at = CASE WHEN ? = 'delivered' THEN datetime('now') ELSE delivered_at END WHERE id = ?`)
      .run(ev.status, ev.status, ev.detail || 'failed', ev.status, cc.id);
    db.prepare('INSERT INTO deliveries (campaign_contact_id, kind, provider, provider_message_id, status, detail) VALUES (?,?,?,?,?,?)')
      .run(cc.id, 'voicedrop', providerName, ev.providerMessageId || null, ev.status, ev.detail || null);
    updated++;
  }
  audit('delivery.callback', 'provider', providerName, { events: events.length, updated }, 'provider');
  return { updated };
}

export function deliveryHistory(ccId) {
  return db.prepare('SELECT * FROM deliveries WHERE campaign_contact_id = ? ORDER BY id DESC').all(ccId);
}

export function startWorker() {
  const t = setInterval(() => tick().catch((e) => console.error('[worker]', e.message)), 15_000);
  t.unref();
  return t;
}
