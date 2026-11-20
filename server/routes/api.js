import express from 'express';
import fs from 'node:fs';
import multer from 'multer';
import { config } from '../config.js';
import { db, json, audit, getSettings, saveSettings } from '../db.js';
import { INDUSTRIES } from '../data/industries.js';
import * as contacts from '../services/contacts.js';
import * as campaigns from '../services/campaigns.js';
import * as replies from '../services/replies.js';
import { generateForCampaign } from '../services/generator.js';
import { generateCampaignAudio, synthesize, audioFilePath } from '../services/audio.js';
import { buildTemplate, renderScript, renderSms, lintScript, TONES, DURATIONS, OFFERS, CTAS, PERSONALIZATION, DEFAULT_OPTIONS } from '../services/scriptEngine.js';
import { checkContact, suppress, callingWindow } from '../services/compliance.js';
import { aiStatus } from '../providers/ai/index.js';
import { ttsCatalog, TTS_STYLES } from '../providers/tts/index.js';
import { deliveryCatalog, activeDelivery } from '../providers/delivery/index.js';
import * as ghl from '../providers/crm/ghl.js';
import { buildZip } from '../services/zip.js';
import * as prospecting from '../services/prospecting.js';
import { placesConfigured } from '../providers/leads/googlePlaces.js';

export const api = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const id = (req) => Number(req.params.id);

// ------------------------------------------------------------------ meta ----
api.get('/status', (req, res) => {
  const d = activeDelivery();
  res.json({
    ghl: { configured: ghl.ghlConfigured(), locationId: config.ghl.locationId ? config.ghl.locationId.slice(0, 4) + '…' : null },
    ai: aiStatus(),
    tts: ttsCatalog().map(({ voices, ...t }) => t),
    delivery: { active: d.name, label: d.label, ready: d.ready, canSend: d.canSend },
    publicBaseUrl: !!config.publicBaseUrl,
    webhookSecret: !!config.webhookSecret,
    auth: !!config.appPassword,
    settings: getSettings(),
  });
});

api.get('/options', (req, res) => res.json({
  industries: INDUSTRIES.map(({ key, label, painPoint, missedCall, competitorReason, revenueImpact, vocabulary, howWeSolve }) => ({ key, label, painPoint, missedCall, competitorReason, revenueImpact, vocabulary, howWeSolve })),
  tones: TONES, durations: DURATIONS, offers: OFFERS, ctas: CTAS, personalization: PERSONALIZATION, defaults: DEFAULT_OPTIONS,
  tts: ttsCatalog(), ttsStyles: TTS_STYLES, delivery: deliveryCatalog(),
}));

api.get('/dashboard', (req, res) => {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const totals = one(`SELECT
    (SELECT COUNT(*) FROM contacts) contacts,
    (SELECT COUNT(*) FROM campaigns) campaigns,
    (SELECT COUNT(*) FROM campaigns WHERE status IN ('running','scheduled')) active,
    (SELECT COUNT(*) FROM campaign_contacts WHERE script_status = 'approved') approved,
    (SELECT COUNT(*) FROM campaign_contacts WHERE delivery_status IN ('sent','delivered','handed_off')) sent,
    (SELECT COUNT(*) FROM campaign_contacts WHERE delivery_status = 'delivered') delivered,
    (SELECT COUNT(*) FROM campaign_contacts WHERE delivery_status = 'failed') failed,
    (SELECT COUNT(*) FROM replies WHERE direction = 'inbound') replies,
    (SELECT COUNT(*) FROM replies WHERE direction = 'inbound' AND category IN ('interested','demo','pricing')) hot,
    (SELECT COUNT(*) FROM replies WHERE status = 'new' AND direction = 'inbound') unread,
    (SELECT COALESCE(SUM(amount),0) FROM costs) spend,
    (SELECT COUNT(*) FROM audio_files) audio,
    (SELECT COALESCE(SUM(reused_count),0) FROM audio_files) audioReused`);
  res.json({
    totals,
    campaigns: campaigns.listCampaigns().slice(0, 6),
    recentReplies: replies.listReplies({}).filter((r) => r.direction === 'inbound').slice(0, 6),
    byIndustry: db.prepare(`SELECT cc.industry, COUNT(*) contacts, SUM(cc.delivery_status IN ('sent','delivered','handed_off')) sent,
      SUM(cc.reply_category IS NOT NULL) replied, SUM(cc.reply_category IN ('interested','demo','pricing')) positive
      FROM campaign_contacts cc GROUP BY cc.industry ORDER BY contacts DESC`).all(),
  });
});

