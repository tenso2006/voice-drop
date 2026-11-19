// Script generation. Cost strategy:
//  1. Template engine (free) is the default and always the fallback.
//  2. With "useAI", ONE AI call per industry+options writes 3 base variants with
//     placeholders, cached in base_scripts and reused across contacts/campaigns.
//  3. Only "business-specific" personalization makes a short per-contact AI call.
//  4. Human-edited scripts are never overwritten unless explicitly regenerated.
import crypto from 'node:crypto';
import { db, json, recordCost, getSettings, audit } from '../db.js';
import { INDUSTRY_MAP } from '../data/industries.js';
import { activeAI, extractJson } from '../providers/ai/index.js';
import { buildTemplate, renderScript, renderSms, lintScript, seededPick, DEFAULT_OPTIONS } from './scriptEngine.js';
import { checkContact } from './compliance.js';
import { getContact } from './contacts.js';

const WORDS = { 15: 45, 20: 58, 30: 84, 45: 125 }; // ~168 wpm conversational pace
const OFFER_TEXT = {
  voice: 'an AI Voice Agent (virtual receptionist that answers calls 24/7, answers questions, books appointments)',
  text: 'Missed Call Text Back (instantly texts anyone whose call was missed so they do not call a competitor)',
  both: 'an AI receptionist that answers calls 24/7 plus an automatic text-back for any call that is missed',
};
const CTA_TEXT = {
  reply_text: 'say you will send a text right after and they can just reply to see a quick example',
  visit_demo: 'say you will text a link to a short demo',
  schedule_call: 'invite them to a quick 10-minute call and say you will text to find a time',
};

const SYSTEM = `You write short voicemail scripts for a local business owner named {sender} at {company}. They sound like a real person from the community leaving a casual voicemail, never like an ad or a call center.
Rules:
- Sell the business outcome (not losing callers to competitors), not technology. The core idea: every missed call could be a customer walking to a competitor.
- Use the industry's everyday language naturally. Plain, spoken American English, contractions, short sentences.
- Never say "I help local businesses grow", "digital marketing agency", "CRM", "automation", "leverage", or similar jargon. At most one mention of "AI".
- No guarantees, percentages, or dollar figures. Hedge outcomes with "could", "might", "potentially".
- No pressure or urgency tactics. Soft, friendly call to action.
- Always open by identifying the sender: "Hey {first_name}, this is {sender} with {company}."
- Do not include a phone number or URL; the system appends those.
- Return only JSON.`;

