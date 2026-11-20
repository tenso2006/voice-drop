// Prospecting: find local businesses (Google Places), score how likely they are
// losing callers ("Missed-Call Opportunity Score"), produce an SDR call script,
// and hand leads to the contact list and/or GHL.
import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config.js';
import { db, json, audit, recordCost, getSettings } from '../db.js';
import { INDUSTRY_MAP, INDUSTRIES, detectIndustry } from '../data/industries.js';
import { textSearch, normalizePlace } from '../providers/leads/googlePlaces.js';
import { buildTemplate, renderScript } from './scriptEngine.js';
import { saveContact } from './contacts.js';
import * as ghl from '../providers/crm/ghl.js';

const err = (status, message) => Object.assign(new Error(message), { status });

// What to type into Google for each industry (user can override).
export const SEARCH_TERMS = {
  barbershop: 'barber shop', restaurant: 'restaurant', roofing: 'roofing contractor', hvac: 'HVAC contractor',
  plumbing: 'plumber', landscaping: 'landscaping lawn care', dental: 'dentist', medical: 'physical therapy clinic',
  real_estate: 'real estate agent', auto_repair: 'auto repair shop', home_improvement: 'home remodeling contractor', other: '',
};
const GOOGLE_TYPE_TO_INDUSTRY = {
  barber_shop: 'barbershop', hair_salon: 'barbershop', hair_care: 'barbershop', beauty_salon: 'barbershop', nail_salon: 'barbershop', spa: 'barbershop',
  restaurant: 'restaurant', bar: 'restaurant', cafe: 'restaurant', meal_takeaway: 'restaurant', pizza_restaurant: 'restaurant',
  roofing_contractor: 'roofing', plumber: 'plumbing', dentist: 'dental', dental_clinic: 'dental',
  physiotherapist: 'medical', doctor: 'medical', chiropractor: 'medical', medical_clinic: 'medical',
  real_estate_agency: 'real_estate', car_repair: 'auto_repair', car_dealer: 'auto_repair',
  general_contractor: 'home_improvement', electrician: 'home_improvement', painter: 'home_improvement', locksmith: 'home_improvement',
};
const URGENT = new Set(['hvac', 'plumbing', 'roofing']);

// ------------------------------------------------------------------ search --
export async function search({ industry = 'other', term, location, pages = 1 }) {
  if (!location?.trim()) throw err(400, 'Enter a ZIP code, city, or address');
  const what = (term || SEARCH_TERMS[industry] || INDUSTRY_MAP[industry]?.label || 'local business').trim();
  const query = `${what} near ${location.trim()}`;
  const maxPages = Math.min(3, Math.max(1, Number(pages) || 1));
  const info = db.prepare('INSERT INTO prospect_searches (query, industry, location) VALUES (?,?,?)').run(query, industry, location.trim());
  const searchId = Number(info.lastInsertRowid);

  let token = null; let requests = 0; const found = [];
  for (let i = 0; i < maxPages; i++) {
    const res = await textSearch({ query, pageToken: token });
    requests++;
    found.push(...res.places.map(normalizePlace));
    token = res.nextPageToken;
    if (!token) break;
    await new Promise((r) => setTimeout(r, process.env.NODE_ENV === 'test' ? 0 : 1500)); // Google needs a moment before the next page is valid
  }
  const cost = (requests / 1000) * config.leads.costPer1k;
  recordCost({ category: 'leads', provider: 'google_places', units: requests, unit: 'requests', amount: cost, note: query });

  let added = 0;
  for (const p of found) {
    if (p.business_status && p.business_status !== 'OPERATIONAL') continue;
    const existing = db.prepare('SELECT * FROM prospects WHERE place_id = ?').get(p.place_id);
    // Google's own business type wins; then the industry you searched for; then name-based detection.
    const ind = GOOGLE_TYPE_TO_INDUSTRY[p.primary_type] || (industry !== 'other' ? industry : detectIndustry({ business_name: p.name, tags: p.types }));
    const site = p.website ? await checkWebsite(p.website) : null;
    const scored = scoreProspect({ ...p, industry: ind }, site, existing?.test_call);
    db.prepare(`INSERT INTO prospects (place_id, search_id, name, phone, website, address, city, state, zip, rating, review_count, weekday_text,
        primary_type, industry, maps_url, score, reasons, signals)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(place_id) DO UPDATE SET search_id = excluded.search_id, name = excluded.name, phone = excluded.phone, website = excluded.website,
        address = excluded.address, rating = excluded.rating, review_count = excluded.review_count, weekday_text = excluded.weekday_text,
        score = excluded.score, reasons = excluded.reasons, signals = excluded.signals, updated_at = datetime('now')`)
      .run(p.place_id, searchId, p.name, p.phone, p.website, p.address, p.city, p.state, p.zip, p.rating, p.review_count,
        JSON.stringify(p.weekday_text || []), p.primary_type, existing?.industry || ind, p.maps_url, scored.score,
        JSON.stringify(scored.reasons), JSON.stringify(scored.signals));
    added++;
  }
  db.prepare('UPDATE prospect_searches SET requests = ?, results = ?, cost = ? WHERE id = ?').run(requests, added, cost, searchId);
  audit('prospects.search', 'prospect_search', searchId, { query, results: added, requests });
  return { searchId, query, results: added, requests, cost };
}

