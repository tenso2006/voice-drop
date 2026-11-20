// Prospecting: Google Places search (mocked), opportunity scoring, website
// signals, test-call verification, call script, add to contacts, send to GHL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-pros-'));
Object.assign(process.env, {
  NODE_ENV: 'test', DATA_DIR: tmp, DB_PATH: path.join(tmp, 'p.db'), APP_PASSWORD: '', AI_PROVIDER: 'template',
  GOOGLE_PLACES_API_KEY: 'test-key', GHL_PRIVATE_TOKEN: 'pit-test', GHL_LOCATION_ID: 'loc123',
});

const place = (id, name, extra = {}) => ({
  id, displayName: { text: name }, nationalPhoneNumber: '(512) 555-01' + id.slice(-2), formattedAddress: `1 Main St, Austin, TX 78701, USA`,
  addressComponents: [{ longText: 'Austin', shortText: 'Austin', types: ['locality'] }, { longText: 'Texas', shortText: 'TX', types: ['administrative_area_level_1'] }, { longText: '78701', shortText: '78701', types: ['postal_code'] }],
  rating: 4.5, userRatingCount: 80, businessStatus: 'OPERATIONAL', primaryType: 'plumber', googleMapsUri: `https://maps.google.com/?cid=${id}`,
  regularOpeningHours: { weekdayDescriptions: ['Monday: 8:00 AM – 5:00 PM', 'Tuesday: 8:00 AM – 5:00 PM', 'Wednesday: 8:00 AM – 5:00 PM', 'Thursday: 8:00 AM – 5:00 PM', 'Friday: 8:00 AM – 5:00 PM', 'Saturday: Closed', 'Sunday: Closed'] },
  reviews: [], ...extra,
});

