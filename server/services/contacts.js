// Contact store: syncing from GHL / CSV into the local cache, querying with
// filters, and applying industry detection. Never writes back to the CRM.
import crypto from 'node:crypto';
import { db, json, audit, getSettings } from '../db.js';
import { detectIndustry, INDUSTRIES } from '../data/industries.js';
import * as ghl from '../providers/crm/ghl.js';

export function normalizePhone(p) {
  const raw = String(p || '').trim();
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return '+' + d;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return d ? '+' + d : '';
}

function truthy(v) {
  if (v === true || v === 1) return true;
  return /^(y|yes|true|1|opted[\s-]?in|granted|written)$/i.test(String(v ?? '').trim());
}

function deriveConsent(c, settings) {
  const tags = (c.tags || []).map((t) => String(t).toLowerCase());
  const cf = c.custom_fields || {};
  const voice = c.consent_voice != null ? truthy(c.consent_voice)
    : tags.includes(String(settings.consentTag).toLowerCase()) || truthy(cf[settings.consentField]);
  const sms = c.consent_sms != null ? truthy(c.consent_sms) : voice || tags.includes('sms-consent') || truthy(cf.sms_consent);
  return { voice: voice ? 1 : 0, sms: sms ? 1 : 0 };
}

function deriveLineType(c) {
  const v = String(c.line_type || c.custom_fields?.line_type || c.custom_fields?.phone_type || '').toLowerCase();
  if (/mobile|cell|wireless/.test(v)) return 'mobile';
  if (/land/.test(v)) return 'landline';
  if (/voip/.test(v)) return 'voip';
  return 'unknown';
}

const upsert = () => db.prepare(`
  INSERT INTO contacts (id, source, external_id, first_name, last_name, business_name, email, phone, city, state, timezone, website,
    industry, industry_source, tags, custom_fields, dnd, dnd_channels, line_type, consent_voice, consent_sms, consent_note, pipeline_stage, raw, synced_at)
  VALUES (@id, @source, @external_id, @first_name, @last_name, @business_name, @email, @phone, @city, @state, @timezone, @website,
    @industry, @industry_source, @tags, @custom_fields, @dnd, @dnd_channels, @line_type, @consent_voice, @consent_sms, @consent_note, @pipeline_stage, @raw, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    first_name=excluded.first_name, last_name=excluded.last_name, business_name=excluded.business_name, email=excluded.email,
    phone=excluded.phone, city=excluded.city, state=excluded.state, timezone=excluded.timezone, website=excluded.website,
    industry = CASE WHEN contacts.industry_source = 'manual' THEN contacts.industry ELSE excluded.industry END,
    industry_source = CASE WHEN contacts.industry_source = 'manual' THEN 'manual' ELSE excluded.industry_source END,
    tags=excluded.tags, custom_fields=excluded.custom_fields, dnd=excluded.dnd, dnd_channels=excluded.dnd_channels,
    line_type=excluded.line_type, consent_voice=excluded.consent_voice, consent_sms=excluded.consent_sms,
    consent_note=excluded.consent_note, pipeline_stage=excluded.pipeline_stage, raw=excluded.raw, synced_at=datetime('now')
`);

export function saveContact(source, c) {
  const settings = getSettings();
  const id = `${source}:${c.external_id}`;
  const consent = deriveConsent(c, settings);
  const explicitIndustry = c.industry && c.industry !== 'auto' ? c.industry : null;
  const row = {
    id, source, external_id: String(c.external_id),
    first_name: c.first_name || '', last_name: c.last_name || '', business_name: c.business_name || '',
    email: c.email || '', phone: normalizePhone(c.phone), city: c.city || '', state: c.state || '',
    timezone: c.timezone || '', website: c.website || '',
    industry: explicitIndustry || detectIndustry(c), industry_source: explicitIndustry ? 'manual' : 'auto',
    tags: JSON.stringify(c.tags || []), custom_fields: JSON.stringify(c.custom_fields || {}),
    dnd: c.dnd ? 1 : 0, dnd_channels: JSON.stringify(c.dnd_channels || {}),
    line_type: deriveLineType(c), consent_voice: consent.voice, consent_sms: consent.sms,
    consent_note: c.consent_note || null, pipeline_stage: c.pipeline_stage || null,
    raw: c.raw ? JSON.stringify(c.raw).slice(0, 20000) : null,
  };
  upsert().run(row);
  return id;
}