// -------------------------------------------------------------- scoring ----
const PHONE_COMPLAINTS = [
  /never (answer|pick(s|ed)? up|call(s|ed)? back)/i, /(didn'?t|don'?t|doesn'?t|did not|does not|do not|won'?t) (answer|pick up|call (me )?back|return (my )?calls?)/i,
  /no (answer|call ?back|one (answered|picks up|picked up))/i, /(couldn'?t|could not|can'?t|cannot|unable to) (get through|reach|get a hold|get ahold|get anyone)/i,
  /voicemail (is |was )?full/i, /straight to voicemail/i, /left (several |multiple |a few |many |\d+ )?(voice ?mails|messages)/i,
  /hard to (reach|get a hold|get ahold|contact)/i, /(phone|calls?) (just )?(rang|rings|ringing) (and rang|out|forever)/i, /never (got|received) a (call|response)/i,
];
const BOOKING = /calendly\.com|acuityscheduling|squareup\.com\/appointments|square\.site|book\.squareup|vagaro|booksy|setmore|mindbody|schedulicity|fresha|housecallpro|servicetitan|jobber|getjobber|opentable|resy\.com|toasttab|zocdoc|localmed|nexhealth|book (now|online|an appointment)|schedule (now|online|service)|request an appointment/i;
const CHAT = /intercom|drift\.com|tidio|livechat|tawk\.to|podium|birdeye|leadconnector|msgsndr|hubspot.*conversations|zendesk|crisp\.chat|smith\.ai|ruby\.com|answerconnect|text us/i;

function hoursSignals(weekdayText) {
  const lines = (weekdayText || []).map((l) => l.toLowerCase());
  if (!lines.length) return {};
  const closed = (d) => lines.find((l) => l.startsWith(d))?.includes('closed');
  const early = lines.filter((l) => !l.startsWith('saturday') && !l.startsWith('sunday')).some((l) => /–\s*([1-5])(:\d\d)?\s*pm/.test(l));
  return { closedSat: !!closed('saturday'), closedSun: !!closed('sunday'), closesEarly: early, open24: lines.some((l) => l.includes('open 24 hours')) };
}

export function scoreProspect(p, site, testCall) {
  const reasons = []; const signals = {};
  let score = 20;
  if (!p.phone) return { score: 0, reasons: ['No phone number listed'], signals: { noPhone: true } };

  const complaints = (p.reviews || []).filter((r) => PHONE_COMPLAINTS.some((re) => re.test(r.text)));
  signals.phoneComplaints = complaints.length;
  if (complaints.length) {
    score += Math.min(45, 30 + (complaints.length - 1) * 10);
    reasons.push(`${complaints.length} recent Google review${complaints.length > 1 ? 's mention' : ' mentions'} trouble reaching them by phone`);
  }

  const n = p.review_count || 0; signals.reviews = n;
  if (n >= 150) { score += 15; reasons.push(`Busy business (${n} reviews), so more calls to miss`); }
  else if (n >= 50) { score += 10; reasons.push(`Steady volume (${n} reviews)`); }
  else if (n > 0 && n < 15) { score += 5; reasons.push('Small, likely owner-operated: probably no receptionist'); }

  const h = hoursSignals(p.weekday_text); Object.assign(signals, h);
  if (!h.open24) {
    if (URGENT.has(p.industry) && (h.closedSun || h.closedSat)) { score += 15; reasons.push(`Closed ${h.closedSat && h.closedSun ? 'weekends' : h.closedSun ? 'Sundays' : 'Saturdays'}, yet emergencies don't wait`); }
    else if (h.closedSun && h.closedSat) { score += 5; reasons.push('Closed weekends: weekend callers hit voicemail'); }
    if (h.closesEarly) { score += 5; reasons.push('Closes before 6pm on some weekdays'); }
  }

  if (!p.website) { score += 10; reasons.push('No website: the phone is their only front door'); signals.noWebsite = true; }
  else if (site?.ok) {
    signals.booking = site.booking; signals.chat = site.chat;
    if (site.chat) { score -= 10; reasons.push(`Already has a chat/text widget (${site.chat})`); }
    if (site.booking) { score -= 5; reasons.push(`Has online booking (${site.booking}); pitch catching callers who still phone`); }
    if (!site.booking && !site.chat) { score += 10; reasons.push('Website has no online booking or chat'); }
  }

  if (p.rating && p.rating < 4.0) { score += 5; reasons.push(`Rating ${p.rating}: customer experience gaps`); }

  if (testCall === 'rang_out' || testCall === 'voicemail') { score += 30; reasons.unshift(`Verified: test call ${testCall === 'rang_out' ? 'rang out' : 'went to voicemail'}`); }
  if (testCall === 'answered') { score -= 10; reasons.push('Test call was answered live'); }
  signals.testCall = testCall || null;
  return { score: Math.max(0, Math.min(100, score)), reasons, signals };
}

