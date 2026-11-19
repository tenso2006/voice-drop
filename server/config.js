// Central configuration. All secrets come from environment variables (.env) and
// never leave the server. The browser only ever sees booleans like "configured".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency). Real env vars win over the file.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const e = (k, d = '') => (process.env[k] ?? d).trim();
const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);

export const config = {
  root,
  port: num('PORT', 3000),
  dataDir: path.resolve(root, e('DATA_DIR', 'data')),
  publicBaseUrl: e('PUBLIC_BASE_URL').replace(/\/$/, ''),
  appPassword: e('APP_PASSWORD'),
  sessionSecret: e('SESSION_SECRET', 'change-me-' + root),
  webhookSecret: e('WEBHOOK_SECRET'),

  sender: {
    name: e('SENDER_NAME', 'Tenzin'),
    company: e('SENDER_COMPANY', 'Lobsang Solutions'),
    callbackNumber: e('SENDER_CALLBACK_NUMBER'),
    demoUrl: e('DEMO_URL'),
    bookingUrl: e('BOOKING_URL'),
  },

  ghl: {
    token: e('GHL_PRIVATE_TOKEN'),
    locationId: e('GHL_LOCATION_ID'),
    baseUrl: e('GHL_BASE_URL', 'https://services.leadconnectorhq.com'),
    apiVersion: e('GHL_API_VERSION', '2021-07-28'),
  },

  ai: {
    provider: e('AI_PROVIDER', 'auto'), // auto | anthropic | openai | template
    anthropicKey: e('ANTHROPIC_API_KEY'),
    anthropicModel: e('ANTHROPIC_MODEL', 'claude-haiku-5-5'),
    openaiKey: e('OPENAI_API_KEY'),
    openaiModel: e('OPENAI_CHAT_MODEL', 'gpt-4o-mini'),
  },

  tts: {
    provider: e('TTS_PROVIDER', 'auto'), // auto | openai | elevenlabs
    openaiKey: e('OPENAI_API_KEY'),
    openaiModel: e('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'),
    elevenKey: e('ELEVENLABS_API_KEY'),
    elevenModel: e('ELEVENLABS_MODEL', 'eleven_flash_v2_5'),
  },

  delivery: {
    provider: e('VOICEDROP_PROVIDER', 'manual'), // manual | webhook | slybroadcast | ghl_workflow
    webhookUrl: e('VOICEDROP_WEBHOOK_URL'),
    webhookAuth: e('VOICEDROP_WEBHOOK_AUTH'),
    slyUser: e('SLYBROADCAST_USER'),
    slyPassword: e('SLYBROADCAST_PASSWORD'),
    slyCallerId: e('SLYBROADCAST_CALLER_ID'),
    ghlAudioField: e('GHL_AUDIO_URL_FIELD_KEY'),
    costPerDrop: num('VOICEDROP_COST_PER_DROP', 0.05),
    ratePerMinute: num('VOICEDROP_RATE_PER_MINUTE', 20),
  },

  sms: { costPerSegment: num('SMS_COST_PER_SEGMENT', 0.0079) },

  // Compliance defaults (editable in Settings; these are only the first-run values)
  compliance: {
    defaultTimezone: e('DEFAULT_TIMEZONE', 'America/Chicago'),
    quietStart: e('CALL_WINDOW_START', '09:00'),
    quietEnd: e('CALL_WINDOW_END', '20:00'),
  },
};

export const isTest = process.env.NODE_ENV === 'test';
