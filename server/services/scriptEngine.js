// Zero-cost template engine that turns industry intelligence into a natural
// 6-part voicemail. Variation is seeded by contact id so every contact gets a
// different-but-stable script (regenerating does not churn audio cache).
import crypto from 'node:crypto';
import { INDUSTRY_MAP } from '../data/industries.js';

export const TONES = ['friendly', 'conversational', 'professional', 'curiosity', 'bold'];
export const DURATIONS = [15, 20, 30, 45];
export const OFFERS = ['voice', 'text', 'both'];
export const CTAS = ['reply_text', 'visit_demo', 'schedule_call'];
export const PERSONALIZATION = ['basic', 'advanced', 'business'];

export const DEFAULT_OPTIONS = {
  tone: 'conversational', duration: 30, offer: 'both', cta: 'reply_text',
  personalization: 'advanced', includeCallback: true, useAI: false,
  voice: { provider: 'auto', voice: 'ash', speed: 1.0, style: 'warm' },
  sendSms: true,
};

const OPENERS = {
  curiosity: ['Quick question for you.', 'I have a quick question.', "Can I ask you something real quick?"],
  friendly: ["Hope your week's going well.", 'Hope things are good on your end.', 'Hope business is treating you well.'],
  conversational: ['I was just thinking about something.', 'So, I was thinking about something earlier.', "Here's something I keep hearing from owners."],
  professional: ["I'll keep this brief.", "I'll keep this short.", 'Just a quick note for you.'],
  bold: ["I'll be straight with you.", "I'll get right to it.", "Let me be direct for a second."],
};

const BUSINESS_LINES = [
  "I came across {business_name}{in_city} and wanted to reach out.",
  "I was looking at {business_name}{in_city} and had a thought.",
];

const CTA = {
  reply_text: {
    short: "I'll send you a text too. Talk soon!",
    long: "I've got a quick example I'd love to show you. I'll send you a text right after this, just reply if you want to see it.",
  },
  visit_demo: {
    short: "I'll text you a link to a quick demo. Talk soon!",
    long: "I'll text you a link to a short demo. It only takes about a minute to check out.",
  },
  schedule_call: {
    short: "I'll text you to set up a quick call. Talk soon!",
    long: "If you've got ten minutes this week, I'd love to show you how it works. I'll send you a text to find a time.",
  },
};

const SHORT_SOLUTION = {
  voice: "I've got a simple way to answer those calls for you.",
  text: "I've got a simple way to text those callers back instantly.",
  both: "I've got a simple way to catch those calls for you.",
};

const REASSURE = {
  voice: "It doesn't replace your team. It just picks up the calls they can't get to.",
  text: "It works with your current phone number, nothing new to learn.",
  both: "It doesn't replace your team, and it works with your current number.",
};

