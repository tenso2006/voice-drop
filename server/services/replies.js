// Reply assistant: classify inbound replies (free rules first, cheap AI only
// when ambiguous), score the lead, and draft an industry-aware suggested reply.
// Replies are never sent automatically.
import { db, audit, recordCost, getSettings } from '../db.js';
import { INDUSTRY_MAP } from '../data/industries.js';
import { activeAI, extractJson } from '../providers/ai/index.js';
import { suppress } from './compliance.js';
import { getContact } from './contacts.js';
import { workflowTag } from './campaigns.js';
import * as ghl from '../providers/crm/ghl.js';
import { config } from '../config.js';

export const CATEGORIES = {
  interested: { label: 'Interested', score: 80 },
  pricing: { label: 'Wants pricing', score: 70 },
  demo: { label: 'Wants a demo', score: 95 },
  not_interested: { label: 'Not interested', score: 5 },
  already_has: { label: 'Already has a solution', score: 25 },
  later: { label: 'Contact later', score: 40 },
  opt_out: { label: 'Opt-out', score: 0 },
};

const RULES = [
  ['opt_out', /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out|remove me)\s*[.!]*\s*$|\b(remove me|take me off|do not (contact|call|text)|don'?t (contact|call|text) me|unsubscribe|stop texting|lose my number)\b/i],
  ['pricing', /\b(how much|price|pricing|cost|costs|rates?|monthly fee|charge|expensive|quote)\b/i],
  ['demo', /\b(demo|show me|see (it|an example|the example|how)|send (it|me the|the) (link|example)|example|walk me through|set up a call|let'?s (talk|chat|meet)|book a (call|time)|when can we)\b/i],
  ['already_has', /\b(already (have|use|got)|we (use|have) (a|an|our)|have (a|an) (receptionist|answering service|online booking|system)|using (podium|ruby|smith\.ai|vagaro|square|booksy|servicetitan|housecall))\b/i],
  ['later', /\b(later|next (week|month|quarter|year)|busy (right now|now)|not (right )?now|after (the )?(season|holidays?)|call (me )?back|follow up|circle back|in a (few|couple) (weeks|months))\b/i],
  ['not_interested', /\b(not interested|no thanks|no thank you|not for us|we'?re good|we are good|pass|don'?t need|no need|nope)\b/i],
  ['interested', /\b(yes|yeah|yep|sure|interested|sounds good|tell me more|more info|ok|okay|info|curious|how does it work|what is it)\b/i],
];

export function ruleClassify(text) {
  for (const [cat, re] of RULES) if (re.test(text)) return { category: cat, confidence: cat === 'interested' ? 0.6 : 0.85, by: 'rules' };
  return null;
}

function suggest(category, contact, industryKey, settings) {
  const ind = INDUSTRY_MAP[industryKey] || INDUSTRY_MAP.other;
  const name = contact?.first_name || 'there';
  const biz = contact?.business_name || 'your business';
  const link = settings.demoUrl ? ` Here's a quick 1-minute example: ${settings.demoUrl}` : '';
  const book = settings.bookingUrl ? ` Grab any time that works here: ${settings.bookingUrl}` : ' What day works best for a quick 10-minute call?';
  const v = ind.vocabulary;
  switch (category) {
    case 'pricing': return `Great question, ${name}. Pricing depends on your call volume and what you'd like the system to handle. I'd be happy to show you what it could do for ${biz} first so you can see if it's even a fit.${book}`;
    case 'demo': return `Awesome, ${name}! I'll show you exactly what a caller hears when they call ${biz} and nobody can pick up.${link || book}`;
    case 'interested': return `Thanks for getting back to me, ${name}! In short: when you're busy and miss a call, the system answers or texts them back right away so they book with you instead of calling someone else.${link || book}`;
    case 'already_has': return `That's great, ${name}! This isn't meant to replace what you have. It catches the people who still call while you're busy and points them to your existing ${/book/i.test(v.join(' ')) ? 'booking link' : 'setup'}. Happy to show you how it fits alongside it if you're curious.`;
    case 'later': return `No problem at all, ${name}. When would be a better time to circle back? I'll make a note and reach out then.`;
    case 'not_interested': return `Totally understand, ${name}. Thanks for letting me know. If anything changes with missed calls at ${biz}, I'm here. Have a great week!`;
    case 'opt_out': return '';
    default: return `Thanks, ${name}! Happy to answer any questions about how this would work for ${biz}.`;
  }
}

async function aiClassify(text, contact, industryKey) {
  const ai = activeAI();
  if (!ai) return null;
  const res = await ai.complete({
    system: 'You classify SMS replies to a sales voicemail. Return only JSON.',
    prompt: `Industry: ${(INDUSTRY_MAP[industryKey] || INDUSTRY_MAP.other).label}. Reply: """${text.slice(0, 1000)}"""
Categories: interested, pricing, demo, not_interested, already_has, later, opt_out.
Return {"category": "...", "confidence": 0-1}`,
    maxTokens: 300,
  });
  recordCost({ category: 'ai', provider: `${ai.name}:${res.model}`, units: res.inputTokens + res.outputTokens, unit: 'tokens', amount: res.cost, note: 'reply classify' });
  const j = extractJson(res.text);
  return CATEGORIES[j.category] ? { category: j.category, confidence: Number(j.confidence) || 0.7, by: 'ai' } : null;
}

export async function ingestReply({ contactId, ghlContactId, phone, body, externalId = null, source = 'manual' }) {
  if (!body?.trim()) throw Object.assign(new Error('Reply text is required'), { status: 400 });
  let contact = contactId ? getContact(contactId) : null;
  if (!contact && ghlContactId) contact = getContact(`ghl:${ghlContactId}`);
  if (!contact && phone) {
    const d = String(phone).replace(/\D/g, '').slice(-10);
    const row = db.prepare("SELECT id FROM contacts WHERE substr(replace(phone,'+',''), -10) = ?").get(d);
    if (row) contact = getContact(row.id);
  }
  if (externalId && db.prepare('SELECT 1 FROM replies WHERE external_id = ?').get(externalId)) return { duplicate: true };
  const cc = contact ? db.prepare('SELECT * FROM campaign_contacts WHERE contact_id = ? ORDER BY sent_at IS NULL, sent_at DESC, id DESC LIMIT 1').get(contact.id) : null;
  const industry = cc?.industry || contact?.industry || 'other';
  const settings = getSettings();

  let cls = ruleClassify(body);
  if ((!cls || cls.confidence < 0.7) && cls?.category !== 'opt_out') {
    try { cls = (await aiClassify(body, contact, industry)) || cls; } catch { /* keep rules result */ }
  }
  cls ||= { category: 'interested', confidence: 0.4, by: 'default' };
  const suggestion = suggest(cls.category, contact, industry, settings);

  const info = db.prepare(`INSERT INTO replies (contact_id, campaign_contact_id, body, category, confidence, classified_by, suggested_reply, external_id, status)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(contact?.id || null, cc?.id || null, body.trim(), cls.category, cls.confidence, cls.by, suggestion, externalId, cls.category === 'opt_out' ? 'closed' : 'new');
  if (cc) db.prepare('UPDATE campaign_contacts SET reply_category = ?, lead_score = ? WHERE id = ?').run(cls.category, CATEGORIES[cls.category].score, cc.id);

  if (cls.category === 'opt_out') {
    if (contact?.phone) suppress(contact.phone, 'Replied opt-out', source);
    if (cc) db.prepare("UPDATE campaign_contacts SET delivery_status = CASE WHEN delivery_status = 'queued' THEN 'skipped' ELSE delivery_status END, sms_status = CASE WHEN sms_status = 'not_sent' THEN 'skipped: opted out' ELSE sms_status END WHERE contact_id = ?").run(contact.id);
    audit('optout.received', 'contact', contact?.id || phone, { body }, 'system');
    if (contact) await workflowTag(contact, 'opted-out', settings);
  } else if (contact) {
    await workflowTag(contact, 'replied', settings);
    if (cls.category === 'demo') await workflowTag(contact, 'demo-requested', settings);
  }
  audit('reply.ingest', 'reply', Number(info.lastInsertRowid), { category: cls.category, by: cls.by, source }, 'system');
  return getReply(Number(info.lastInsertRowid));
}

export function getReply(id) {
  return db.prepare(`SELECT r.*, k.first_name, k.last_name, k.business_name, k.phone, k.industry, k.source, k.external_id, c.name campaign_name, cc.campaign_id
    FROM replies r LEFT JOIN contacts k ON k.id = r.contact_id LEFT JOIN campaign_contacts cc ON cc.id = r.campaign_contact_id
    LEFT JOIN campaigns c ON c.id = cc.campaign_id WHERE r.id = ?`).get(id);
}

export function listReplies({ category, status } = {}) {
  const where = []; const args = [];
  if (category) { where.push('r.category = ?'); args.push(category); }
  if (status) { where.push('r.status = ?'); args.push(status); }
  return db.prepare(`SELECT r.*, k.first_name, k.last_name, k.business_name, k.phone, k.industry, k.source, c.name campaign_name
    FROM replies r LEFT JOIN contacts k ON k.id = r.contact_id LEFT JOIN campaign_contacts cc ON cc.id = r.campaign_contact_id
    LEFT JOIN campaigns c ON c.id = cc.campaign_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.created_at DESC, r.id DESC LIMIT 500`).all(...args);
}

export async function aiRewriteSuggestion(id, instruction = '') {
  const r = getReply(id);
  if (!r) throw Object.assign(new Error('Not found'), { status: 404 });
  const ai = activeAI();
  if (!ai) throw Object.assign(new Error('No AI provider configured; edit the suggestion manually'), { status: 412 });
  const settings = getSettings();
  const ind = INDUSTRY_MAP[r.industry] || INDUSTRY_MAP.other;
  const history = r.contact_id ? db.prepare('SELECT direction, body FROM replies WHERE contact_id = ? ORDER BY id DESC LIMIT 6').all(r.contact_id).reverse() : [];
  const res = await ai.complete({
    system: `You are ${settings.senderName} from ${settings.senderCompany}, replying by SMS to a local ${ind.label} owner. Friendly, short (under 320 characters), human, no jargon, no pressure, no price numbers, no guarantees. Return only JSON.`,
    prompt: `Conversation so far: ${JSON.stringify(history)}
Their latest reply (category: ${r.category}): """${r.body}"""
Current draft: """${r.suggested_reply}"""
${settings.demoUrl ? `Demo link you may include: ${settings.demoUrl}` : ''} ${settings.bookingUrl ? `Booking link: ${settings.bookingUrl}` : ''}
${instruction ? 'Extra instruction: ' + instruction : ''}
Return {"reply": "..."}`,
    maxTokens: 400,
  });
  recordCost({ campaignId: r.campaign_id || null, category: 'ai', provider: `${ai.name}:${res.model}`, units: res.inputTokens + res.outputTokens, unit: 'tokens', amount: res.cost, note: 'reply suggestion' });
  const reply = extractJson(res.text).reply;
  db.prepare('UPDATE replies SET suggested_reply = ? WHERE id = ?').run(reply, id);
  return getReply(id);
}

export async function sendReply(id, text) {
  const r = getReply(id);
  if (!r) throw Object.assign(new Error('Not found'), { status: 404 });
  if (r.category === 'opt_out') throw Object.assign(new Error('Contact opted out; do not reply'), { status: 409 });
  if (r.source !== 'ghl' || !ghl.ghlConfigured()) throw Object.assign(new Error('Replies can be sent only to GHL contacts with GHL configured. Copy the text and reply manually.'), { status: 412 });
  const res = await ghl.sendSms(r.external_id, text);
  db.prepare("INSERT INTO replies (contact_id, campaign_contact_id, body, direction, status) VALUES (?,?,?,'outbound','sent')").run(r.contact_id, r.campaign_contact_id, text);
  db.prepare("UPDATE replies SET status = 'replied' WHERE id = ?").run(id);
  audit('reply.send', 'reply', id, { messageId: res.messageId });
  return { ok: true };
}

export function setReplyStatus(id, status, category) {
  if (category && CATEGORIES[category]) {
    db.prepare("UPDATE replies SET category = ?, classified_by = 'user' WHERE id = ?").run(category, id);
    const r = getReply(id);
    if (r?.campaign_contact_id) db.prepare('UPDATE campaign_contacts SET reply_category = ?, lead_score = ? WHERE id = ?').run(category, CATEGORIES[category].score, r.campaign_contact_id);
    if (category === 'opt_out' && r?.phone) suppress(r.phone, 'Marked opt-out by user', 'user');
  }
  if (status) db.prepare('UPDATE replies SET status = ? WHERE id = ?').run(status, id);
  return getReply(id);
}

// Pull inbound SMS for contacts we've messaged (when no webhook is set up).
export async function pullFromGhl() {
  if (!ghl.ghlConfigured()) throw Object.assign(new Error('GHL is not configured'), { status: 412 });
  const contacts = db.prepare(`SELECT DISTINCT k.id, k.external_id FROM campaign_contacts cc JOIN contacts k ON k.id = cc.contact_id
    WHERE k.source = 'ghl' AND (cc.delivery_status IN ('sent','delivered','handed_off') OR cc.sms_status = 'sent') LIMIT 200`).all();
  let added = 0;
  for (const c of contacts) {
    const conv = await ghl.ghl('GET', '/conversations/search', { query: { locationId: config.ghl.locationId, contactId: c.external_id } }).catch(() => null);
    const convId = conv?.conversations?.[0]?.id;
    if (!convId) continue;
    const msgs = await ghl.ghl('GET', `/conversations/${convId}/messages`, { query: { limit: 20 } }).catch(() => null);
    for (const m of msgs?.messages?.messages || msgs?.messages || []) {
      if (m.direction !== 'inbound' || !m.body) continue;
      const r = await ingestReply({ contactId: c.id, body: m.body, externalId: `ghl_${m.id}`, source: 'ghl_pull' });
      if (!r.duplicate) added++;
    }
  }
  return { checked: contacts.length, added };
}
