// GoHighLevel (LeadConnector) API v2 client using a Private Integration token.
// Docs: https://highlevel.stoplight.io/docs/integrations
// Required token scopes: contacts.readonly, contacts.write (only for tags/fields
// write-back you enable), locations.readonly, locations/customFields.readonly,
// locations/tags.readonly, opportunities.readonly, conversations.readonly,
// conversations/message.write.
import { config } from '../../config.js';

let lastCalls = [];
async function throttle() {
  // GHL burst limit is 100 requests / 10 s per location; stay well under it.
  const now = Date.now();
  lastCalls = lastCalls.filter((t) => now - t < 10_000);
  if (lastCalls.length >= 60) await new Promise((r) => setTimeout(r, 10_000 - (now - lastCalls[0])));
  lastCalls.push(Date.now());
}

export function ghlConfigured() { return !!(config.ghl.token && config.ghl.locationId); }

export async function ghl(method, path, { query, body } = {}, attempt = 0) {
  if (!ghlConfigured()) throw Object.assign(new Error('GoHighLevel is not configured. Add GHL_PRIVATE_TOKEN and GHL_LOCATION_ID to .env'), { status: 412 });
  await throttle();
  const url = new URL(config.ghl.baseUrl + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.ghl.token}`,
      Version: config.ghl.apiVersion,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (r.status === 429 && attempt < 3) {
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    return ghl(method, path, { query, body }, attempt + 1);
  }
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.message ? (Array.isArray(data.message) ? data.message.join('; ') : data.message) : r.statusText;
    throw Object.assign(new Error(`GHL ${method} ${path} failed (${r.status}): ${msg}`), { status: r.status });
  }
  return data;
}

const loc = () => config.ghl.locationId;

export async function testConnection() {
  const d = await ghl('GET', `/locations/${loc()}`);
  return { ok: true, name: d.location?.name || d.name || 'Connected', locationId: loc() };
}

export async function listTags() {
  const d = await ghl('GET', `/locations/${loc()}/tags`);
  return (d.tags || []).map((t) => t.name).sort();
}

export async function listCustomFields() {
  const d = await ghl('GET', `/locations/${loc()}/customFields`, { query: { model: 'contact' } });
  return (d.customFields || []).map((f) => ({ id: f.id, name: f.name, key: (f.fieldKey || '').replace(/^contact\./, ''), dataType: f.dataType }));
}

export async function listPipelines() {
  const d = await ghl('GET', '/opportunities/pipelines', { query: { locationId: loc() } });
  return (d.pipelines || []).map((p) => ({ id: p.id, name: p.name, stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name })) }));
}

// Map contactId -> "Pipeline › Stage" for pipeline-stage filtering.
export async function opportunityStages(pipelines) {
  const stageName = {};
  for (const p of pipelines) for (const s of p.stages) stageName[s.id] = `${p.name} › ${s.name}`;
  const map = {};
  for (const p of pipelines) {
    let page = 1;
    for (;;) {
      const d = await ghl('GET', '/opportunities/search', { query: { location_id: loc(), pipeline_id: p.id, limit: 100, page } });
      for (const o of d.opportunities || []) {
        const cid = o.contactId || o.contact?.id;
        if (cid) map[cid] = stageName[o.pipelineStageId] || p.name;
      }
      if (!d.opportunities?.length || d.opportunities.length < 100 || page >= 50) break;
      page++;
    }
  }
  return map;
}

// Pull contacts page by page. Uses the Search API (supports tag filters);
// falls back to the older list endpoint if the token lacks search access.
export async function* iterateContacts({ tag, query, max = 5000 } = {}) {
  let fetched = 0;
  try {
    let page = 1;
    for (;;) {
      const body = { locationId: loc(), page, pageLimit: 100 };
      if (query) body.query = query;
      if (tag) body.filters = [{ field: 'tags', operator: 'contains', value: [tag] }];
      const d = await ghl('POST', '/contacts/search', { body });
      const list = d.contacts || [];
      for (const c of list) { yield c; if (++fetched >= max) return; }
      if (list.length < 100) return;
      page++;
    }
  } catch (err) {
    if (fetched > 0 || ![401, 403, 404, 422].includes(err.status)) throw err;
  }
  let startAfterId, startAfter;
  for (;;) {
    const d = await ghl('GET', '/contacts/', { query: { locationId: loc(), limit: 100, startAfterId, startAfter, query } });
    const list = d.contacts || [];
    for (const c of list) {
      if (tag && !(c.tags || []).includes(tag)) continue;
      yield c; if (++fetched >= max) return;
    }
    if (list.length < 100 || !d.meta?.startAfterId) return;
    ({ startAfterId, startAfter } = d.meta);
  }
}

export function normalizeGhlContact(c, fieldsById = {}) {
  const custom = {};
  for (const f of c.customFields || c.customField || []) {
    const key = fieldsById[f.id]?.key || f.key || f.id;
    custom[key] = f.value ?? f.field_value ?? f.fieldValue;
  }
  const dndChannels = {};
  for (const [ch, v] of Object.entries(c.dndSettings || {})) if (v?.status) dndChannels[ch] = v.status;
  return {
    external_id: c.id,
    first_name: c.firstName || c.firstNameRaw || (c.contactName || '').split(' ')[0] || '',
    last_name: c.lastName || c.lastNameRaw || '',
    business_name: c.companyName || c.businessName || '',
    email: c.email || '',
    phone: c.phone || '',
    city: c.city || '',
    state: c.state || '',
    timezone: c.timezone || '',
    website: c.website || '',
    tags: c.tags || [],
    custom_fields: custom,
    dnd: c.dnd ? 1 : 0,
    dnd_channels: dndChannels,
    raw: c,
  };
}

export async function sendSms(contactId, message) {
  const d = await ghl('POST', '/conversations/messages', { body: { type: 'SMS', contactId, message } });
  return { messageId: d.messageId || d.id, conversationId: d.conversationId };
}

export async function addTags(contactId, tags) {
  return ghl('POST', `/contacts/${contactId}/tags`, { body: { tags } });
}

export async function setCustomField(contactId, key, value) {
  return ghl('PUT', `/contacts/${contactId}`, { body: { customFields: [{ key, field_value: value }] } });
}

export async function addNote(contactId, body) {
  return ghl('POST', `/contacts/${contactId}/notes`, { body: { body } });
}
