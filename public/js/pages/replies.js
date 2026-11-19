import { api, state, esc, ago, toast, modal, busy, badge, label, industryLabel, $, $$ } from '../core.js';

const CATS = ['interested', 'demo', 'pricing', 'later', 'already_has', 'not_interested', 'opt_out'];
let filter = { category: '', status: '' };

export async function render(root) {
  const all = await api(`replies?${new URLSearchParams(filter)}`);
  const inbound = all.filter((r) => r.direction === 'inbound');
  root.innerHTML = `
  <div class="page-head"><div><h1>Replies &amp; Conversations</h1><p>Every reply is categorized, scored, and paired with a suggested response. Nothing is sent until you click Send.</p></div>
    <div class="btn-row"><button class="btn" id="add">+ Add reply manually</button><button class="btn primary" id="pull" ${state.status.ghl.configured ? '' : 'disabled title="Configure GHL first"'}>↻ Pull from GHL</button></div></div>
  <div class="card" style="margin-bottom:14px"><div class="row">
    <select id="fc" style="max-width:220px"><option value="">All categories</option>${CATS.map((c) => `<option value="${c}" ${filter.category === c ? 'selected' : ''}>${label(c)}</option>`).join('')}</select>
    <select id="fs" style="max-width:180px"><option value="">Any status</option>${['new', 'replied', 'ignored', 'closed'].map((c) => `<option ${filter.status === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <span class="spacer"></span><span class="small muted">Opt-outs are added to the suppression list automatically.</span></div></div>
  ${inbound.length ? inbound.map(card).join('') : '<div class="card empty"><h3>No replies yet</h3><p>Connect the GHL reply webhook (see Integrations), pull from GHL, or add a reply manually to try the assistant.</p></div>'}`;
  $('#fc').onchange = (e) => { filter.category = e.target.value; render(root); };
  $('#fs').onchange = (e) => { filter.status = e.target.value; render(root); };
  $('#pull').onclick = (e) => busy(e.currentTarget, async () => { const r = await api('replies/pull', { method: 'POST' }); toast(`Checked ${r.checked} conversations · ${r.added} new replies`, 'ok'); render(root); });
  $('#add').onclick = () => addDialog(root);
  $$('.reply').forEach((el) => bind(el, root));
}

const card = (r) => `<div class="reply" data-id="${r.id}">
  <div class="row between"><div><b>${esc([r.first_name, r.last_name].filter(Boolean).join(' ') || r.phone || 'Unknown contact')}</b>
    <span class="muted small">${esc(r.business_name || '')}${r.industry ? ` · ${esc(industryLabel(r.industry))}` : ''}${r.campaign_name ? ` · ${esc(r.campaign_name)}` : ''}</span></div>
    <div class="row">${badge(r.category)} <span class="small muted">${Math.round((r.confidence || 0) * 100)}% · ${esc(r.classified_by || '')}</span> ${badge(r.status)} <span class="small muted">${ago(r.created_at)}</span></div></div>
  <div style="margin:10px 0"><span class="bubble">${esc(r.body)}</span></div>
  ${r.category === 'opt_out' ? '<div class="notice danger small">Opted out. Number suppressed; no further outreach will be sent.</div>' : `
  <label class="field">Suggested reply<textarea class="sugg" style="min-height:80px">${esc(r.suggested_reply || '')}</textarea></label>
  <div class="row between" style="margin-top:8px">
    <div class="btn-row"><select class="cat" style="width:auto;padding:5px 8px">${CATS.map((c) => `<option value="${c}" ${c === r.category ? 'selected' : ''}>${label(c)}</option>`).join('')}</select>
      <button class="btn sm" data-ai ${state.status.ai.active === 'template' ? 'disabled title="No AI provider configured"' : ''}>✨ AI rewrite</button>
      <button class="btn sm ghost" data-copy>Copy</button><button class="btn sm ghost" data-ignore>Mark handled</button></div>
    <button class="btn sm primary" data-send ${r.source === 'ghl' && state.status.ghl.configured ? '' : 'disabled title="Only GHL contacts can be replied to from here"'}>Send via GHL SMS</button>
  </div>`}</div>`;

function bind(el, root) {
  const id = el.dataset.id;
  $('.cat', el)?.addEventListener('change', async (e) => { await api(`replies/${id}`, { method: 'PATCH', body: { category: e.target.value } }); toast('Category updated', 'ok'); render(root); });
  $('[data-ai]', el)?.addEventListener('click', (e) => busy(e.currentTarget, async () => { const r = await api(`replies/${id}/rewrite`, { method: 'POST', body: {} }); $('.sugg', el).value = r.suggested_reply; }));
  $('[data-copy]', el)?.addEventListener('click', () => { navigator.clipboard.writeText($('.sugg', el).value); toast('Copied', 'ok'); });
  $('[data-ignore]', el)?.addEventListener('click', async () => { await api(`replies/${id}`, { method: 'PATCH', body: { status: 'ignored' } }); render(root); });
  $('[data-send]', el)?.addEventListener('click', (e) => busy(e.currentTarget, async () => { await api(`replies/${id}/send`, { method: 'POST', body: { text: $('.sugg', el).value } }); toast('Reply sent', 'ok'); render(root); }));
}

function addDialog(root) {
  modal(`<h2>Add a reply</h2><p class="muted">Paste a reply you received elsewhere. The contact is matched by phone number.</p>
    <div class="stack"><label class="field">Phone number<input id="ph" placeholder="+1 512 555 0100"></label>
    <label class="field">Message<textarea id="bd" placeholder="e.g. How much does it cost?"></textarea></label></div>
    <div class="btn-row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Classify &amp; add</button></div>`, {
    onMount(el, close) {
      el.querySelector('#go').onclick = (e) => busy(e.currentTarget, async () => {
        const r = await api('replies', { method: 'POST', body: { phone: el.querySelector('#ph').value, body: el.querySelector('#bd').value } });
        toast(`Classified as ${label(r.category)}`, 'ok'); close(); render(root);
      });
    },
  });
}