// ------------------------------------------------- safe website inspection --
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && isPrivateIp(v.slice(7));
}

export async function checkWebsite(url, hops = 0) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false };
    if (process.env.NODE_ENV !== 'test') {
      const addrs = await dns.lookup(u.hostname, { all: true });
      if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return { ok: false, blocked: true };
    }
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadCheck/1.0)', Accept: 'text/html' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location') && hops < 3) return checkWebsite(new URL(r.headers.get('location'), u).toString(), hops + 1);
    if (!r.ok || !(r.headers.get('content-type') || '').includes('html')) return { ok: false, status: r.status };
    const reader = r.body.getReader(); let html = ''; let size = 0;
    while (size < 600_000) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; html += Buffer.from(value).toString('utf8');
    }
    reader.cancel().catch(() => {});
    const b = html.match(BOOKING); const c = html.match(CHAT);
    return { ok: true, booking: b ? b[0].toLowerCase().replace(/\.com.*/, '') : null, chat: c ? c[0].toLowerCase().replace(/\.com.*/, '') : null };
  } catch { return { ok: false }; }
}

// ------------------------------------------------------- SDR call script ----
export function callScript(prospect, settings = getSettings()) {
  const ind = INDUSTRY_MAP[prospect.industry] || INDUSTRY_MAP.other;
  const reasons = json(prospect.reasons, prospect.reasons || []);
  const signals = json(prospect.signals, prospect.signals || {});
  const sender = settings.senderName || 'Tenzin'; const company = settings.senderCompany || 'Lobsang Solutions';
  const biz = prospect.name || 'your business';
  let hook;
  if (signals.testCall === 'rang_out' || signals.testCall === 'voicemail') hook = `I actually called ${biz} the other day and it ${signals.testCall === 'rang_out' ? 'rang out' : 'went to voicemail'}. Totally normal when you're busy, but it got me thinking about how many callers that happens to.`;
  else if (signals.phoneComplaints) hook = `I was reading your Google reviews, and a couple mention people having trouble getting through on the phone.`;
  else if (URGENT.has(prospect.industry) && (signals.closedSun || signals.closedSat)) hook = `I noticed you're closed ${signals.closedSat && signals.closedSun ? 'on weekends' : signals.closedSun ? 'Sundays' : 'Saturdays'}. When someone's ${prospect.industry === 'hvac' ? 'AC dies' : prospect.industry === 'plumbing' ? 'pipe bursts' : 'roof starts leaking'} then, where do those calls go?`;
  else hook = `Quick question: ${ind.observations[0]}, who picks up the phone?`;
  const sections = {
    gatekeeper: `"Hi, this is ${sender} with ${company}. Could you help me out, who's the best person to talk to about how calls are handled when everyone's busy? ... When's a good time to catch them?"`,
    opener: `"Hi, is this the owner? ... Great. This is ${sender} with ${company}, I'm local. I'll be quick, I promise. Do you have 30 seconds?"`,
    hook: `"${hook}"`,
    question: `"Roughly how many calls do you think go unanswered in a busy week? And what happens to those people?"`,
    pitch: `"Here's why I'm calling. ${ind.competitorReason} We fix that. ${ind.howWeSolve} It sounds like your own front desk, and it works with your current number."`,
    ask: `"Would you be open to a 15-minute demo this week? I'll call your number from the demo so you hear exactly what your customers would hear. Does Tuesday or Wednesday work better?"`,
    objections: [
      ['How much is it?', `"It depends on your call volume and what you want it to handle, usually less than a part-time receptionist. Let me show you first so you can see if it's even worth it. Tuesday or Wednesday?"`],
      ['We already have someone / online booking', `"That's great. This doesn't replace them. It covers the calls they can't get to: lunch, after hours, when they're on another line. Want to see how it fits alongside?"`],
      ['Send me some info', `"Happy to. What's the best email? And so it's actually useful: when you miss a call today, does anyone call them back?"`],
      ['Not interested', `"Totally fair. Can I ask, is it because missed calls aren't really an issue for you, or just bad timing?"`],
      ['I\'m busy right now', `"No problem, that's exactly the problem we fix! When's a better 2 minutes, later today or tomorrow morning?"`],
    ],
  };
  const vmTemplate = buildTemplate(prospect.industry || 'other', { tone: 'conversational', duration: 20, offer: 'both', cta: 'schedule_call', personalization: 'advanced', includeCallback: true }, prospect.place_id || prospect.name);
  sections.voicemail = renderScript(vmTemplate, { first_name: 'there', business_name: biz, city: prospect.city }, settings, { includeCallback: true }).replace(/^Hey there,/, 'Hi,');
  sections.reasons = reasons;
  sections.text = [
    `CALL SCRIPT: ${biz} (${ind.label}) · Opportunity score ${prospect.score ?? '?'}`,
    reasons.length ? `Why this lead: ${reasons.join('; ')}` : '',
    '', `GATEKEEPER: ${sections.gatekeeper}`, `1. OPENER: ${sections.opener}`, `2. HOOK: ${sections.hook}`, `3. QUESTION: ${sections.question}`,
    `4. PITCH: ${sections.pitch}`, `5. ASK: ${sections.ask}`, '', 'OBJECTIONS:', ...sections.objections.map(([q, a]) => `- ${q}: ${a}`),
    '', `VOICEMAIL (leave it yourself, live): ${sections.voicemail}`,
    '', 'Recording notice in two-party-consent states: "This call may be recorded for quality."',
  ].filter((l) => l !== null).join('\n');
  return sections;
}

