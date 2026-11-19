// AI cost-control behavior: one base call per industry (cached across campaigns),
// per-contact calls only for business-specific personalization, fallback on failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-ai-'));
Object.assign(process.env, { NODE_ENV: 'test', DATA_DIR: tmp, DB_PATH: path.join(tmp, 'ai.db'), AI_PROVIDER: 'auto', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' });

const { registerAIProvider } = await import('../server/providers/ai/index.js');
const { importCsv, queryContacts } = await import('../server/services/contacts.js');
const { createCampaign, campaignRows } = await import('../server/services/campaigns.js');
const { generateForCampaign } = await import('../server/services/generator.js');
const { db } = await import('../server/db.js');

let calls = []; let fail = false;
registerAIProvider('test', {
  configured: () => true, model: () => 'claude-haiku-5-5',
  async complete({ prompt }) {
    calls.push(prompt);
    if (fail) throw new Error('boom');
    const text = prompt.includes('Rewrite this voicemail')
      ? JSON.stringify({ script: 'Hey {first_name}, this is {sender} with {company}. Custom for {business_name}. When the bays are full, calls get missed and drivers try the next shop. I have a simple way to catch them. I will text you a quick example.' })
      : JSON.stringify({ variants: [1, 2, 3].map((n) => `Hey {first_name}, this is {sender} with {company}. Variant ${n}. When your crew is busy at {business_name}, callers often try the next shop. That could be a customer gone. I have a simple way to catch those calls. I'll text you a quick example.`) });
    return { text, inputTokens: 1000, outputTokens: 500, model: 'claude-haiku-5-5', cost: 0.00035 };
  },
});

importCsv(`first_name,business_name,phone,industry,consent_voice
Ann,Ann's Auto Repair,+15125550201,auto repair,yes
Bob,Bob's Brake & Tire,+15125550202,auto repair,yes
Cal,Cal's Plumbing,+15125550203,plumbing,yes`);
const ids = queryContacts({ pageSize: 10 }).allIds;

test('one AI base call per industry, cached across campaigns', async () => {
  const c1 = createCampaign({ name: 'A', options: { useAI: true, personalization: 'advanced' }, contactIds: ids });
  const r = await generateForCampaign(c1.id);
  assert.equal(r.ai, 3);
  assert.equal(calls.length, 2, 'auto_repair + plumbing');
  const rows = campaignRows(c1.id);
  const ann = rows.find((x) => x.first_name === 'Ann');
  assert.match(ann.script, /^Hey Ann, this is Tenzin with Lobsang Solutions\. Variant \d\. When your crew is busy at Ann's Auto Repair/);
  assert.ok(!/\{[a-z_]+\}/.test(ann.script));
  const c2 = createCampaign({ name: 'B', options: { useAI: true, personalization: 'advanced' }, contactIds: ids });
  await generateForCampaign(c2.id);
  assert.equal(calls.length, 2, 'second campaign reuses cached bases');
  const cost = db.prepare("SELECT SUM(amount) s, COUNT(*) n FROM costs WHERE category = 'ai'").get();
  assert.equal(cost.n, 2);
});

test('business-specific personalization adds one small call per contact', async () => {
  calls = [];
  const c = createCampaign({ name: 'C', options: { useAI: true, personalization: 'business', tone: 'bold' }, contactIds: ids });
  await generateForCampaign(c.id);
  assert.equal(calls.filter((p) => p.includes('Rewrite this voicemail')).length, 3);
  assert.match(campaignRows(c.id)[0].script, /Custom for/);
});

test('AI failure falls back to free templates', async () => {
  fail = true;
  const c = createCampaign({ name: 'D', options: { useAI: true, tone: 'friendly', duration: 20 }, contactIds: ids });
  const r = await generateForCampaign(c.id);
  assert.equal(r.template, 3);
  assert.equal(r.errors.length, 3);
  assert.ok(campaignRows(c.id).every((x) => x.script.startsWith(`Hey ${x.first_name}, this is Tenzin`)));
  fs.rmSync(tmp, { recursive: true, force: true });
});
