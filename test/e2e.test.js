// End-to-end test of the full MVP + Phase 2 flow using in-process mock
// providers (no network, no real sends).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-test-'));
Object.assign(process.env, {
  NODE_ENV: 'test', DATA_DIR: tmp, DB_PATH: path.join(tmp, 'test.db'), APP_PASSWORD: '', AI_PROVIDER: 'template',
  TTS_PROVIDER: 'test', VOICEDROP_PROVIDER: 'test', PUBLIC_BASE_URL: 'https://voicedrop.test', WEBHOOK_SECRET: 'sekret',
  GHL_PRIVATE_TOKEN: '', GHL_LOCATION_ID: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', ELEVENLABS_API_KEY: '',
});

const { app } = await import('../server/index.js');
const { registerTTSProvider } = await import('../server/providers/tts/index.js');
const { registerDeliveryProvider } = await import('../server/providers/delivery/index.js');
const { tick } = await import('../server/services/campaigns.js');
const { INDUSTRIES, detectIndustry } = await import('../server/data/industries.js');
const { buildTemplate, renderScript, lintScript } = await import('../server/services/scriptEngine.js');
const { ruleClassify } = await import('../server/services/replies.js');
const { withinCallingWindow } = await import('../server/services/compliance.js');

// A Wednesday at 18:00 UTC is inside every US state's calling window.
const NOON = new Date('2026-11-18T18:00:00Z');
let ttsCalls = 0; const sent = [];
// 128 kbps MPEG-1 Layer III frame header + padding = a tiny "MP3"
const fakeMp3 = (n) => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(16000 * n)]);
registerTTSProvider('test', {
  label: 'Test TTS', configured: () => true, model: () => 'mock',
  voices: [{ id: 'v1', name: 'Test', gender: 'male', note: '' }],
  async synthesize({ text }) { ttsCalls++; return { buffer: fakeMp3(Math.max(1, Math.round(text.length / 100))), model: 'mock' }; },
});
registerDeliveryProvider('test', {
  label: 'Test delivery', description: 'mock', configured: () => true, canSend: true, needsPublicAudio: true,
  async send({ to, audioUrl, campaignContactId }) {
    assert.match(audioUrl, /^https:\/\/voicedrop\.test\/media\/[a-f0-9]{64}\.mp3$/);
    sent.push(to); return { providerMessageId: `t_${campaignContactId}`, status: 'sent' };
  },
  parseCallback: (b) => [{ providerMessageId: b.id, status: b.status, detail: b.status }],
});

let server, base;
before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, p, body, raw = false) {
  const r = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (raw) return r;
  const data = await r.json();
  return { status: r.status, data };
}

test('industry engine produces natural, compliant scripts for every industry/option', () => {
  const settings = { senderName: 'Tenzin', senderCompany: 'Lobsang Solutions', callbackNumber: '+15125550100' };
  for (const ind of INDUSTRIES) {
    for (const tone of ['friendly', 'conversational', 'professional', 'curiosity', 'bold']) {
      for (const duration of [15, 20, 30, 45]) {
        for (const offer of ['voice', 'text', 'both']) {
          const o = { tone, duration, offer, cta: 'reply_text', personalization: 'advanced', includeCallback: true };
          const s = renderScript(buildTemplate(ind.key, o, `${ind.key}${tone}`), { first_name: 'Mike', business_name: 'Acme', city: '' }, settings, o);
          const lint = lintScript(s, o, settings);
          assert.ok(s.startsWith('Hey Mike, this is Tenzin with Lobsang Solutions.') || s.startsWith('Hi Mike'), s);
          assert.ok(!/\{[a-z_]+\}/.test(s), `placeholder left: ${s}`);
          assert.ok(!/\s[,.?]/.test(s), `spacing: ${s}`);
          assert.deepEqual(lint.issues.filter((i) => !i.startsWith('Long') && !i.startsWith('Short')), [], `${ind.key}/${tone}/${duration}: ${lint.issues} :: ${s}`);
          assert.match(s, /5 1 2, 5 5 5, 0 1 0 0/);
        }
      }
    }
  }
});

test('industry detection uses existing CRM data', () => {
  assert.equal(detectIndustry({ business_name: 'Fresh Cutz Barbershop' }), 'barbershop');
  assert.equal(detectIndustry({ business_name: 'Cool Breeze Heating & Air' }), 'hvac');
  assert.equal(detectIndustry({ business_name: 'Summit Roofing' }), 'roofing');
  assert.equal(detectIndustry({ business_name: 'Smith LLC', tags: ['dentist'] }), 'dental');
  assert.equal(detectIndustry({ business_name: 'Smith LLC' }), 'other');
});

test('reply rules classify common replies without AI', () => {
  assert.equal(ruleClassify('STOP').category, 'opt_out');
  assert.equal(ruleClassify('please remove me from your list').category, 'opt_out');
  assert.equal(ruleClassify('How much does it cost?').category, 'pricing');
  assert.equal(ruleClassify('Sure, send me the example').category, 'demo');
  assert.equal(ruleClassify('We already have online booking').category, 'already_has');
  assert.equal(ruleClassify('Not interested, thanks').category, 'not_interested');
  assert.equal(ruleClassify('Busy right now, try next month').category, 'later');
});