// -------------------------------------------------------------- contacts ----
api.get('/contacts', (req, res) => res.json(contacts.queryContacts(req.query)));
api.get('/contacts/facets', (req, res) => res.json(contacts.facets()));
api.get('/contacts/:cid', (req, res) => {
  const c = contacts.getContact(req.params.cid);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const history = db.prepare(`SELECT cc.*, cp.name campaign_name FROM campaign_contacts cc JOIN campaigns cp ON cp.id = cc.campaign_id WHERE cc.contact_id = ? ORDER BY cc.id DESC`).all(c.id);
  res.json({ ...c, compliance: checkContact(c), window: callingWindow(c), history });
});
api.patch('/contacts/:cid', (req, res) => res.json(contacts.updateContactLocal(req.params.cid, req.body)));
api.post('/contacts/sync', ah(async (req, res) => res.json(await contacts.syncFromGhl(req.body || {}))));
api.post('/contacts/import', upload.single('file'), (req, res) => {
  const text = req.file ? req.file.buffer.toString('utf8') : req.body?.csv;
  if (!text) return res.status(400).json({ error: 'Upload a CSV file' });
  res.json(contacts.importCsv(text));
});
api.delete('/contacts/csv', (req, res) => {
  const n = db.prepare("DELETE FROM contacts WHERE source = 'csv' AND id NOT IN (SELECT contact_id FROM campaign_contacts)").run().changes;
  audit('contacts.delete_csv', 'csv', null, { deleted: n });
  res.json({ deleted: n });
});

// ------------------------------------------------------------ GHL meta ------
api.get('/ghl/test', ah(async (req, res) => res.json(await ghl.testConnection())));
api.get('/ghl/tags', ah(async (req, res) => res.json(await ghl.listTags())));
api.get('/ghl/custom-fields', ah(async (req, res) => res.json(await ghl.listCustomFields())));
api.get('/ghl/pipelines', ah(async (req, res) => res.json(await ghl.listPipelines())));

// ------------------------------------------------------------ prospecting ---
api.get('/prospects/meta', (req, res) => res.json({ configured: placesConfigured(), terms: prospecting.SEARCH_TERMS, usage: prospecting.monthUsage(), searches: prospecting.recentSearches() }));
api.post('/prospects/search', ah(async (req, res) => res.json(await prospecting.search(req.body || {}))));
api.get('/prospects', (req, res) => res.json(prospecting.listProspects(req.query)));
api.get('/prospects/:pid', (req, res) => { const p = prospecting.getProspect(req.params.pid); res.json({ ...p, script: prospecting.callScript(p) }); });
api.patch('/prospects/:pid', (req, res) => res.json(prospecting.setProspectFields(req.params.pid, req.body || {})));
api.post('/prospects/:pid/test-call', (req, res) => res.json(prospecting.logTestCall(req.params.pid, req.body?.result ?? null)));
api.post('/prospects/add-contacts', (req, res) => res.json(prospecting.addToContacts(req.body?.ids || [])));
api.post('/prospects/send-ghl', ah(async (req, res) => res.json(await prospecting.sendToGhl(req.body?.ids || [], { assignedTo: req.body?.assignedTo }))));
api.get('/ghl/users', ah(async (req, res) => res.json(await ghl.listUsers())));

// ------------------------------------------------------------ preview -------
api.post('/scripts/preview', (req, res) => {
  const { industry = 'other', options = {}, contactId } = req.body || {};
  const settings = getSettings();
  const o = { ...DEFAULT_OPTIONS, ...options };
  const sample = req.body?.sample || {};
  const contact = (contactId && contacts.getContact(contactId)) || { id: 'sample', first_name: sample.first_name || 'Mike', business_name: sample.business_name || 'your business', city: sample.city || '' };
  const script = renderScript(buildTemplate(industry, o, contact.id + (req.body.seed || '')), contact, settings, o);
  res.json({ script, sms: renderSms(industry, contact, settings, o), lint: lintScript(script, o, settings) });
});

