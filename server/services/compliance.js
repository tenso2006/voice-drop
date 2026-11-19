// Compliance engine. Runs before generation (to flag), at approval (to gate) and
// again at send time (authoritative). Nothing in the app can bypass it.
// This is a safeguard, not legal advice: have counsel review your consent
// language and use-case before sending prerecorded / AI-voice marketing.
import { db, getSettings } from '../db.js';

const STATE_TZ = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles',
  CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago',
  OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York', WI: 'America/Chicago',
  WY: 'America/Denver', PR: 'America/Puerto_Rico',
};
const STATE_NAMES = { texas: 'TX', florida: 'FL', california: 'CA', 'new york': 'NY', illinois: 'IL', georgia: 'GA', arizona: 'AZ', colorado: 'CO', ohio: 'OH', washington: 'WA', 'north carolina': 'NC', michigan: 'MI', pennsylvania: 'PA', virginia: 'VA', tennessee: 'TN', oklahoma: 'OK', louisiana: 'LA', nevada: 'NV', utah: 'UT', oregon: 'OR' };

// Several states have stricter rules (e.g. FL, OK, MD "mini-TCPA" laws with 8am–8pm windows
// and extra consent rules). We tighten the window for those automatically.
const STRICT_STATES = { FL: ['08:00', '20:00'], OK: ['08:00', '20:00'], MD: ['08:00', '20:00'], WA: ['08:00', '20:00'], TX: ['09:00', '21:00'] };

export function contactTimezone(contact, settings = getSettings()) {
  if (contact.timezone && validTz(contact.timezone)) return contact.timezone;
  const st = stateCode(contact.state);
  return STATE_TZ[st] || settings.defaultTimezone || 'America/Chicago';
}
function stateCode(s) {
  const v = String(s || '').trim();
  if (v.length === 2) return v.toUpperCase();
  return STATE_NAMES[v.toLowerCase()] || '';
}
function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }

function localParts(tz, date = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { dow, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };

export function callingWindow(contact, settings = getSettings()) {
  let [start, endT] = [settings.quietStart || '09:00', settings.quietEnd || '20:00'];
  const strict = STRICT_STATES[stateCode(contact.state)];
  if (strict) { start = toMin(strict[0]) > toMin(start) ? strict[0] : start; endT = toMin(strict[1]) < toMin(endT) ? strict[1] : endT; }
  return { start, end: endT, tz: contactTimezone(contact, settings) };
}

export function withinCallingWindow(contact, date = new Date(), settings = getSettings()) {
  const w = callingWindow(contact, settings);
  const { dow, minutes } = localParts(w.tz, date);
  const days = settings.allowedDays || [1, 2, 3, 4, 5, 6];
  const ok = days.includes(dow) && minutes >= toMin(w.start) && minutes < toMin(w.end);
  return { ok, ...w, localDay: dow, localMinutes: minutes };
}

export function isSuppressed(phone) {
  return !!db.prepare('SELECT 1 FROM suppression WHERE phone = ?').get(phone);
}
export function suppress(phone, reason, source = 'manual') {
  if (!phone) return;
  db.prepare('INSERT INTO suppression (phone, reason, source) VALUES (?,?,?) ON CONFLICT(phone) DO UPDATE SET reason = excluded.reason').run(phone, reason, source);
}

function recentOutreach(contact, campaignId, days) {
  return db.prepare(`
    SELECT cc.campaign_id, c.name, cc.sent_at FROM campaign_contacts cc
    JOIN campaigns c ON c.id = cc.campaign_id
    JOIN contacts k ON k.id = cc.contact_id
    WHERE (cc.contact_id = ? OR k.phone = ?) AND cc.campaign_id != ?
      AND cc.delivery_status IN ('sent','delivered','handed_off','sending','queued')
      AND (cc.sent_at IS NULL OR cc.sent_at >= datetime('now', ?))
    LIMIT 1`).get(contact.id, contact.phone, campaignId ?? -1, `-${Number(days) || 90} days`);
}

// channel: 'voice' | 'sms'. Returns { status: ok|warn|blocked, notes: [{level, code, msg}] }
export function checkContact(contact, { channel = 'voice', campaignId = null, settings = getSettings() } = {}) {
  const notes = [];
  const block = (code, msg) => notes.push({ level: 'block', code, msg });
  const warn = (code, msg) => notes.push({ level: 'warn', code, msg });
  const tags = (contact.tags || []).map((t) => String(t).toLowerCase());
  const dndCh = contact.dnd_channels || {};

  if (settings.globalStop) block('global_stop', 'Global campaign stop is ON');
  if (!contact.phone) block('no_phone', 'No phone number');
  if (contact.phone && isSuppressed(contact.phone)) block('suppressed', 'Number is on the suppression list');
  if (contact.dnd) block('dnd', 'Contact has DND enabled in GHL');
  if (channel === 'voice' && (dndCh.Call === 'active' || dndCh.Voicemail === 'active')) block('dnd_call', 'DND active for calls/voicemail');
  if (channel === 'sms' && dndCh.SMS === 'active') block('dnd_sms', 'DND active for SMS');
  const optTag = (settings.optOutTags || []).find((t) => tags.includes(String(t).toLowerCase()));
  if (optTag) block('opt_out_tag', `Opt-out tag "${optTag}"`);

  if (channel === 'voice') {
    if (!contact.consent_voice) {
      if (settings.requireVoiceConsentAll) block('no_consent', 'No documented consent for prerecorded/AI voice messages');
      else if (contact.line_type === 'mobile' && settings.requireVoiceConsentForMobile) block('no_consent_mobile', 'Mobile number without prior express written consent');
      else if (contact.line_type === 'unknown' && settings.blockUnknownLineType) block('unknown_line', 'Line type unknown and no consent on file (could be mobile)');
      else warn('no_consent', 'No consent record on file; confirm legal basis before sending');
    }
  } else if (!contact.consent_sms) {
    block('no_sms_consent', 'No documented consent for marketing SMS');
  }

  const dup = recentOutreach(contact, campaignId, settings.dedupeDays);
  if (dup) block('duplicate', `Already contacted in campaign "${dup.name}" within ${settings.dedupeDays} days`);
  if (!settings.callbackNumber) warn('no_callback', 'No callback number configured for sender identification');

  const status = notes.some((n) => n.level === 'block') ? 'blocked' : notes.length ? 'warn' : 'ok';
  return { status, notes };
}
