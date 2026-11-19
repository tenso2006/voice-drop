// AI provider abstraction. Every provider implements:
//   complete({ system, prompt, maxTokens }) -> { text, inputTokens, outputTokens, model, cost }
// Providers are tried only when configured; the template engine is the free fallback.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';
import { aiCost } from '../../services/pricing.js';

const providers = {
  anthropic: {
    label: 'Anthropic Claude',
    configured: () => !!config.ai.anthropicKey,
    model: () => config.ai.anthropicModel,
    async complete({ system, prompt, maxTokens = 600 }) {
      const client = new Anthropic({ apiKey: config.ai.anthropicKey, maxRetries: 2, timeout: 60_000 });
      const model = config.ai.anthropicModel;
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        // Short copywriting / classification: lowest effort keeps cost and latency down.
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      if (res.stop_reason === 'refusal') throw new Error('The AI model declined this request.');
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      const inTok = res.usage?.input_tokens || 0;
      const outTok = res.usage?.output_tokens || 0;
      return { text, inputTokens: inTok, outputTokens: outTok, model, cost: aiCost(model, inTok, outTok) };
    },
  },
  openai: {
    label: 'OpenAI',
    configured: () => !!config.ai.openaiKey,
    model: () => config.ai.openaiModel,
    async complete({ system, prompt, maxTokens = 600 }) {
      const model = config.ai.openaiModel;
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.ai.openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(60_000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${j.error?.message || 'request failed'}`);
      const inTok = j.usage?.prompt_tokens || 0;
      const outTok = j.usage?.completion_tokens || 0;
      return { text: (j.choices?.[0]?.message?.content || '').trim(), inputTokens: inTok, outputTokens: outTok, model, cost: aiCost(model, inTok, outTok) };
    },
  },
};

// Test hook: lets the test-suite register a fake provider without network.
export function registerAIProvider(name, impl) { providers[name] = impl; }

export function activeAI() {
  const want = config.ai.provider;
  if (want === 'template') return null;
  if (want !== 'auto') return providers[want]?.configured() ? { name: want, ...providers[want] } : null;
  for (const name of ['anthropic', 'openai']) if (providers[name].configured()) return { name, ...providers[name] };
  if (providers.test?.configured?.()) return { name: 'test', ...providers.test };
  return null;
}

export function aiStatus() {
  const a = activeAI();
  return {
    active: a ? a.name : 'template',
    model: a ? a.model() : 'template (free)',
    anthropic: providers.anthropic.configured(),
    openai: providers.openai.configured(),
  };
}

export function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI did not return JSON');
  return JSON.parse(m[0]);
}