// ------------------------------------------------------------ campaigns -----
api.get('/campaigns', (req, res) => res.json(campaigns.listCampaigns()));
api.post('/campaigns', (req, res) => res.status(201).json(campaigns.createCampaign(req.body || {})));
api.get('/campaigns/:id', (req, res) => res.json({ campaign: campaigns.getCampaign(id(req)), rows: campaigns.campaignRows(id(req)) }));
api.patch('/campaigns/:id', (req, res) => res.json(campaigns.updateCampaign(id(req), req.body || {})));
api.delete('/campaigns/:id', (req, res) => { campaigns.deleteCampaign(id(req)); res.json({ ok: true }); });
api.post('/campaigns/:id/contacts', (req, res) => res.json(campaigns.addContacts(id(req), req.body.contactIds || [])));
api.post('/campaigns/:id/contacts/remove', (req, res) => res.json(campaigns.removeContacts(id(req), req.body.ids || [])));
api.post('/campaigns/:id/generate', ah(async (req, res) => res.json(await generateForCampaign(id(req), req.body || {}))));
api.post('/campaigns/:id/compliance', (req, res) => res.json(campaigns.recheckCompliance(id(req))));
api.patch('/campaigns/:id/rows/:ccId', (req, res) => res.json(campaigns.editScript(id(req), Number(req.params.ccId), req.body || {})));
api.post('/campaigns/:id/rows/:ccId/industry', ah(async (req, res) => {
  db.prepare('UPDATE campaign_contacts SET industry = ? WHERE id = ? AND campaign_id = ?').run(req.body.industry, Number(req.params.ccId), id(req));
  res.json(await generateForCampaign(id(req), { ids: [Number(req.params.ccId)], force: true }));
}));
api.post('/campaigns/:id/approve', (req, res) => res.json(campaigns.setScriptStatus(id(req), req.body.ids || [], req.body.status || 'approved')));
api.post('/campaigns/:id/audio', ah(async (req, res) => res.json(await generateCampaignAudio(id(req), req.body || {}))));
api.get('/campaigns/:id/estimate', (req, res) => res.json(campaigns.estimate(id(req))));
api.get('/campaigns/:id/review', (req, res) => res.json(campaigns.reviewChecklist(id(req))));
api.post('/campaigns/:id/launch', (req, res) => res.json(campaigns.launch(id(req), req.body || {})));
for (const action of ['pause', 'resume', 'stop']) {
  api.post(`/campaigns/:id/${action}`, (req, res) => res.json(campaigns.setRunState(id(req), action)));
}
api.post('/campaigns/:id/retry', (req, res) => res.json(campaigns.retryFailed(id(req), req.body?.ids)));
api.post('/campaigns/:id/rows/:ccId/send', ah(async (req, res) => res.json(await campaigns.sendOne(id(req), Number(req.params.ccId), req.body || {}))));
api.get('/campaigns/:id/rows/:ccId/history', (req, res) => res.json(campaigns.deliveryHistory(Number(req.params.ccId))));
api.get('/campaigns/:id/download', (req, res) => {
  const c = campaigns.getCampaign(id(req));
  const rows = db.prepare(`SELECT cc.id, k.first_name, k.last_name, k.business_name, k.phone, a.file, cc.script FROM campaign_contacts cc
    JOIN contacts k ON k.id = cc.contact_id JOIN audio_files a ON a.id = cc.audio_id WHERE cc.campaign_id = ? AND cc.script_status = 'approved'`).all(c.id);
  if (!rows.length) return res.status(404).json({ error: 'No approved audio to download yet' });
  const safe = (s) => String(s || '').replace(/[^\w.-]+/g, '_').slice(0, 40);
  const files = []; const csv = ['file,first_name,last_name,business_name,phone,script'];
  for (const r of rows) {
    const name = `${safe(r.business_name || r.first_name)}_${safe(r.phone)}_${r.id}.mp3`;
    files.push({ name, data: fs.readFileSync(audioFilePath(r)) });
    csv.push([name, r.first_name, r.last_name, r.business_name, r.phone, r.script].map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(','));
  }
  files.push({ name: 'manifest.csv', data: Buffer.from(csv.join('\n')) });
  audit('audio.download', 'campaign', c.id, { files: rows.length });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safe(c.name)}_voicedrops.zip"`);
  res.send(buildZip(files));
});

