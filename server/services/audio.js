// Audio generation with content-addressed caching: identical script + voice
// settings are synthesized once and reused everywhere (zero marginal cost).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, json, recordCost, audit } from '../db.js';
import { getTTS, mp3Duration } from '../providers/tts/index.js';
import { ttsCost } from './pricing.js';
import { estimateSeconds } from './scriptEngine.js';

const audioDir = path.join(config.dataDir, 'audio');

export function audioHash({ provider, model, voice, speed, style, text }) {
  return crypto.createHash('sha256').update([provider, model, voice, Number(speed).toFixed(2), style, text.trim()].join('|')).digest('hex');
}

export function audioUrl(row, absolute = false) {
  const rel = `/media/${row.hash}.mp3`;
  return absolute ? (config.publicBaseUrl ? config.publicBaseUrl + rel : null) : rel;
}

export async function synthesize(text, voiceOpts = {}, { campaignId = null, note = null } = {}) {
  const tts = getTTS(voiceOpts.provider || 'auto');
  if (!tts) throw Object.assign(new Error('No text-to-speech provider is configured. Add OPENAI_API_KEY (or ELEVENLABS_API_KEY) to .env'), { status: 412 });
  const voice = voiceOpts.voice && tts.voices.some((v) => v.id === voiceOpts.voice) ? voiceOpts.voice : tts.voices[0].id;
  const speed = Number(voiceOpts.speed) || 1;
  const style = voiceOpts.style || 'warm';
  const model = tts.model();
  const hash = audioHash({ provider: tts.name, model, voice, speed, style, text });
  const existing = db.prepare('SELECT * FROM audio_files WHERE hash = ?').get(hash);
  if (existing && fs.existsSync(path.join(audioDir, existing.file))) {
    db.prepare('UPDATE audio_files SET reused_count = reused_count + 1 WHERE id = ?').run(existing.id);
    return { ...existing, cached: true };
  }
  const { buffer } = await tts.synthesize({ text, voice, speed, style, model });
  const file = `${hash}.mp3`;
  fs.writeFileSync(path.join(audioDir, file), buffer);
  const cost = ttsCost(tts.name, model, text.length);
  const duration = mp3Duration(buffer) || estimateSeconds(text, speed);
  db.prepare(`INSERT INTO audio_files (hash, provider, model, voice, speed, style, script, characters, duration_sec, bytes, file, cost)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(hash) DO UPDATE SET file = excluded.file, bytes = excluded.bytes`)
    .run(hash, tts.name, model, voice, speed, style, text, text.length, duration, buffer.length, file, cost);
  recordCost({ campaignId, category: 'tts', provider: `${tts.name}:${model}`, units: text.length, unit: 'chars', amount: cost, note });
  return { ...db.prepare('SELECT * FROM audio_files WHERE hash = ?').get(hash), cached: false };
}

// Generate audio for APPROVED scripts only.
export async function generateCampaignAudio(campaignId, { ids = null } = {}) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const voiceOpts = json(campaign.options, {}).voice || {};
  let rows = db.prepare("SELECT * FROM campaign_contacts WHERE campaign_id = ? AND script_status = 'approved'").all(campaignId);
  if (ids?.length) rows = rows.filter((r) => ids.includes(r.id));
  const out = { created: 0, reused: 0, unchanged: 0, failed: 0, cost: 0, errors: [] };
  for (const cc of rows) {
    if (cc.audio_id) {
      const a = db.prepare('SELECT * FROM audio_files WHERE id = ?').get(cc.audio_id);
      if (a && a.script === cc.script.trim() && fs.existsSync(path.join(audioDir, a.file))) { out.unchanged++; continue; }
    }
    try {
      const a = await synthesize(cc.script.trim(), voiceOpts, { campaignId, note: `cc ${cc.id}` });
      db.prepare('UPDATE campaign_contacts SET audio_id = ? WHERE id = ?').run(a.id, cc.id);
      if (a.cached) out.reused++; else { out.created++; out.cost += a.cost; }
    } catch (err) {
      out.failed++; out.errors.push(err.message);
      if (err.status === 412) break; // not configured: stop early
    }
  }
  const pending = db.prepare("SELECT COUNT(*) n FROM campaign_contacts WHERE campaign_id = ? AND compliance_status != 'blocked' AND (script_status != 'approved' OR audio_id IS NULL)").get(campaignId).n;
  if (!pending) db.prepare("UPDATE campaigns SET status = CASE WHEN status IN ('draft','scripts_ready') THEN 'audio_ready' ELSE status END WHERE id = ?").run(campaignId);
  audit('audio.generate', 'campaign', campaignId, { ...out, errors: out.errors.slice(0, 3) });
  return out;
}

export function audioFilePath(row) { return path.join(audioDir, row.file); }
