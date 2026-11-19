import { api, esc, money, num, badge, label } from '../core.js';

const COLORS = { ai: '#7c3aed', tts: '#2563eb', delivery: '#dc2643', sms: '#0f9d63' };

export async function render(root) {
  const d = await api('costs');
  const cat = Object.fromEntries(d.byCategory.map((c) => [c.category, c.amount]));
  const days = [...new Set(d.daily.map((x) => x.day))];
  const max = Math.max(0.0001, ...days.map((day) => d.daily.filter((x) => x.day === day).reduce((s, x) => s + x.amount, 0)));
  root.innerHTML = `
  <div class="page-head"><div><h1>Cost Analytics</h1><p>AI, audio, delivery, and SMS costs tracked separately, per provider and per campaign.</p></div></div>
  <div class="grid g4">
    ${kpi('Total spend', money(d.total, 2), `${num(d.sent)} voice drops sent`)}
    ${kpi('Cost per delivery', d.perDelivery == null ? '—' : money(d.perDelivery), 'all costs ÷ sent')}
    ${kpi('Audio cache savings', money(d.audioSavings, 2), 'reused audio not re-billed')}
    ${kpi('AI spend', money(cat.ai || 0), 'scripts + reply assistant')}
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h2>By category</h2></div>
      ${['ai', 'tts', 'delivery', 'sms'].map((k) => `<div style="margin-bottom:12px"><div class="row between small"><span><b>${{ ai: 'AI generation', tts: 'Audio (TTS)', delivery: 'Voicemail delivery', sms: 'Follow-up SMS' }[k]}</b></span><span>${money(cat[k] || 0)}</span></div>
        <div class="bar"><span style="width:${d.total ? ((cat[k] || 0) / d.total) * 100 : 0}%;background:${COLORS[k]}"></span></div></div>`).join('')}
    </div>
    <div class="card"><div class="card-head"><h2>Last 30 days</h2><div class="legend">${Object.entries(COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${k.toUpperCase()}</span>`).join('')}</div></div>
      ${days.length ? `<div class="chart">${days.map((day) => `<div class="col" title="${day}: ${money(d.daily.filter((x) => x.day === day).reduce((s, x) => s + x.amount, 0))}" style="height:100%">
        ${['ai', 'tts', 'delivery', 'sms'].map((k) => { const v = d.daily.find((x) => x.day === day && x.category === k)?.amount || 0; return v ? `<span style="height:${(v / max) * 100}%;background:${COLORS[k]}"></span>` : ''; }).join('')}</div>`).join('')}</div>
      <div class="row between small muted"><span>${days[0]}</span><span>${days[days.length - 1]}</span></div>` : '<p class="muted">No spend yet.</p>'}
    </div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-head"><h2>By campaign</h2></div>
      ${d.byCampaign.length ? `<div class="table-wrap"><table><thead><tr><th>Campaign</th><th class="num">Sent</th><th class="num">Cost</th><th class="num">Per delivery</th></tr></thead><tbody>
      ${d.byCampaign.map((c) => `<tr class="clickable" onclick="location.hash='#/campaign/${c.id}/review'"><td>${esc(c.name)} ${badge(c.status)}</td><td class="num">${num(c.sent)}</td><td class="num">${money(c.amount)}</td><td class="num">${c.sent ? money(c.amount / c.sent) : '—'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No campaigns yet.</p>'}
    </div>
    <div class="card"><div class="card-head"><h2>By provider</h2></div>
      ${d.byProvider.length ? `<div class="table-wrap"><table><thead><tr><th>Category</th><th>Provider</th><th class="num">Usage</th><th class="num">Cost</th></tr></thead><tbody>
      ${d.byProvider.map((p) => `<tr><td>${label(p.category)}</td><td class="mono small">${esc(p.provider)}</td><td class="num small">${num(Math.round(p.units))} ${esc(p.unit || '')}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No provider usage yet.</p>'}
    </div>
  </div>
  <div class="card"><div class="card-head"><h2>Recent cost events</h2></div>
    ${d.recent.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Category</th><th>Provider</th><th class="hide-sm">Note</th><th class="num">Amount</th></tr></thead><tbody>
    ${d.recent.map((r) => `<tr><td class="small">${esc(r.created_at)}</td><td>${label(r.category)}</td><td class="mono small">${esc(r.provider)}</td><td class="hide-sm small muted">${esc(r.note || '')}</td><td class="num">${money(r.amount)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Nothing yet.</p>'}
  </div>`;
}
const kpi = (l, v, s) => `<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`;