export async function syncFromGhl({ tag, query, max, withPipelines = true } = {}) {
  const fields = await ghl.listCustomFields().catch(() => []);
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  let stages = {};
  if (withPipelines) {
    const pipes = await ghl.listPipelines().catch(() => []);
    if (pipes.length) stages = await ghl.opportunityStages(pipes).catch(() => ({}));
  }
  let count = 0;
  db.exec('BEGIN');
  try {
    for await (const c of ghl.iterateContacts({ tag, query, max })) {
      const n = ghl.normalizeGhlContact(c, byId);
      n.pipeline_stage = stages[c.id] || null;
      saveContact('ghl', n);
      count++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit('contacts.sync', 'ghl', null, { count, tag: tag || null });
  return { count };
}

// --- CSV --------------------------------------------------------------------
export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((v) => v.trim() !== '')) rows.push(row); }
  return rows;
}

const ALIASES = {
  first_name: ['first_name', 'firstname', 'first name', 'first'],
  last_name: ['last_name', 'lastname', 'last name', 'last'],
  full_name: ['name', 'full name', 'full_name', 'contact name'],
  business_name: ['business_name', 'business', 'company', 'company name', 'companyname', 'business name'],
  phone: ['phone', 'phone number', 'mobile', 'cell', 'phone_number'],
  email: ['email', 'email address'],
  city: ['city'], state: ['state', 'region'], timezone: ['timezone', 'time zone', 'tz'],
  website: ['website', 'url', 'site'], tags: ['tags', 'tag'], industry: ['industry', 'niche', 'category'],
  line_type: ['line_type', 'line type', 'phone type', 'phone_type'],
  consent_voice: ['consent_voice', 'voice consent', 'consent'], consent_sms: ['consent_sms', 'sms consent'],
  consent_note: ['consent_note', 'consent source', 'consent_source'],
  dnd: ['dnd', 'do not call', 'do_not_call'],
};

export function importCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw Object.assign(new Error('CSV needs a header row and at least one contact'), { status: 400 });
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [k, al] of Object.entries(ALIASES)) { const i = header.findIndex((h) => al.includes(h)); if (i >= 0) col[k] = i; }
  if (col.phone === undefined) throw Object.assign(new Error('CSV must include a phone column'), { status: 400 });
  let imported = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows.slice(1)) {
      const get = (k) => (col[k] !== undefined ? (r[col[k]] || '').trim() : '');
      const phone = normalizePhone(get('phone'));
      if (!phone) { skipped++; continue; }
      let first = get('first_name'), last = get('last_name');
      if (!first && get('full_name')) {
        const parts = get('full_name').split(/\s+/);
        first = parts.shift() || ''; last = parts.join(' ');
      }
      const custom = {};
      header.forEach((h, i) => { if (!Object.values(col).includes(i) && r[i]) custom[h.replace(/\s+/g, '_')] = r[i]; });
      saveContact('csv', {
        external_id: crypto.createHash('sha1').update(phone).digest('hex').slice(0, 16),
        first_name: first, last_name: last, business_name: get('business_name'), email: get('email'), phone,
        city: get('city'), state: get('state'), timezone: get('timezone'), website: get('website'),
        tags: get('tags') ? get('tags').split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
        industry: get('industry') ? matchIndustryKey(get('industry')) : null,
        line_type: get('line_type'), consent_voice: get('consent_voice') || null, consent_sms: get('consent_sms') || null,
        consent_note: get('consent_note') || 'CSV import', dnd: truthy(get('dnd')), custom_fields: custom,
      });
      imported++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  audit('contacts.import_csv', 'csv', null, { imported, skipped });
  return { imported, skipped };
}

function matchIndustryKey(v) {
  const s = v.toLowerCase();
  const exact = INDUSTRIES.find((i) => i.key === s || i.label.toLowerCase() === s);
  if (exact) return exact.key;
  return detectIndustry({ business_name: s }) || 'other';
}