const calls = { places: [], ghl: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://places.googleapis.com')) {
    const body = JSON.parse(opts.body);
    calls.places.push({ body, mask: opts.headers['X-Goog-FieldMask'], key: opts.headers['X-Goog-Api-Key'] });
    if (!body.pageToken) return json({ nextPageToken: 'p2', places: [
      place('pl01', 'Rapid Rooter Plumbing', { reviews: [{ text: { text: 'Great work but they never answer the phone, had to call 4 times.' } }, { text: { text: 'Left several voicemails before anyone called back.' } }], userRatingCount: 220, websiteUri: 'https://rapidrooter.test/' }),
      place('pl02', 'Booked Solid Plumbing', { websiteUri: 'https://bookedsolid.test/' }),
      place('pl03', 'No Site Plumbing', { userRatingCount: 9 }),
    ] });
    return json({ places: [place('pl04', 'Closed Down Plumbing', { businessStatus: 'CLOSED_PERMANENTLY' }), place('pl05', 'Phoneless Plumbing', { nationalPhoneNumber: undefined })] });
  }
  if (u.startsWith('https://rapidrooter.test')) return new Response('<html><body>Call us today!</body></html>', { headers: { 'content-type': 'text/html' } });
  if (u.startsWith('https://bookedsolid.test')) return new Response('<html><script src="https://widgets.leadconnectorhq.com/chat"></script><a href="https://calendly.com/x">Book now</a></html>', { headers: { 'content-type': 'text/html' } });
  if (u.startsWith('https://services.leadconnectorhq.com')) {
    calls.ghl.push({ url: u, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/contacts/upsert')) return json({ contact: { id: 'ghl_' + calls.ghl.length } });
    if (u.includes('/notes')) return json({ note: { id: 'n1' } });
    if (u.includes('/users/')) return json({ users: [{ id: 'u1', name: 'Sam SDR', email: 'sam@x.test' }] });
    return json({});
  }
  return realFetch(url, opts);
};

const { app } = await import('../server/index.js');
let server, base;
before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
const call = async (method, p, body) => {
  const r = await realFetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
};

test('prospecting: search, score, verify, script, add, send to GHL', async () => {
  let r = await call('POST', '/api/prospects/search', { industry: 'plumbing', location: '78701', pages: 3 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.requests, 2, 'stops when Google returns no nextPageToken');
  assert.equal(r.data.results, 4, 'closed business skipped');
  assert.equal(calls.places[0].body.textQuery, 'plumber near 78701');
  assert.equal(calls.places[0].key, 'test-key');
  assert.match(calls.places[0].mask, /places\.reviews/);
  assert.equal(calls.places[1].body.pageToken, 'p2');

  const list = (await call('GET', '/api/prospects')).data;
  const by = Object.fromEntries(list.map((p) => [p.name, p]));
  assert.equal(list[0].name, 'Rapid Rooter Plumbing', 'highest score first');
  const rr = by['Rapid Rooter Plumbing'];
  assert.ok(rr.score >= 80, `score ${rr.score}`);
  assert.ok(rr.reasons.some((x) => /2 recent Google reviews mention trouble reaching/.test(x)));
  assert.ok(rr.reasons.some((x) => /Closed weekends/.test(x)));
  assert.ok(rr.reasons.some((x) => /no online booking or chat/i.test(x)));
  assert.equal(rr.industry, 'plumbing');
  assert.equal(rr.city, 'Austin'); assert.equal(rr.state, 'TX'); assert.equal(rr.zip, '78701');
  const bs = by['Booked Solid Plumbing'];
  assert.ok(bs.score < rr.score);
  assert.ok(bs.reasons.some((x) => /chat\/text widget/.test(x)) && bs.reasons.some((x) => /online booking/.test(x)));
  assert.ok(by['No Site Plumbing'].reasons.some((x) => /No website/.test(x)));
  assert.equal(by['Phoneless Plumbing'].score, 0);
  // review text is never persisted
  const raw = fs.readFileSync(path.join(tmp, 'p.db')).toString('latin1');
  assert.ok(!raw.includes('had to call 4 times'));

  // Test call verification boosts score and changes the script hook
  const before = by['No Site Plumbing'].score;
  r = await call('POST', `/api/prospects/pl03/test-call`, { result: 'rang_out' });
  assert.equal(r.data.score, Math.min(100, before + 30));
  assert.match(r.data.reasons[0], /Verified: test call rang out/);
  r = await call('POST', `/api/prospects/pl03/test-call`, { result: 'answered' });
  assert.equal(r.data.score, Math.max(0, before - 10), 'switching result does not double count');
  await call('POST', `/api/prospects/pl03/test-call`, { result: 'rang_out' });
  const detail = (await call('GET', '/api/prospects/pl03')).data;
  assert.match(detail.script.hook, /it rang out/);
  assert.match(detail.script.opener, /Tenzin with Lobsang Solutions/);
  assert.match(detail.script.voicemail, /^Hi, this is Tenzin with Lobsang Solutions/);
  assert.match((await call('GET', '/api/prospects/pl01')).data.script.hook, /Google reviews/);

  // Add to local contacts (voice drops stay blocked: no consent)
  r = await call('POST', '/api/prospects/add-contacts', { ids: ['pl03', 'pl05'] });
  assert.equal(r.data.added, 1, 'phoneless skipped');
  const c = (await call('GET', '/api/contacts/places%3Apl03')).data;
  assert.equal(c.business_name, 'No Site Plumbing');
  assert.equal(c.industry, 'plumbing');
  assert.equal(c.compliance.status, 'blocked');

  // GHL users + send
  assert.equal((await call('GET', '/api/ghl/users')).data[0].name, 'Sam SDR');
  r = await call('POST', '/api/prospects/send-ghl', { ids: ['pl01', 'pl05'], assignedTo: 'u1' });
  assert.equal(r.data.sent, 1);
  assert.equal(r.data.failed.length, 1);
  const up = calls.ghl.find((x) => x.url.includes('/contacts/upsert'));
  assert.equal(up.body.locationId, 'loc123');
  assert.equal(up.body.assignedTo, 'u1');
  assert.deepEqual(up.body.tags, ['voicedrop-prospect', 'industry-plumbing', 'score-hot']);
  const note = calls.ghl.find((x) => x.url.includes('/notes'));
  assert.match(note.body.body, /CALL SCRIPT: Rapid Rooter Plumbing/);
  assert.match(note.body.body, /OBJECTIONS/);
  const listed = (await call('GET', '/api/prospects?status=added')).data.map((p) => p.place_id).sort();
  assert.deepEqual(listed, ['pl01', 'pl03']);

  // Cost tracked under its own category
  const costs = (await call('GET', '/api/costs')).data;
  assert.ok(costs.byCategory.some((x) => x.category === 'leads' && x.amount > 0));
  const meta = (await call('GET', '/api/prospects/meta')).data;
  assert.equal(meta.usage.requests, 2);
});

test('prospecting requires a location and a key', async () => {
  const r = await call('POST', '/api/prospects/search', { industry: 'hvac' });
  assert.equal(r.status, 400);
});