function optionsHash(industry, o) {
  const key = JSON.stringify({ industry, tone: o.tone, duration: o.duration, offer: o.offer, cta: o.cta, personalization: o.personalization, v: 2 });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function industryBrief(ind) {
  return `Industry: ${ind.label}
Everyday pain point: ${ind.painPoint}
What happens on a missed call: ${ind.missedCall}
Why callers go to a competitor: ${ind.competitorReason}
Potential impact (keep hedged): ${ind.revenueImpact}
Vocabulary to use naturally: ${ind.vocabulary.join(', ')}
How the solution helps: ${ind.howWeSolve}`;
}

async function aiBaseVariants(industryKey, o, campaignId) {
  const hash = optionsHash(industryKey, o);
  const cached = db.prepare('SELECT * FROM base_scripts WHERE hash = ?').get(hash);
  if (cached) return { variants: json(cached.template, []), cached: true };
  const ai = activeAI();
  if (!ai) return null;
  const settings = getSettings();
  const ind = INDUSTRY_MAP[industryKey] || INDUSTRY_MAP.other;
  const prompt = `${industryBrief(ind)}

Write 3 different voicemail scripts (~${WORDS[o.duration] || 78} words each, about ${o.duration} seconds spoken).
Tone: ${o.tone}. Offer: ${OFFER_TEXT[o.offer]}. Call to action: ${CTA_TEXT[o.cta]}.
Structure: 1) personal intro 2) industry-specific observation 3) relatable missed-call moment 4) what they could lose 5) simple solution 6) soft invite to see a short example.
${o.personalization === 'basic' ? 'Use only {first_name}; do not mention the business name or city.' : 'Use the placeholders {first_name}, {business_name} and, where natural, {city} (city may be empty, so phrase it so the sentence still works without it, e.g. avoid "in {city}" constructions; prefer {area} which falls back to "town").'}
Use the literal placeholders {sender} and {company} for the caller.
Example of the style (barbershop): "Hey {first_name}, this is {sender} with {company}. I was just thinking about something. When you're in the middle of a fade or working with a client, your phone might be ringing with someone trying to book a haircut. If nobody answers, there's a good chance they're calling the next barber on Google. That's potentially a new client lost before you even get a chance to talk to them. I've got a simple way to automatically catch those calls and turn them into bookings. I'd love to show you a quick example. I'll send you a text too. Talk soon!"
Return JSON: {"variants": ["...", "...", "..."]}`;
  const res = await ai.complete({ system: SYSTEM, prompt, maxTokens: 1200 });
  recordCost({ campaignId, category: 'ai', provider: `${ai.name}:${res.model}`, units: res.inputTokens + res.outputTokens, unit: 'tokens', amount: res.cost, note: `base scripts: ${industryKey}` });
  const variants = (extractJson(res.text).variants || []).filter((v) => typeof v === 'string' && v.length > 40);
  if (!variants.length) throw new Error('AI returned no usable variants');
  db.prepare('INSERT OR REPLACE INTO base_scripts (hash, industry, options, template) VALUES (?,?,?,?)').run(hash, industryKey, JSON.stringify(o), JSON.stringify(variants));
  return { variants, cached: false, cost: res.cost };
}

async function aiPersonalize(base, contact, industryKey, o, campaignId) {
  const ai = activeAI();
  if (!ai) return null;
  const ind = INDUSTRY_MAP[industryKey] || INDUSTRY_MAP.other;
  const facts = {
    first_name: contact.first_name, business_name: contact.business_name, city: contact.city, state: contact.state,
    website: contact.website, tags: contact.tags?.slice(0, 10),
    details: Object.fromEntries(Object.entries(contact.custom_fields || {}).filter(([k, v]) => typeof v === 'string' && v.length < 200 && !/consent|password|token/i.test(k)).slice(0, 12)),
  };
  const prompt = `Industry: ${ind.label}. Vocabulary: ${ind.vocabulary.join(', ')}.
Prospect facts (from CRM, use only if they make the message more specific; never invent facts): ${JSON.stringify(facts)}
Rewrite this voicemail so it is specific to this business. Keep the same structure, length (~${WORDS[o.duration] || 78} words), tone (${o.tone}), and the sender intro. Keep {sender} and {company} placeholders as-is.
Script: """${base}"""
Return JSON: {"script": "..."}`;
  const res = await ai.complete({ system: SYSTEM, prompt, maxTokens: 500 });
  recordCost({ campaignId, category: 'ai', provider: `${ai.name}:${res.model}`, units: res.inputTokens + res.outputTokens, unit: 'tokens', amount: res.cost, note: `personalize ${contact.id}` });
  return extractJson(res.text).script;
}

export async function generateForCampaign(campaignId, { ids = null, force = false } = {}) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const o = { ...DEFAULT_OPTIONS, ...json(campaign.options, {}) };
  const settings = getSettings();
  let rows = db.prepare('SELECT * FROM campaign_contacts WHERE campaign_id = ?').all(campaignId);
  if (ids?.length) rows = rows.filter((r) => ids.includes(r.id));
  if (!force) rows = rows.filter((r) => r.script_source !== 'edited' && r.script_status !== 'approved');

  const result = { generated: 0, ai: 0, template: 0, skipped: 0, errors: [] };
  const baseCache = {};
  for (const cc of rows) {
    const contact = getContact(cc.contact_id);
    if (!contact) { result.skipped++; continue; }
    const industry = cc.industry || contact.industry || 'other';
    let template = null; let source = 'template';
    try {
      if (o.useAI) {
        baseCache[industry] ??= await aiBaseVariants(industry, o, campaignId);
        const variants = baseCache[industry]?.variants;
        if (variants?.length) {
          template = seededPick(contact.id, 'variant', variants);
          source = 'ai';
          if (o.personalization === 'business') {
            const p = await aiPersonalize(template, contact, industry, o, campaignId);
            if (p) template = p;
          }
          if (o.includeCallback) template += ' {callback_line}';
        }
      }
    } catch (err) {
      result.errors.push(`${contact.first_name || contact.id}: AI failed (${err.message}); used template`);
    }
    if (!template) { template = buildTemplate(industry, o, contact.id); source = 'template'; }
    const script = renderScript(template, contact, settings, o);
    const sms = renderSms(industry, contact, settings, o);
    const comp = checkContact(contact, { channel: 'voice', campaignId, settings });
    db.prepare(`UPDATE campaign_contacts SET industry = ?, script = ?, script_source = ?, script_status = 'draft', sms_text = ?,
      audio_id = NULL, compliance_status = ?, compliance_notes = ? WHERE id = ?`)
      .run(industry, script, source, sms, comp.status, JSON.stringify(comp.notes), cc.id);
    result.generated++; result[source]++;
  }
  db.prepare("UPDATE campaigns SET status = CASE WHEN status = 'draft' THEN 'scripts_ready' ELSE status END, updated_at = datetime('now') WHERE id = ?").run(campaignId);
  audit('scripts.generate', 'campaign', campaignId, { ...result, errors: result.errors.length });
  return result;
}

export function lintRow(cc, options, settings) { return lintScript(cc.script || '', options, settings); }