// --- Query --------------------------------------------------------------------
export function hydrate(r) {
  if (!r) return r;
  return { ...r, tags: json(r.tags, []), custom_fields: json(r.custom_fields, {}), dnd_channels: json(r.dnd_channels, {}), raw: undefined };
}

export function queryContacts({ q, tag, industry, stage, source, consent, field, fieldValue, page = 1, pageSize = 50, ids } = {}) {
  const where = []; const args = [];
  if (ids?.length) { where.push(`id IN (${ids.map(() => '?').join(',')})`); args.push(...ids); }
  if (q) { where.push("(first_name || ' ' || last_name || ' ' || business_name || ' ' || email || ' ' || phone || ' ' || city) LIKE ?"); args.push(`%${q}%`); }
  if (tag) { where.push('EXISTS (SELECT 1 FROM json_each(contacts.tags) WHERE lower(value) = lower(?))'); args.push(tag); }
  if (industry) { where.push('industry = ?'); args.push(industry); }
  if (stage) { where.push('pipeline_stage = ?'); args.push(stage); }
  if (source) { where.push('source = ?'); args.push(source); }
  if (consent === 'voice') where.push('consent_voice = 1');
  if (consent === 'none') where.push('consent_voice = 0');
  if (field) {
    if (fieldValue) { where.push('lower(json_extract(custom_fields, ?)) LIKE lower(?)'); args.push(`$."${field}"`, `%${fieldValue}%`); }
    else { where.push("json_extract(custom_fields, ?) IS NOT NULL AND json_extract(custom_fields, ?) != ''"); args.push(`$."${field}"`, `$."${field}"`); }
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM contacts ${w}`).get(...args).n;
  const size = Math.min(Number(pageSize) || 50, 500);
  const rows = db.prepare(`SELECT * FROM contacts ${w} ORDER BY business_name COLLATE NOCASE, first_name LIMIT ? OFFSET ?`)
    .all(...args, size, (Math.max(1, Number(page)) - 1) * size).map(hydrate);
  const allIds = db.prepare(`SELECT id FROM contacts ${w}`).all(...args).map((r) => r.id);
  return { total, page: Number(page), pageSize: size, rows, allIds };
}

export function facets() {
  return {
    tags: db.prepare('SELECT value tag, COUNT(*) n FROM contacts, json_each(contacts.tags) GROUP BY lower(value) ORDER BY n DESC LIMIT 300').all(),
    industries: db.prepare('SELECT industry, COUNT(*) n FROM contacts GROUP BY industry ORDER BY n DESC').all(),
    stages: db.prepare('SELECT pipeline_stage stage, COUNT(*) n FROM contacts WHERE pipeline_stage IS NOT NULL GROUP BY pipeline_stage ORDER BY stage').all(),
    fields: db.prepare('SELECT DISTINCT key FROM contacts, json_each(contacts.custom_fields) ORDER BY key LIMIT 200').all().map((r) => r.key),
    total: db.prepare('SELECT COUNT(*) n FROM contacts').get().n,
  };
}

export function getContact(id) { return hydrate(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id)); }

// Local-only edits (industry override, consent record). Never pushed to GHL.
export function updateContactLocal(id, patch) {
  const c = getContact(id);
  if (!c) return null;
  if (patch.industry) db.prepare("UPDATE contacts SET industry = ?, industry_source = 'manual' WHERE id = ?").run(patch.industry, id);
  if (patch.consent_voice !== undefined || patch.consent_sms !== undefined) {
    db.prepare('UPDATE contacts SET consent_voice = COALESCE(?, consent_voice), consent_sms = COALESCE(?, consent_sms), consent_note = COALESCE(?, consent_note) WHERE id = ?')
      .run(patch.consent_voice === undefined ? null : patch.consent_voice ? 1 : 0, patch.consent_sms === undefined ? null : patch.consent_sms ? 1 : 0, patch.consent_note ?? null, id);
    audit('consent.update', 'contact', id, { voice: patch.consent_voice, sms: patch.consent_sms, note: patch.consent_note });
  }
  if (patch.line_type) db.prepare('UPDATE contacts SET line_type = ? WHERE id = ?').run(patch.line_type, id);
  return getContact(id);
}
