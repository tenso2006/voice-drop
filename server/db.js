// SQLite persistence using Node's built-in driver (no native build step).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.join(config.dataDir, 'audio'), { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(config.dataDir, 'voicedrop.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Local cache of CRM contacts (GHL or CSV). Source data is never written back
-- to the CRM unless the user explicitly enables it.
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,              -- ghl:<id> or csv:<hash>
  source TEXT NOT NULL,             -- ghl | csv
  external_id TEXT,
  first_name TEXT, last_name TEXT, business_name TEXT, email TEXT, phone TEXT,
  city TEXT, state TEXT, timezone TEXT, website TEXT,
  industry TEXT,                    -- detected or overridden industry key
  industry_source TEXT,             -- auto | manual
  tags TEXT DEFAULT '[]',           -- JSON array
  custom_fields TEXT DEFAULT '{}',  -- JSON object
  dnd INTEGER DEFAULT 0,
  dnd_channels TEXT DEFAULT '{}',   -- JSON {Call:'active', SMS:'active', ...}
  line_type TEXT,                   -- mobile | landline | voip | unknown
  consent_voice INTEGER DEFAULT 0,  -- documented consent for prerecorded voice
  consent_sms INTEGER DEFAULT 0,
  consent_note TEXT,
  pipeline_stage TEXT,
  raw TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

CREATE TABLE IF NOT EXISTS suppression (
  phone TEXT PRIMARY KEY, reason TEXT, source TEXT, created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|scripts_ready|audio_ready|scheduled|running|paused|completed|stopped
  options TEXT NOT NULL DEFAULT '{}',   -- tone, duration, offer, cta, personalization, voice, sms...
  scheduled_at TEXT,
  launched_at TEXT, completed_at TEXT,
  approved_by TEXT, approval_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id),
  industry TEXT,
  script TEXT, script_source TEXT,     -- template | ai | edited
  script_status TEXT DEFAULT 'pending', -- pending|draft|approved|rejected
  sms_text TEXT,
  audio_id INTEGER REFERENCES audio_files(id),
  compliance_status TEXT,              -- ok | blocked | warn
  compliance_notes TEXT DEFAULT '[]',
  delivery_status TEXT DEFAULT 'not_sent', -- not_sent|queued|sending|sent|delivered|handed_off|failed|skipped|manual
  delivery_attempts INTEGER DEFAULT 0,
  provider TEXT, provider_message_id TEXT, delivery_error TEXT,
  sent_at TEXT, delivered_at TEXT,
  sms_status TEXT DEFAULT 'not_sent', sms_message_id TEXT, sms_sent_at TEXT,
  reply_category TEXT, lead_score INTEGER,
  UNIQUE(campaign_id, contact_id)
);

CREATE TABLE IF NOT EXISTS base_scripts (  -- one AI-written base per industry+options, reused
  hash TEXT PRIMARY KEY, industry TEXT, options TEXT, template TEXT, sms_template TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audio_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT UNIQUE NOT NULL,           -- sha256(provider|model|voice|speed|style|script)
  provider TEXT, model TEXT, voice TEXT, speed REAL, style TEXT,
  script TEXT, characters INTEGER, duration_sec REAL, bytes INTEGER,
  file TEXT, cost REAL DEFAULT 0, reused_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deliveries (    -- every attempt / provider event
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_contact_id INTEGER REFERENCES campaign_contacts(id) ON DELETE CASCADE,
  kind TEXT,                            -- voicedrop | sms
  provider TEXT, provider_message_id TEXT, status TEXT, detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT, campaign_contact_id INTEGER,
  body TEXT NOT NULL, direction TEXT DEFAULT 'inbound',
  category TEXT, confidence REAL, classified_by TEXT,
  suggested_reply TEXT, status TEXT DEFAULT 'new',  -- new|replied|ignored
  external_id TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER, category TEXT NOT NULL, -- ai | tts | delivery | sms
  provider TEXT, units REAL, unit TEXT, amount REAL NOT NULL, note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prospect_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT, industry TEXT, location TEXT, requests INTEGER DEFAULT 0, results INTEGER DEFAULT 0,
  cost REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);

-- Businesses found via Google Places. Only business contact info + our own
-- score is kept; review text is used transiently and never stored.
CREATE TABLE IF NOT EXISTS prospects (
  place_id TEXT PRIMARY KEY,
  search_id INTEGER, name TEXT, phone TEXT, website TEXT, address TEXT, city TEXT, state TEXT, zip TEXT,
  rating REAL, review_count INTEGER, weekday_text TEXT, primary_type TEXT, industry TEXT, maps_url TEXT,
  score INTEGER DEFAULT 0, reasons TEXT DEFAULT '[]', signals TEXT DEFAULT '{}',
  test_call TEXT,                    -- answered | rang_out | voicemail (manual verification)
  test_call_at TEXT,
  status TEXT DEFAULT 'new',         -- new | added | dismissed
  contact_id TEXT, ghl_contact_id TEXT, assigned_to TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prospects_search ON prospects(search_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT DEFAULT 'user', action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

export const json = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };

export function audit(action, entity = null, entityId = null, detail = null, actor = 'user') {
  db.prepare('INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?,?,?,?,?)')
    .run(actor, action, entity, entityId == null ? null : String(entityId), detail == null ? null : JSON.stringify(detail));
}

export function recordCost({ campaignId = null, category, provider, units = null, unit = null, amount, note = null }) {
  if (!amount && amount !== 0) return;
  db.prepare('INSERT INTO costs (campaign_id, category, provider, units, unit, amount, note) VALUES (?,?,?,?,?,?,?)')
    .run(campaignId, category, provider, units, unit, Number(amount.toFixed(6)), note);
}

const DEFAULT_SETTINGS = {
  globalStop: false,
  quietStart: config.compliance.quietStart,
  quietEnd: config.compliance.quietEnd,
  defaultTimezone: config.compliance.defaultTimezone,
  allowedDays: [1, 2, 3, 4, 5, 6],          // Mon–Sat
  requireVoiceConsentForMobile: true,       // TCPA: prerecorded/AI voice to mobile needs prior express written consent
  requireVoiceConsentAll: false,
  blockUnknownLineType: true,
  consentTag: 'voicedrop-consent',
  consentField: 'voicedrop_consent',
  optOutTags: ['dnd', 'opt-out', 'unsubscribed', 'do-not-contact'],
  dedupeDays: 90,
  writeBackTags: false,                     // must be explicitly enabled to add tags in GHL
  tagPrefix: 'voicedrop',
  legalReviewAcknowledged: false,
  senderName: config.sender.name,
  senderCompany: config.sender.company,
  callbackNumber: config.sender.callbackNumber,
  demoUrl: config.sender.demoUrl,
  bookingUrl: config.sender.bookingUrl,
  smsFollowupDelayMin: 2,
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = json(r.value, r.value);
  return s;
}

export function saveSettings(patch) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    stmt.run(k, JSON.stringify(v));
  }
  return getSettings();
}

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; }
}