// --------------------------------------------------------- list & actions --
export function listProspects({ searchId, status = 'new', minScore = 0, industry, q, sort = 'score' } = {}) {
  const where = []; const args = [];
  if (searchId) { where.push('search_id = ?'); args.push(Number(searchId)); }
  if (status && status !== 'all') { where.push('status = ?'); args.push(status); }
  if (Number(minScore)) { where.push('score >= ?'); args.push(Number(minScore)); }
  if (industry) { where.push('industry = ?'); args.push(industry); }
  if (q) { where.push("(name || ' ' || address) LIKE ?"); args.push(`%${q}%`); }
  const order = sort === 'reviews' ? 'review_count DESC' : sort === 'name' ? 'name COLLATE NOCASE' : 'score DESC, review_count DESC';
  return db.prepare(`SELECT * FROM prospects ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 500`).all(...args)
    .map((p) => ({ ...p, reasons: json(p.reasons, []), signals: json(p.signals, {}), weekday_text: json(p.weekday_text, []) }));
}

export function getProspect(id) {
  const p = db.prepare('SELECT * FROM prospects WHERE place_id = ?').get(id);
  if (!p) throw err(404, 'Prospect not found');
  return { ...p, reasons: json(p.reasons, []), signals: json(p.signals, {}), weekday_text: json(p.weekday_text, []) };
}

export function recentSearches() {
  return db.prepare('SELECT * FROM prospect_searches ORDER BY id DESC LIMIT 20').all();
}

export function monthUsage() {
  const r = db.prepare("SELECT COALESCE(SUM(requests),0) requests, COALESCE(SUM(results),0) results, COALESCE(SUM(cost),0) cost FROM prospect_searches WHERE created_at >= date('now','start of month')").get();
  return { ...r, freePerMonth: config.leads.freePerMonth, costPer1k: config.leads.costPer1k };
}