test('calling window respects time zone and allowed days', () => {
  const s = { quietStart: '09:00', quietEnd: '20:00', allowedDays: [1, 2, 3, 4, 5], defaultTimezone: 'America/Chicago' };
  // 2026-11-18 is a Wednesday. 15:00Z = 09:00 CST (open); 13:00Z = 07:00 CST (closed)
  assert.equal(withinCallingWindow({ state: 'TX' }, new Date('2026-11-18T15:00:00Z'), s).ok, true);
  assert.equal(withinCallingWindow({ state: 'TX' }, new Date('2026-11-18T13:00:00Z'), s).ok, false);
  assert.equal(withinCallingWindow({ state: 'CA' }, new Date('2026-11-18T16:30:00Z'), s).ok, false); // 08:30 PST
  assert.equal(withinCallingWindow({ state: 'TX' }, new Date('2026-11-22T18:00:00Z'), s).ok, false); // Sunday
});

test('full campaign flow: import → scripts → approve → audio (cached) → launch → deliver → reply', async () => {
  // Open the calling window for the test run
  await call('PATCH', '/api/settings', { quietStart: '00:00', quietEnd: '23:59', allowedDays: [0, 1, 2, 3, 4, 5, 6], callbackNumber: '+15125550100' });

  // CSV import
  const csv = fs.readFileSync(new URL('../public/sample-contacts.csv', import.meta.url), 'utf8');
  let r = await call('POST', '/api/contacts/import', { csv });
  assert.equal(r.data.imported, 8);
  const list = (await call('GET', '/api/contacts?pageSize=100')).data;
  assert.equal(list.total, 8);
  const byName = Object.fromEntries(list.rows.map((c) => [c.first_name, c]));
  assert.equal(byName.Marcus.industry, 'barbershop');
  assert.equal(byName.Sarah.industry, 'real_estate');
  assert.equal(byName.Priya.industry, 'hvac');

  // Filters
  assert.equal((await call('GET', '/api/contacts?tag=storm')).data.total, 1);
  assert.equal((await call('GET', '/api/contacts?consent=voice')).data.total, 6);

  // Create campaign + generate scripts
  r = await call('POST', '/api/campaigns', { name: 'Test Run', options: { duration: 30, tone: 'curiosity' }, contactIds: list.allIds });
  assert.equal(r.status, 201);
  const cid = r.data.id;
  r = await call('POST', `/api/campaigns/${cid}/generate`, {});
  assert.equal(r.data.generated, 8);
  let rows = (await call('GET', `/api/campaigns/${cid}`)).data.rows;
  const blocked = rows.filter((x) => x.compliance_status === 'blocked').map((x) => x.first_name).sort();
  assert.deepEqual(blocked, ['Dale', 'Tom']); // unknown-line & mobile without consent
  const marcus = rows.find((x) => x.first_name === 'Marcus');
  assert.match(marcus.script, /^Hey Marcus, this is Tenzin with Lobsang Solutions\./);
  assert.match(marcus.script, /fade|cut|barber|chair/i);
  assert.match(marcus.sms_text, /Reply STOP/);

  // Audio refuses unapproved scripts
  r = await call('POST', `/api/campaigns/${cid}/audio`, {});
  assert.equal(r.data.created, 0);

  // Approving a blocked contact is refused
  const dale = rows.find((x) => x.first_name === 'Dale');
  r = await call('POST', `/api/campaigns/${cid}/approve`, { ids: [dale.id] });
  assert.deepEqual(r.data.refused, [dale.id]);

  // Approve eligible
  const eligible = rows.filter((x) => x.compliance_status !== 'blocked').map((x) => x.id);
  r = await call('POST', `/api/campaigns/${cid}/approve`, { ids: eligible });
  assert.equal(r.data.changed, 6);

  // Estimate before audio
  let est = (await call('GET', `/api/campaigns/${cid}/estimate`)).data;
  assert.equal(est.eligible, 6);
  assert.ok(est.estimated.delivery > 0 && est.estimated.total > 0);

  // Audio generation + cache
  r = await call('POST', `/api/campaigns/${cid}/audio`, {});
  assert.equal(r.data.created, 6);
  assert.equal(ttsCalls, 6);
  r = await call('POST', `/api/campaigns/${cid}/audio`, {});
  assert.equal(r.data.unchanged, 6);
  assert.equal(ttsCalls, 6, 'no re-synthesis when nothing changed');

  // Editing a script resets approval; re-approve → 1 new audio
  r = await call('PATCH', `/api/campaigns/${cid}/rows/${marcus.id}`, { script: marcus.script + ' Have a great day.' });
  assert.equal(r.data.script_status, 'draft');
  await call('POST', `/api/campaigns/${cid}/approve`, { ids: [marcus.id] });
  r = await call('POST', `/api/campaigns/${cid}/audio`, {});
  assert.equal(r.data.created, 1);
  assert.equal(ttsCalls, 7);

  // Media served publicly
  rows = (await call('GET', `/api/campaigns/${cid}`)).data.rows;
  const audioRes = await call('GET', rows.find((x) => x.audio_url).audio_url, null, true);
  assert.equal(audioRes.headers.get('content-type'), 'audio/mpeg');

  // ZIP download for manual mode
  const zip = await call('GET', `/api/campaigns/${cid}/download`, null, true);
  const zbuf = Buffer.from(await zip.arrayBuffer());
  assert.equal(zbuf.subarray(0, 2).toString(), 'PK');

  // Launch gates
  r = await call('POST', `/api/campaigns/${cid}/launch`, { confirmName: 'Test Run' });
  assert.equal(r.status, 409, 'legal acknowledgement required');
  await call('PATCH', '/api/settings', { legalReviewAcknowledged: true });
  r = await call('POST', `/api/campaigns/${cid}/launch`, { confirmName: 'wrong' });
  assert.equal(r.status, 400, 'typed confirmation required');
  r = await call('POST', `/api/campaigns/${cid}/launch`, { confirmName: 'Test Run' });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'running');

  // Global stop blocks the worker
  await call('POST', '/api/settings/global-stop', { on: true });
  await tick(NOON);
  assert.equal(sent.length, 0);
  await call('POST', '/api/settings/global-stop', { on: false });
  await call('POST', `/api/campaigns/${cid}/resume`);

  // Worker sends (5 per tick at 20/min)
  await tick(NOON); await tick(NOON);
  assert.equal(sent.length, 6);
  rows = (await call('GET', `/api/campaigns/${cid}`)).data.rows;
  assert.equal(rows.filter((x) => x.delivery_status === 'sent').length, 6);
  assert.equal(rows.filter((x) => x.delivery_status === 'skipped').length, 2);

  // Delivery receipt webhook (auth required)
  const target = rows.find((x) => x.delivery_status === 'sent');
  r = await call('POST', '/webhooks/voicedrop/test?token=nope', { id: target.provider_message_id, status: 'delivered' });
  assert.equal(r.status, 401);
  r = await call('POST', '/webhooks/voicedrop/test?token=sekret', { id: target.provider_message_id, status: 'delivered' });
  assert.equal(r.data.updated, 1);

  // Inbound replies via GHL-style webhook
  r = await call('POST', '/webhooks/ghl/inbound?token=sekret', { phone: '+15125550102', message: 'How much does it cost?', messageId: 'm1' });
  assert.equal(r.data.category, 'pricing');
  r = await call('POST', '/webhooks/ghl/inbound?token=sekret', { phone: '+15125550102', message: 'How much does it cost?', messageId: 'm1' });
  assert.equal(r.data.duplicate, true);
  r = await call('POST', '/webhooks/ghl/inbound?token=sekret', { phone: '(713) 555-0104', message: 'STOP' });
  assert.equal(r.data.category, 'opt_out');
  const sup = (await call('GET', '/api/suppression')).data;
  assert.ok(sup.some((s) => s.phone === '+17135550104'));
  const replies = (await call('GET', '/api/replies')).data;
  assert.ok(replies.find((x) => x.category === 'pricing').suggested_reply.includes('Pricing depends on your call volume'));

  // Campaign completes once nothing is queued
  await tick(NOON);
  const camp = (await call('GET', '/api/campaigns')).data.find((x) => x.id === cid);
  assert.equal(camp.status, 'completed');
  assert.equal(camp.replies, 2);

  // Duplicate-outreach protection in a second campaign
  r = await call('POST', '/api/campaigns', { name: 'Second', contactIds: [byName.Marcus.id, byName.Priya.id] });
  await call('POST', `/api/campaigns/${r.data.id}/generate`, {});
  rows = (await call('GET', `/api/campaigns/${r.data.id}`)).data.rows;
  assert.ok(rows.every((x) => x.compliance_status === 'blocked'));
  assert.ok(rows.find((x) => x.first_name === 'Marcus').compliance_notes.some((n) => n.code === 'duplicate'));
  assert.ok(rows.find((x) => x.first_name === 'Priya').compliance_notes.some((n) => n.code === 'suppressed'));

  // Cost tracking
  const costs = (await call('GET', '/api/costs')).data;
  const cats = Object.fromEntries(costs.byCategory.map((c) => [c.category, c.amount]));
  assert.ok(cats.delivery > 0);
  assert.equal(costs.sent, 6);

  // Audit trail
  const audit = (await call('GET', '/api/audit')).data.map((a) => a.action);
  for (const a of ['contacts.import_csv', 'campaign.launch', 'scripts.approved', 'optout.received', 'global_stop.on']) assert.ok(audit.includes(a), a);
});

test('GHL endpoints report missing configuration clearly', async () => {
  const r = await call('POST', '/api/contacts/sync', {});
  assert.equal(r.status, 412);
  assert.match(r.data.error, /GHL_PRIVATE_TOKEN/);
});
