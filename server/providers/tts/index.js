// Text-to-speech provider abstraction. Each provider implements:
//   synthesize({ text, voice, speed, style, model }) -> Buffer (MP3)
// plus a voice catalogue. Swap vendors by setting TTS_PROVIDER; the rest of the
// app (caching, cost tracking, preview, delivery) does not change.
import { config } from '../../config.js';

const STYLE_INSTRUCTIONS = {
  warm: 'Speak like a friendly local business owner leaving a casual voicemail for someone they respect. Warm, relaxed, natural pauses, American English. Not salesy, not like an announcer.',
  upbeat: 'Upbeat and energetic but genuine, like a friendly neighbor with good news. Natural conversational American English voicemail.',
  calm: 'Calm, steady, and reassuring. Conversational American English voicemail, unhurried pace.',
  confident: 'Confident and direct, like a trusted advisor. Conversational American English voicemail, no hype.',
  casual: 'Very casual and laid back, like texting a friend but out loud. Natural American English voicemail with light filler pacing.',
};

const providers = {
  openai: {
    label: 'OpenAI TTS',
    configured: () => !!config.tts.openaiKey,
    model: () => config.tts.openaiModel,
    voices: [
      { id: 'ash', name: 'Ash', gender: 'male', note: 'Warm, conversational' },
      { id: 'echo', name: 'Echo', gender: 'male', note: 'Clear, friendly' },
      { id: 'onyx', name: 'Onyx', gender: 'male', note: 'Deep, confident' },
      { id: 'verse', name: 'Verse', gender: 'male', note: 'Expressive (gpt-4o-mini-tts)' },
      { id: 'ballad', name: 'Ballad', gender: 'male', note: 'Soft (gpt-4o-mini-tts)' },
      { id: 'coral', name: 'Coral', gender: 'female', note: 'Bright, friendly' },
      { id: 'nova', name: 'Nova', gender: 'female', note: 'Upbeat, energetic' },
      { id: 'shimmer', name: 'Shimmer', gender: 'female', note: 'Light, warm' },
      { id: 'sage', name: 'Sage', gender: 'female', note: 'Calm, measured' },
      { id: 'alloy', name: 'Alloy', gender: 'neutral', note: 'Balanced' },
    ],
    async synthesize({ text, voice = 'ash', speed = 1, style = 'warm' }) {
      const model = config.tts.openaiModel;
      const body = { model, input: text, voice, speed: Math.min(4, Math.max(0.25, Number(speed) || 1)), response_format: 'mp3' };
      if (model.startsWith('gpt-4o')) body.instructions = STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS.warm;
      const r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.tts.openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(`OpenAI TTS error ${r.status}: ${j.error?.message || r.statusText}`);
      }
      return { buffer: Buffer.from(await r.arrayBuffer()), model };
    },
  },
  elevenlabs: {
    label: 'ElevenLabs',
    configured: () => !!config.tts.elevenKey,
    model: () => config.tts.elevenModel,
    voices: [
      { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', note: 'Deep, American' },
      { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', note: 'Young, American' },
      { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'male', note: 'Well-rounded' },
      { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', note: 'Calm, American' },
      { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', note: 'Soft, friendly' },
    ],
    async synthesize({ text, voice = 'pNInz6obpgDQGcFmaJgB', speed = 1, style = 'warm' }) {
      const model = config.tts.elevenModel;
      const stability = { calm: 0.7, confident: 0.6, warm: 0.5, casual: 0.35, upbeat: 0.35 }[style] ?? 0.5;
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
        method: 'POST',
        headers: { 'xi-api-key': config.tts.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model, voice_settings: { stability, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, Number(speed) || 1)) } }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!r.ok) throw new Error(`ElevenLabs error ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return { buffer: Buffer.from(await r.arrayBuffer()), model };
    },
  },
};

export function registerTTSProvider(name, impl) { providers[name] = impl; }

export function getTTS(name = 'auto') {
  const want = name === 'auto' ? config.tts.provider : name;
  if (want && want !== 'auto') return providers[want]?.configured() ? { name: want, ...providers[want] } : null;
  for (const n of ['openai', 'elevenlabs', 'test']) if (providers[n]?.configured()) return { name: n, ...providers[n] };
  return null;
}

export function ttsCatalog() {
  return Object.entries(providers).filter(([n]) => n !== 'test' || providers.test.configured()).map(([name, p]) => ({
    name, label: p.label, configured: p.configured(), model: p.model(), voices: p.voices,
  }));
}

export const TTS_STYLES = Object.keys(STYLE_INSTRUCTIONS);

// Rough MP3 duration from the first frame header (CBR assumption) for analytics.
export function mp3Duration(buf) {
  const rates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  let i = 0;
  if (buf.slice(0, 3).toString() === 'ID3') i = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  const limit = Math.min(buf.length - 4, i + 4096);
  for (; i < limit; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const kbps = rates[(buf[i + 2] >> 4) & 0x0f];
      if (kbps) return Math.round(((buf.length - i) * 8) / (kbps * 1000) * 10) / 10;
    }
  }
  return null;
}
