import { api, state, esc, busy, toast, $ } from '../core.js';
import { refreshStatus } from '../app.js';

export async function render(root) {
  const s = await refreshStatus();
  const opts = state.options;
  const base = location.origin;
  const st = (ok, t) => `<span class="badge ${ok ? 'green' : 'amber'}">${ok ? '● ' : '○ '}${t}</span>`;
  root.innerHTML = `
  <div class="page-head"><div><h1>Integrations</h1><p>Credentials live only in the server's <code>.env</code> file. The browser never sees an API key.</p></div>
    <button class="btn" id="reload">↻ Re-check</button></div>

  <div class="card"><div class="card-head"><h2>GoHighLevel CRM</h2>${st(s.ghl.configured, s.ghl.configured ? `Configured (${esc(s.ghl.locationId)})` : 'Not configured')}</div>
    <p>Uses a <b>Private Integration token</b> for your sub-account (Settings → Private Integrations in GHL) with these scopes: <code>contacts.readonly</code>, <code>contacts.write</code>, <code>locations.readonly</code>, <code>locations/customFields.readonly</code>, <code>locations/tags.readonly</code>, <code>opportunities.readonly</code>, <code>conversations.readonly</code>, <code>conversations/message.write</code>.</p>
    <pre class="card mono small" style="background:#0a1a3a;color:#d6e2ff;overflow-x:auto">GHL_PRIVATE_TOKEN=pit-xxxxxxxx
GHL_LOCATION_ID=your_location_id</pre>
    <div class="btn-row"><button class="btn primary" id="ghltest" ${s.ghl.configured ? '' : 'disabled'}>Test connection</button><span id="ghlres" class="small"></span></div>
    <div class="divider"></div>
    <h3>What works through the GHL API</h3>
    <ul class="small">
      <li>✅ Contacts, tags, custom fields, DND status, pipeline stages (read)</li>
      <li>✅ Follow-up SMS via Conversations API (sends from your GHL/LC Phone number)</li>
      <li>✅ Workflow triggers via tags (opt-in under Settings): <code>voicedrop-delivered</code>, <code>voicedrop-sms-sent</code>, <code>voicedrop-replied</code>, <code>voicedrop-demo-requested</code>, <code>voicedrop-opted-out</code>. Build GHL workflows with trigger "Contact Tag Added".</li>
      <li>⚠️ Smart Lists are not exposed by the public API. Workaround: add a workflow step in GHL that tags the contacts, then filter or sync by that tag.</li>
      <li>❌ GHL has no public ringless-voicemail API. Use a delivery provider below, or the "GHL workflow handoff" option.</li>
    </ul>
    <h3>Inbound replies webhook</h3>
    <p class="small">In GHL create a workflow: trigger <b>Customer Replied</b> (channel SMS) → action <b>Webhook</b> (POST) to:</p>
    <code>${esc(base)}/webhooks/ghl/inbound?token=${s.webhookSecret ? '&lt;WEBHOOK_SECRET&gt;' : '(set WEBHOOK_SECRET first)'}</code>
    <p class="small" style="margin-top:6px">Custom data: <code>contact_id</code> = {{contact.id}}, <code>phone</code> = {{contact.phone}}, <code>message</code> = {{message.body}}. Or use <b>Pull from GHL</b> on the Replies page.</p>
  </div>

  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h2>AI scripts &amp; replies</h2>${st(s.ai.active !== 'template', s.ai.active === 'template' ? 'Free templates' : esc(s.ai.model))}</div>
      <p class="small">Optional. Without a key, the built-in industry template engine writes every script at no cost. With a key, one low-cost call per industry polishes scripts (cached), and replies get AI classification when keyword rules are unsure.</p>
      <pre class="card mono small" style="background:#0a1a3a;color:#d6e2ff;overflow-x:auto">ANTHROPIC_API_KEY=...        # default model: claude-haiku-5-5
# or OPENAI_API_KEY=...        # uses gpt-4o-mini for text</pre>
    </div>
    <div class="card"><div class="card-head"><h2>Text-to-speech</h2>${st(s.tts.some((t) => t.configured), s.tts.find((t) => t.configured)?.label || 'Not configured')}</div>
      <p class="small">Recommended: <b>OpenAI gpt-4o-mini-tts</b> (natural, steerable speaking style, roughly a cent per 30-second message). ElevenLabs is supported for premium voices. Switch with <code>TTS_PROVIDER</code>; nothing else changes.</p>
      <pre class="card mono small" style="background:#0a1a3a;color:#d6e2ff;overflow-x:auto">OPENAI_API_KEY=sk-...
# ELEVENLABS_API_KEY=...     TTS_PROVIDER=elevenlabs</pre>
    </div>
  </div>

  <div class="card"><div class="card-head"><h2>Voicemail-drop delivery</h2>${st(s.delivery.canSend && s.delivery.ready, s.delivery.canSend ? (s.delivery.ready ? `${esc(s.delivery.label)} ready` : `${esc(s.delivery.label)} needs setup`) : 'Manual download mode')}</div>
    <p class="small">Choose with <code>VOICEDROP_PROVIDER</code>. Providers fetch audio from a public URL, so set <code>PUBLIC_BASE_URL</code> (${s.publicBaseUrl ? '✅ set' : '❌ not set'}) and <code>WEBHOOK_SECRET</code> (${s.webhookSecret ? '✅ set' : '❌ not set'}) for delivery receipts.</p>
    <div class="table-wrap"><table><thead><tr><th>Provider</th><th>How it works</th><th>Status</th></tr></thead><tbody>
    ${opts.delivery.map((d) => `<tr><td><b>${esc(d.label)}</b><div class="mono small muted">${d.name}</div></td><td class="small">${esc(d.description)}</td>
      <td>${d.active ? '<span class="badge blue">Active</span>' : ''} ${d.configured ? '<span class="badge green">Credentials set</span>' : '<span class="badge">Not configured</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small" style="margin-top:10px">Delivery receipts: <code>${esc(base)}/webhooks/voicedrop/&lt;provider&gt;?token=&lt;WEBHOOK_SECRET&gt;</code></p>
    <div class="notice warn small">Ringless voicemail and AI/prerecorded voice messages are regulated. Confirm consent requirements with counsel and your provider before sending, especially to mobile numbers.</div>
  </div>`;
  $('#reload').onclick = () => render(root);
  $('#ghltest').onclick = (e) => busy(e.currentTarget, async () => { const r = await api('ghl/test'); $('#ghlres').innerHTML = `<span class="green-text">✓ Connected to ${esc(r.name)}</span>`; toast('GHL connection OK', 'ok'); });
}
