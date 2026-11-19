// Provider price book (USD). Override any value with an env var so estimates
// stay accurate when vendors change pricing. Values are list prices as of late 2026.
const n = (k, d) => (process.env[k] ? Number(process.env[k]) : d);

export const PRICES = {
  ai: {
    // per 1M tokens
    'claude-haiku-5-5': { in: n('PRICE_HAIKU_IN', 0.10), out: n('PRICE_HAIKU_OUT', 0.50) },
    'claude-sonnet-5-5': { in: 2.0, out: 10.0 },
    'claude-opus-5-5': { in: 4.0, out: 20.0 },
    'gpt-4o-mini': { in: n('PRICE_GPT4OMINI_IN', 0.15), out: n('PRICE_GPT4OMINI_OUT', 0.60) },
    template: { in: 0, out: 0 },
  },
  tts: {
    // estimated USD per 1,000 characters of script
    'openai:gpt-4o-mini-tts': n('PRICE_TTS_OPENAI_MINI_PER_1K', 0.012),
    'openai:tts-1': n('PRICE_TTS_OPENAI_TTS1_PER_1K', 0.015),
    'openai:tts-1-hd': n('PRICE_TTS_OPENAI_TTS1HD_PER_1K', 0.030),
    'elevenlabs:eleven_flash_v2_5': n('PRICE_TTS_ELEVEN_FLASH_PER_1K', 0.06),
    'elevenlabs:eleven_multilingual_v2': n('PRICE_TTS_ELEVEN_MULTI_PER_1K', 0.12),
    'test:mock': 0,
  },
};

export function aiCost(model, inTok, outTok) {
  const p = PRICES.ai[model] || PRICES.ai['claude-haiku-5-5'];
  return (inTok * p.in + outTok * p.out) / 1e6;
}
export function ttsCost(provider, model, chars) {
  const per1k = PRICES.tts[`${provider}:${model}`] ?? 0.015;
  return (chars / 1000) * per1k;
}