export function logTestCall(id, result) {
  if (!['answered', 'rang_out', 'voicemail', null].includes(result)) throw err(400, 'Bad result');
  const p = getProspect(id);
  // Re-score using stored signals: rebuild from the stored reasons minus any previous test-call reason.
  const base = p.signals.testCall === 'rang_out' || p.signals.testCall === 'voicemail' ? 30 : p.signals.testCall === 'answered' ? -10 : 0;
  const add = result === 'rang_out' || result === 'voicemail' ? 30 : result === 'answered' ? -10 : 0;
  const reasons = p.reasons.filter((r) => !r.startsWith('Verified: test call') && r !== 'Test call was answered live');
  if (add > 0) reasons.unshift(`Verified: test call ${result === 'rang_out' ? 'rang out' : 'went to voicemail'}`);
  if (add < 0) reasons.push('Test call was answered live');
  const score = Math.max(0, Math.min(100, p.score - base + add));
  db.prepare("UPDATE prospects SET test_call = ?, test_call_at = datetime('now'), score = ?, reasons = ?, signals = ?, updated_at = datetime('now') WHERE place_id = ?")
    .run(result, score, JSON.stringify(reasons), JSON.stringify({ ...p.signals, testCall: result }), id);
  audit('prospects.test_call', 'prospect', id, { result });
  return getProspect(id);
}

export function setProspectFields(id, { industry, status }) {
  getProspect(id);
  if (industry && INDUSTRIES.some((i) => i.key === industry)) db.prepare('UPDATE prospects SET industry = ? WHERE place_id = ?').run(industry, id);
  if (status && ['new', 'added', 'dismissed'].includes(status)) db.prepare('UPDATE prospects SET status = ? WHERE place_id = ?').run(status, id);
  return getProspect(id);
}

// Save to the local contact list (works without GHL). Line type is unknown,
// so the compliance engine keeps automated voice drops blocked until consent.
export function addToContacts(ids) {
  let added = 0;
  for (const id of ids) {
    const p = getProspect(id);
    if (!p.phone) continue;
    const contactId = saveContact('places', {
      external_id: p.place_id, first_name: '', business_name: p.name, phone: p.phone, website: p.website,
      city: p.city, state: p.state, industry: p.industry, tags: ['prospect', `score-${bucket(p.score)}`],
      custom_fields: { address: p.address, zip: p.zip, google_rating: p.rating, google_reviews: p.review_count, opportunity_score: p.score, opportunity_reasons: p.reasons.join('; '), maps_url: p.maps_url },
      consent_note: 'Sourced from Google Places (no consent on file)',
    });
    db.prepare("UPDATE prospects SET status = 'added', contact_id = ?, updated_at = datetime('now') WHERE place_id = ?").run(contactId, id);
    added++;
  }
  audit('prospects.add_contacts', 'prospect', null, { count: added });
  return { added };
}
const bucket = (s) => (s >= 70 ? 'hot' : s >= 45 ? 'warm' : 'cool');

export async function sendToGhl(ids, { assignedTo = null } = {}) {
  if (!ghl.ghlConfigured()) throw err(412, 'Connect GoHighLevel first (GHL_PRIVATE_TOKEN and GHL_LOCATION_ID in .env)');
  const settings = getSettings();
  const out = { sent: 0, failed: [] };
  for (const id of ids) {
    const p = getProspect(id);
    if (!p.phone) { out.failed.push(`${p.name}: no phone`); continue; }
    try {
      const res = await ghl.upsertContact({
        companyName: p.name, name: p.name, phone: p.phone, website: p.website || undefined,
        address1: p.address?.split(',')[0], city: p.city, state: p.state, postalCode: p.zip,
        source: 'Lobsang VoiceDrop Prospecting', assignedTo: assignedTo || undefined,
        tags: ['voicedrop-prospect', `industry-${p.industry}`, `score-${bucket(p.score)}`],
      });
      const ghlId = res.contact?.id || res.id;
      if (!ghlId) throw new Error('GHL did not return a contact id');
      await ghl.addNote(ghlId, callScript(p, settings).text);
      db.prepare("UPDATE prospects SET status = 'added', ghl_contact_id = ?, assigned_to = ?, updated_at = datetime('now') WHERE place_id = ?").run(ghlId, assignedTo, id);
      // Mirror locally so campaigns/compliance see it as a GHL contact
      saveContact('ghl', { external_id: ghlId, business_name: p.name, phone: p.phone, website: p.website, city: p.city, state: p.state, industry: p.industry, tags: ['voicedrop-prospect'], custom_fields: { opportunity_score: p.score, opportunity_reasons: p.reasons.join('; ') } });
      out.sent++;
    } catch (e) { out.failed.push(`${p.name}: ${e.message}`); }
  }
  audit('prospects.send_ghl', 'prospect', null, { sent: out.sent, failed: out.failed.length, assignedTo });
  return out;
}
