import { api, state, esc, money, busy, toast, $, $$ } from '../core.js';
import { optionsForm, bindOptions, readOptions } from './campaigns.js';

let current = 'barbershop';
let seed = 0;

export async function render(root) {
  const inds = state.options.industries;
  root.innerHTML = `
  <div class="page-head"><div><h1>AI Script Generator</h1><p>Industry intelligence behind every message. Try tones and lengths here; campaigns use the same engine for each contact.</p></div></div>
  <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);align-items:start" id="sg">
    <div class="stack">
      <div class="grid g2" id="inds">${inds.map((i) => `<div class="ind-card ${i.key === current ? 'on' : ''}" data-k="${i.key}"><b>${esc(i.label)}</b><div class="small muted">${esc(i.vocabulary.slice(0, 4).join(' · '))}</div></div>`).join('')}</div>
      <div class="card" id="intel"></div>
    </div>
    <div class="stack">
      <div class="card" id="opts">${optionsForm(state.options.defaults)}</div>
      <div class="card">
        <div class="card-head"><h2>Preview</h2><div class="btn-row">
          <input id="pname" placeholder="First name" value="Mike" style="width:120px"><input id="pbiz" placeholder="Business" value="" style="width:170px"><input id="pcity" placeholder="City" value="Austin" style="width:120px">
          <button class="btn sm" id="vary">↻ Variation</button></div></div>
        <div class="script-preview" id="out">…</div>
        <div class="row small muted" id="meta" style="margin-top:8px"></div>
        <h4 style="margin-top:14px">Follow-up SMS</h4><div class="script-preview" id="sms" style="font-size:13.5px"></div>
        <div class="btn-row" style="margin-top:14px"><button class="btn" id="listen">🔊 Listen (uses TTS)</button><span id="aud" style="flex:1;min-width:220px"></span></div>
      </div>
    </div>
  </div>`;
  if (window.innerWidth < 1000) $('#sg').style.gridTemplateColumns = '1fr';
  const bizDefault = { barbershop: 'Fresh Cutz Barbershop', restaurant: "Rosa's Cantina", roofing: 'Summit Roofing', hvac: 'Cool Breeze HVAC', plumbing: 'Rapid Rooter Plumbing', landscaping: 'Green Acres Lawn Care', dental: 'Bright Smile Dental', medical: 'Core Physical Therapy', real_estate: 'Hill Country Realty', auto_repair: "Joe's Auto Repair", home_improvement: 'Precision Remodeling', other: 'Main Street Services' };
  const update = async () => {
    const ind = inds.find((i) => i.key === current);
    $('#intel').innerHTML = `<h2>${esc(ind.label)}</h2><dl class="kv" style="grid-template-columns:150px 1fr">
      <dt>Everyday pain point</dt><dd>${esc(ind.painPoint)}</dd><dt>On a missed call</dt><dd>${esc(ind.missedCall)}</dd>
      <dt>Why they go to a competitor</dt><dd>${esc(ind.competitorReason)}</dd><dt>Potential impact</dt><dd>${esc(ind.revenueImpact)}</dd>
      <dt>How we solve it</dt><dd>${esc(ind.howWeSolve)}</dd><dt>Their vocabulary</dt><dd>${ind.vocabulary.map((v) => `<span class="tag">${esc(v)}</span>`).join('')}</dd></dl>`;
    if (!$('#pbiz').dataset.touched) $('#pbiz').value = bizDefault[current] || '';
    const sample = { first_name: $('#pname').value, business_name: $('#pbiz').value, city: $('#pcity').value };
    const r = await api('scripts/preview', { method: 'POST', body: { industry: current, options: readOptions($('#opts')), seed: String(seed), sample } }).catch((e) => toast(e.message, 'err'));
    if (!r) return;
    $('#out').textContent = r.script;
    $('#sms').textContent = r.sms;
    $('#meta').innerHTML = `${r.lint.words} words · ~${Math.round(r.lint.seconds)}s spoken ${r.lint.issues.map((i) => `<span class="badge amber">${esc(i)}</span>`).join('')}<span class="badge">Free template engine${state.status.ai.active !== 'template' ? ' · AI polish runs inside campaigns' : ''}</span>`;
    $('#aud').innerHTML = '';
  };
  $$('#inds .ind-card').forEach((c) => (c.onclick = () => { current = c.dataset.k; $$('#inds .ind-card').forEach((x) => x.classList.toggle('on', x === c)); update(); }));
  bindOptions($('#opts'), update);
  $('#vary').onclick = () => { seed++; update(); };
  $('#pbiz').oninput = (e) => { e.target.dataset.touched = 1; };
  for (const id of ['#pname', '#pbiz', '#pcity']) $(id).onchange = update;
  $('#listen').onclick = (e) => busy(e.currentTarget, async () => {
    const r = await api('voices/preview', { method: 'POST', body: { text: $('#out').textContent, voice: readOptions($('#opts')).voice } });
    $('#aud').innerHTML = `<audio controls autoplay src="${r.url}"></audio><span class="small muted">${r.cached ? 'from cache (free)' : `cost ${money(r.cost)}`}</span>`;
  });
  update();
}
