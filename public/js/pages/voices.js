import { api, state, esc, money, num, ago, busy, $, $$ } from '../core.js';

export async function render(root) {
  const v = await api('voices');
  const sample = `Hey Mike, this is ${state.status.settings.senderName || 'Tenzin'} with ${state.status.settings.senderCompany || 'Lobsang Solutions'}. Quick question. When you're slammed and the phone rings, what happens to that caller?`;
  root.innerHTML = `
  <div class="page-head"><div><h1>Voice Library</h1><p>Compare voices, then pick one per campaign. Every generated file is cached and reused when the same script and voice are requested again.</p></div></div>
  <div class="grid g2">
    ${v.providers.map((p) => `<div class="card"><div class="card-head"><h2>${esc(p.label)}</h2><span class="badge ${p.configured ? 'green' : ''}">${p.configured ? `Active · ${esc(p.model)}` : 'Not configured'}</span></div>
      <div class="table-wrap"><table><tbody>${p.voices.map((x) => `<tr><td><b>${esc(x.name)}</b> <span class="small muted">${x.gender}</span><div class="small muted">${esc(x.note)}</div></td>
        <td class="right">${p.configured ? `<button class="btn xs" data-try="${p.name}|${x.id}">▶ Try</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`).join('')}
  </div>
  <div class="card">
    <div class="card-head"><h2>Preview text</h2></div>
    <div class="form-grid" style="grid-template-columns:1fr 160px 160px">
      <textarea id="txt" style="min-height:70px">${esc(sample)}</textarea>
      <label class="field">Style<select id="style">${v.styles.map((s) => `<option>${s}</option>`).join('')}</select></label>
      <label class="field">Speed<input type="number" id="speed" value="1" min="0.8" max="1.2" step="0.05"></label>
    </div>
    <div id="player" class="row" style="margin-top:10px"></div>
  </div>
  <div class="card"><div class="card-head"><h2>Generated audio</h2><span class="small muted">${num(v.library.length)} files · ${num(v.library.reduce((s, x) => s + x.reused_count, 0))} cache reuses</span></div>
    ${v.library.length ? `<div class="table-wrap"><table><thead><tr><th>Audio</th><th>Voice</th><th class="hide-sm">Script</th><th class="num">Length</th><th class="num">Cost</th><th class="num">Reused</th><th class="hide-sm">Created</th></tr></thead><tbody>
    ${v.library.map((a) => `<tr><td style="min-width:220px"><audio controls preload="none" src="/media/${a.hash}.mp3"></audio></td><td>${esc(a.voice)}<div class="small muted">${esc(a.provider)} · ${esc(a.style)} · ${a.speed}×</div></td>
      <td class="hide-sm small" style="max-width:360px">${esc(a.script)}…</td><td class="num">${a.duration_sec ? Math.round(a.duration_sec) + 's' : '—'}</td><td class="num">${money(a.cost)}</td><td class="num">${num(a.reused_count)}</td><td class="hide-sm small muted">${ago(a.created_at)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No audio yet. Approve scripts in a campaign and generate audio, or try a voice above.</p>'}
  </div>`;
  $$('[data-try]').forEach((b) => (b.onclick = () => busy(b, async () => {
    const [provider, voice] = b.dataset.try.split('|');
    const r = await api('voices/preview', { method: 'POST', body: { text: $('#txt').value, voice: { provider, voice, style: $('#style').value, speed: Number($('#speed').value) } } });
    $('#player').innerHTML = `<audio controls autoplay src="${r.url}" style="max-width:420px"></audio><span class="small muted">${esc(voice)} · ${r.cached ? 'cached (free)' : `cost ${money(r.cost)}`}</span>`;
  })));
}
