import { api, state, esc, money, num, pct, ago, badge, industryLabel } from '../core.js';

export async function render(root) {
  const d = await api('dashboard');
  const s = state.status;
  const t = d.totals;
  const setup = [
    [s.ghl.configured, 'Connect GoHighLevel', 'Sync contacts, send follow-up SMS, trigger workflows', '#/integrations'],
    [t.contacts > 0, 'Load contacts', 'Sync from GHL or import a CSV', '#/contacts'],
    [s.tts.some((x) => x.configured), 'Add a voice provider', 'OpenAI TTS is the low-cost default', '#/integrations'],
    [!!s.settings.callbackNumber, 'Set sender identity', 'Name, company, and callback number', '#/settings'],
    [s.settings.legalReviewAcknowledged, 'Complete compliance setup', 'Consent rules, calling hours, legal acknowledgement', '#/settings'],
    [s.delivery.canSend && s.delivery.ready, 'Connect a voicemail-drop provider', 'Optional: manual download works without it', '#/integrations'],
  ];
  const done = setup.filter((x) => x[0]).length;
  root.innerHTML = `
  <div class="card hero">
    <h1>Lobsang VoiceDrop</h1>
    <p>Personal, human-sounding voice messages that show local business owners what a missed call really costs them, and how an AI Voice Agent and Missed Call Text Back fix it.</p>
    <div class="quote">Every missed call could be a customer and revenue walking straight to your competitor.</div>
  </div>

  <div class="grid g4" style="margin-top:16px">
    ${kpi('Contacts', num(t.contacts), `${num(t.campaigns)} campaigns · ${num(t.active)} active`)}
    ${kpi('Approved scripts', num(t.approved), `${num(t.audio)} audio files · ${num(t.audioReused)} cache reuses`)}
    ${kpi('Voice drops sent', num(t.sent), `${num(t.delivered)} confirmed delivered · ${num(t.failed)} failed`)}
    ${kpi('Replies', num(t.replies), `${num(t.hot)} warm leads · reply rate ${pct(t.replies, t.sent)}`)}
  </div>

  <div class="grid g3" style="margin-top:16px;grid-template-columns:2fr 1fr">
    <div class="card">
      <div class="card-head"><h2>Recent campaigns</h2><a class="btn sm" href="#/builder">+ New campaign</a></div>
      ${d.campaigns.length ? `<div class="table-wrap"><table><thead><tr><th>Campaign</th><th>Status</th><th class="num">Contacts</th><th class="num">Sent</th><th class="num">Replies</th><th class="num hide-sm">Cost</th></tr></thead><tbody>
        ${d.campaigns.map((c) => `<tr class="clickable" onclick="location.hash='#/campaign/${c.id}'"><td><b>${esc(c.name)}</b><div class="small muted">${esc((c.industries || '').split(',').filter(Boolean).map(industryLabel).join(', ') || '—')}</div></td>
          <td>${badge(c.status)}</td><td class="num">${num(c.contacts)}</td><td class="num">${num(c.sent)}</td><td class="num">${num(c.replies)}</td><td class="num hide-sm">${money(c.cost)}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty"><h3>No campaigns yet</h3><p>Pick contacts, generate personalized scripts, approve, and voice them.</p><a class="btn primary" href="#/contacts">Choose contacts</a></div>`}
    </div>
    <div class="card">
      <div class="card-head"><h2>Setup</h2><span class="badge ${done === setup.length ? 'green' : 'blue'}">${done}/${setup.length}</span></div>
      <div class="stack">${setup.map(([ok, title, sub, href]) => `<a href="${href}" class="row" style="text-decoration:none;color:inherit;align-items:flex-start;flex-wrap:nowrap">
        <span class="dot ${ok ? 'ok' : ''}" style="margin-top:7px"></span><span><b>${title}</b><br><span class="small muted">${sub}</span></span></a>`).join('')}</div>
      <div class="divider"></div>
      <div class="row between"><span class="muted">Total spend</span><b>${money(t.spend, 2)}</b></div>
      <div class="row between"><span class="muted">Cost per voice drop</span><b>${t.sent ? money(t.spend / t.sent) : '—'}</b></div>
    </div>
  </div>

  <div class="grid g2" style="margin-top:16px">
    <div class="card">
      <div class="card-head"><h2>Latest replies</h2><a href="#/replies" class="small">View all →</a></div>
      ${d.recentReplies.length ? d.recentReplies.map((r) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:nowrap">
        <div style="flex:1;min-width:0"><b>${esc(r.first_name || r.phone || 'Unknown')}</b> <span class="muted small">${esc(r.business_name || '')}</span>
        <div class="small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.body)}</div></div>${badge(r.category)}<span class="small muted nowrap">${ago(r.created_at)}</span></div>`).join('')
        : '<p class="muted">Replies appear here once prospects text back. Set up the GHL reply webhook in Integrations, or paste replies manually.</p>'}
    </div>
    <div class="card">
      <div class="card-head"><h2>Performance by industry</h2></div>
      ${d.byIndustry.length ? `<div class="table-wrap"><table><thead><tr><th>Industry</th><th class="num">Contacts</th><th class="num">Sent</th><th class="num">Replied</th><th class="num">Positive</th></tr></thead><tbody>
      ${d.byIndustry.map((r) => `<tr><td>${esc(industryLabel(r.industry))}</td><td class="num">${num(r.contacts)}</td><td class="num">${num(r.sent)}</td><td class="num">${num(r.replied)}</td><td class="num">${num(r.positive)} <span class="muted small">${pct(r.positive, r.sent)}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Industry results show up after your first campaign.</p>'}
    </div>
  </div>`;
}

const kpi = (l, v, sub) => `<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${sub}</div></div>`;