export function seededPick(seed, salt, arr) {
  const h = crypto.createHash('sha1').update(`${seed}|${salt}`).digest();
  return arr[h.readUInt32BE(0) % arr.length];
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const isQuestion = (s) => /^(how|what|do|would|can|is|are)\b/i.test(s.trim());
const end = (s) => (/[.?!]$/.test(s) ? s : s + (isQuestion(s) ? '?' : '.'));

export function spokenPhone(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (d.length !== 10) return p || '';
  return `${d.slice(0, 3)}, ${d.slice(3, 6)}, ${d.slice(6)}`.split('').join(' ').replace(/ ,/g, ',');
}

export function contactVars(contact, settings) {
  const city = (contact.city || '').trim();
  return {
    first_name: (contact.first_name || '').trim() || 'there',
    business_name: (contact.business_name || '').trim() || 'your business',
    city,
    in_city: city ? ` over in ${city}` : '',
    area: city || 'town',
    city_or_summer: city || 'summer',
    city_or_texas: city || 'summer',
    sender: settings.senderName || 'Tenzin',
    company: settings.senderCompany || 'Lobsang Solutions',
    demo_url: settings.demoUrl || '',
    booking_url: settings.bookingUrl || '',
    callback: settings.callbackNumber || '',
  };
}

export function fill(template, vars) {
  return template.replace(/\{([a-z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/\s+([,.?!])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export function wordCount(s) { return (s.match(/\b[\w'’-]+\b/g) || []).length; }
export function estimateSeconds(script, speed = 1) { return Math.round((wordCount(script) / 2.8 / (speed || 1)) * 10) / 10; }

// Build the parts; returns a template string (with placeholders) so it can be
// cached and reused across contacts of the same industry.
export function buildTemplate(industryKey, opts, seed = 'base') {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const ind = INDUSTRY_MAP[industryKey] || INDUSTRY_MAP.other;
  const idx = ind.observations.length > 1 ? (seededPick(seed, 'pair', [0, 1])) : 0;
  const greeting = o.tone === 'professional' ? 'Hi {first_name}, this is {sender} with {company}.' : 'Hey {first_name}, this is {sender} with {company}.';
  const opener = seededPick(seed, 'open', OPENERS[o.tone] || OPENERS.conversational);
  const obs = ind.observations[idx];
  const caller = ind.callers[idx] || ind.callers[0];
  const scenario = /^[A-Z]/.test(caller) ? `${end(cap(obs))} ${end(caller)}` : end(`${cap(obs)}, ${caller}`);
  const competitor = end(seededPick(seed, 'comp', ind.competitor));
  const loss = end(seededPick(seed, 'loss', ind.loss));
  const solution = end(ind.solution[o.offer] || ind.solution.both);
  const cta = CTA[o.cta] || CTA.reply_text;
  const bizLine = seededPick(seed, 'biz', BUSINESS_LINES);
  const personal = o.personalization !== 'basic';

  const d = Number(o.duration) || 30;
  const parts = [greeting];
  if (d >= 45) parts.push(personal ? bizLine : opener);
  else if (d >= 30 && ['curiosity', 'friendly'].includes(o.tone)) parts.push(opener);
  parts.push(scenario);
  if (d >= 20) parts.push(competitor);
  if (d >= 30) parts.push(loss);
  parts.push(d <= 20 ? SHORT_SOLUTION[o.offer] || SHORT_SOLUTION.both : solution);
  if (d >= 45) parts.push(REASSURE[o.offer] || REASSURE.both);
  parts.push(d >= 45 ? cta.long : cta.short);
  if (o.includeCallback) parts.push('{callback_line}');
  return parts.join(' ');
}

export function renderScript(template, contact, settings, opts = {}) {
  const vars = contactVars(contact, settings);
  vars.callback_line = opts.includeCallback !== false && vars.callback ? `You can reach me at ${spokenPhone(vars.callback)}.` : '';
  return fill(template, vars);
}

export function renderSms(industryKey, contact, settings, opts = {}) {
  const ind = INDUSTRY_MAP[industryKey] || INDUSTRY_MAP.other;
  let t = opts.smsTemplate || ind.sms;
  const vars = contactVars(contact, settings);
  if (opts.cta === 'visit_demo' && vars.demo_url) t = t.replace(/(Want|Open|Would)[^?]*\?/, 'Here\'s a 1-minute example: {demo_url}');
  if (opts.cta === 'schedule_call' && vars.booking_url) t = t.replace(/(Want|Open|Would)[^?]*\?/, 'Grab a quick time here if you\'re curious: {booking_url}');
  let s = fill(t, vars);
  if (!/reply stop/i.test(s)) s += ' Reply STOP to opt out.';
  return s;
}

// Guardrails applied to any script (template, AI or hand-edited).
const BANNED = [
  [/\bI help local businesses grow\b/i, 'Generic agency line'],
  [/\bdigital marketing agency\b/i, 'Agency positioning'],
  [/\bguarantee[sd]?\b/i, 'Guarantee claim'],
  [/\b(\d+)\s?%\s?(more|increase)/i, 'Unsubstantiated % claim'],
  [/\$\s?\d[\d,]*/, 'Specific dollar claim'],
  [/\b(act now|limited time|don't miss out)\b/i, 'Pushy sales language'],
  [/\b(CRM|automation|leverage|synerg|omnichannel)\w*/i, 'Jargon'],
];
export function lintScript(script, opts = {}, settings = {}) {
  const issues = [];
  for (const [re, label] of BANNED) if (re.test(script)) issues.push(label);
  const sec = estimateSeconds(script, opts.voice?.speed);
  const target = Number(opts.duration || 30);
  if (sec > target * 1.35 + 3) issues.push(`Long for target (${sec}s vs ${target}s)`);
  if (sec < target * 0.55) issues.push(`Short for target (${sec}s vs ${target}s)`);
  const company = settings.senderCompany || 'Lobsang Solutions';
  if (!script.toLowerCase().includes(company.toLowerCase().split(' ')[0])) issues.push('Missing sender identification');
  if (/\{[a-z_]+\}/.test(script)) issues.push('Unfilled placeholder');
  return { seconds: sec, words: wordCount(script), issues };
}