// ------------------------------------------------------------ voices --------
api.get('/voices', (req, res) => res.json({
  providers: ttsCatalog(), styles: TTS_STYLES,
  library: db.prepare('SELECT id, hash, provider, model, voice, speed, style, substr(script,1,140) script, characters, duration_sec, cost, reused_count, created_at FROM audio_files ORDER BY id DESC LIMIT 200').all(),
}));
api.post('/voices/preview', ah(async (req, res) => {
  const { text, voice = {} } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Text is required' });
  if (text.length > 1200) return res.status(400).json({ error: 'Preview text is limited to 1,200 characters' });
  const a = await synthesize(text.trim(), voice, { note: 'voice preview' });
  res.json({ url: `/media/${a.hash}.mp3`, cached: a.cached, cost: a.cached ? 0 : a.cost, duration: a.duration_sec });
}));

// ------------------------------------------------------------ replies -------
api.get('/replies', (req, res) => res.json(replies.listReplies(req.query)));
api.post('/replies', ah(async (req, res) => res.status(201).json(await replies.ingestReply({ ...req.body, source: 'manual' }))));
api.post('/replies/pull', ah(async (req, res) => res.json(await replies.pullFromGhl())));
api.post('/replies/:id/rewrite', ah(async (req, res) => res.json(await replies.aiRewriteSuggestion(id(req), req.body?.instruction))));
api.post('/replies/:id/send', ah(async (req, res) => res.json(await replies.sendReply(id(req), req.body?.text || ''))));
api.patch('/replies/:id', (req, res) => res.json(replies.setReplyStatus(id(req), req.body?.status, req.body?.category)));

// ------------------------------------------------------------ costs ---------
api.get('/costs', (req, res) => {
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const sent = db.prepare("SELECT COUNT(*) n FROM campaign_contacts WHERE delivery_status IN ('sent','delivered','handed_off')").get().n;
  const total = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM costs').get().t;
  const saved = db.prepare('SELECT COALESCE(SUM(reused_count * cost),0) s FROM audio_files').get().s;
  res.json({
    total, sent, perDelivery: sent ? total / sent : null, audioSavings: saved,
    byCategory: q('SELECT category, COALESCE(SUM(amount),0) amount, COUNT(*) events FROM costs GROUP BY category'),
    byProvider: q('SELECT category, provider, COALESCE(SUM(amount),0) amount, COALESCE(SUM(units),0) units, unit FROM costs GROUP BY category, provider ORDER BY amount DESC'),
    byCampaign: q(`SELECT c.id, c.name, c.status, COALESCE(SUM(k.amount),0) amount,
      (SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = c.id AND delivery_status IN ('sent','delivered','handed_off')) sent
      FROM campaigns c LEFT JOIN costs k ON k.campaign_id = c.id GROUP BY c.id ORDER BY c.id DESC`),
    daily: q("SELECT date(created_at) day, category, SUM(amount) amount FROM costs WHERE created_at >= date('now','-30 days') GROUP BY day, category ORDER BY day"),
    recent: q('SELECT * FROM costs ORDER BY id DESC LIMIT 50'),
  });
});

// ------------------------------------------------------- settings / compliance
api.get('/settings', (req, res) => res.json(getSettings()));
api.patch('/settings', (req, res) => {
  const before = getSettings();
  const after = saveSettings(req.body || {});
  const changed = Object.keys(req.body || {}).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.length) audit('settings.update', 'settings', null, Object.fromEntries(changed.map((k) => [k, after[k]])));
  res.json(after);
});
api.post('/settings/global-stop', (req, res) => {
  const on = !!req.body?.on;
  saveSettings({ globalStop: on });
  if (on) db.prepare("UPDATE campaigns SET status = 'paused' WHERE status IN ('running','scheduled')").run();
  audit(on ? 'global_stop.on' : 'global_stop.off', 'settings');
  res.json(getSettings());
});
api.get('/suppression', (req, res) => res.json(db.prepare('SELECT * FROM suppression ORDER BY created_at DESC').all()));
api.post('/suppression', (req, res) => {
  const phones = String(req.body?.phones || '').split(/[\s,;]+/).map(contacts.normalizePhone).filter(Boolean);
  for (const p of phones) suppress(p, req.body?.reason || 'Manual', 'user');
  audit('suppression.add', 'suppression', null, { count: phones.length });
  res.json({ added: phones.length });
});
api.delete('/suppression/:phone', (req, res) => {
  db.prepare('DELETE FROM suppression WHERE phone = ?').run(req.params.phone);
  audit('suppression.remove', 'suppression', req.params.phone);
  res.json({ ok: true });
});
api.get('/audit', (req, res) => res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(Number(req.query.limit) || 200, 1000))
  .map((r) => ({ ...r, detail: json(r.detail, r.detail) }))));
