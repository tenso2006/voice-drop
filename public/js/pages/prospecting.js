import { api, state, esc, money, num, toast, modal, busy, badge, industryLabel, industrySelect, $, $$ } from '../core.js';

const f = { status: 'new', minScore: 0, sort: 'score', searchId: '' };
const sel = new Set();
const scoreBadge = (s) => `<span class="badge ${s >= 70 ? 'red' : s >= 45 ? 'amber' : ''}" title="Missed-Call Opportunity Score">${s >= 70 ? '🔥 ' : ''}${s}</span>`;

export async function render(root) {
  const meta = await api('prospects/meta');
  const last = JSON.parse(localStorage.getItem('vd_pf') || '{}');
  root.innerHTML = `
  <div class="page-head"><div><h1>Prospecting</h1><p>Find local businesses on Google Maps, ranked by how likely they are losing callers right now.</p></div></div>
  ${meta.configured ? '' : setupCard()}
  <div class="card" id="sform">
    <div class="form-grid" style="grid-template-columns:minmax(180px,1fr) minmax(180px,1.2fr) minmax(180px,1.2fr) 130px auto;align-items:end">
      <label class="field">Industry${industrySelect(last.industry || 'hvac', 'id="ind"')}</label>
      <label class="field">Search term <span class="hint">what you'd type in Google Maps</span><input id="term" value="${esc(last.term ?? meta.terms[last.industry || 'hvac'])}"></label>
      <label class="field">ZIP code, city, or address<input id="loc" placeholder="e.g. 78701 or Austin, TX" value="${esc(last.location || '')}"></label>
      <label class="field">Results<select id="pages"><option value="1">Up to 20</option><option value="2">Up to 40</option><option value="3">Up to 60</option></select></label>
      <button class="btn primary" id="go" ${meta.configured ? '' : 'disabled'}>🔎 Find businesses</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">This month: <b>${num(meta.usage.requests)}</b> Google requests (each returns up to 20 businesses) · Google's free monthly allowance is about ${num(meta.usage.freePerMonth)} requests; beyond it ≈ ${money(meta.usage.costPer1k / 1000, 3)} per request. Websites are checked for booking/chat tools automatically.</p>
  </div>
  <div class="card">
    <div class="row between" style="margin-bottom:12px">
      <div class="row">
        <select id="fstatus" style="width:auto">${['new', 'added', 'dismissed', 'all'].map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${{ new: 'New', added: 'Added', dismissed: 'Dismissed', all: 'All' }[s]}</option>`).join('')}</select>
        <select id="fscore" style="width:auto"><option value="0">Any score</option><option value="45" ${f.minScore == 45 ? 'selected' : ''}>Warm 45+</option><option value="70" ${f.minScore == 70 ? 'selected' : ''}>Hot 70+</option></select>
        <select id="fsearch" style="width:auto;max-width:280px"><option value="">All searches</option>${meta.searches.map((s) => `<option value="${s.id}" ${String(f.searchId) === String(s.id) ? 'selected' : ''}>${esc(s.query)} (${s.results})</option>`).join('')}</select>
        <select id="fsort" style="width:auto"><option value="score">Sort: score</option><option value="reviews" ${f.sort === 'reviews' ? 'selected' : ''}>Sort: reviews</option><option value="name" ${f.sort === 'name' ? 'selected' : ''}>Sort: name</option></select>
      </div>
      <div class="btn-row" id="bulk"></div>
    </div>
    <div id="plist"></div>
  </div>`;

  $('#ind').onchange = (e) => { $('#term').value = meta.terms[e.target.value] ?? ''; };
  $('#go').onclick = (e) => busy(e.currentTarget, async () => {
    const body = { industry: $('#ind').value, term: $('#term').value, location: $('#loc').value, pages: Number($('#pages').value) };
    try { localStorage.setItem('vd_pf', JSON.stringify(body)); } catch { /* ignore */ }
    const r = await api('prospects/search', { method: 'POST', body });
    toast(`Found ${r.results} businesses · ${r.requests} Google request${r.requests > 1 ? 's' : ''}`, 'ok');
    Object.assign(f, { searchId: r.searchId, status: 'new' });
    render(root);
  });
  for (const [id, k] of [['#fstatus', 'status'], ['#fscore', 'minScore'], ['#fsearch', 'searchId'], ['#fsort', 'sort']]) $(id).onchange = (e) => { f[k] = e.target.value; sel.clear(); load(); };
  await load();
}

function setupCard() {
  return `<div class="card" style="border-color:var(--blue-line)"><h2>One-time setup: Google Places API key</h2>
  <ol class="stack" style="padding-left:18px;margin:8px 0 0">
    <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">console.cloud.google.com</a> and sign in. Create a project (e.g. "Lobsang VoiceDrop").</li>
    <li>Open <b>Billing</b> and attach a card. Google requires it even for the free allowance; set a budget alert (e.g. $10) under Billing → Budgets.</li>
    <li>Go to <b>APIs &amp; Services → Library</b>, search <b>"Places API (New)"</b>, and click <b>Enable</b>.</li>
    <li>Go to <b>APIs &amp; Services → Credentials → Create credentials → API key</b>. Click the key, under <b>API restrictions</b> choose <b>Restrict key → Places API (New)</b>, and save.</li>
    <li>Add it to your <code>.env</code> file as <code>GOOGLE_PLACES_API_KEY=your_key</code>, then restart the app.</li>
  </ol></div>`;
}

async function load() {
  const rows = await api(`prospects?${new URLSearchParams(f)}`);
  const ghlOn = state.status.ghl.configured;
  $('#bulk').innerHTML = `<span class="small muted">${sel.size ? `${sel.size} selected` : ''}</span>
    <button class="btn sm" id="selhot">Select 45+</button>
    <button class="btn sm" id="addc" ${sel.size ? '' : 'disabled'}>Add to contacts</button>
    <button class="btn sm primary" id="toghl" ${sel.size && ghlOn ? '' : 'disabled'} title="${ghlOn ? '' : 'Connect GHL first'}">Send to GHL →</button>
    <button class="btn sm ghost" id="dismiss" ${sel.size ? '' : 'disabled'}>Dismiss</button>`;
  $('#plist').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th style="width:32px"><input type="checkbox" id="all"></th><th>Score</th><th>Business</th><th class="hide-sm">Phone</th><th>Why this lead</th><th class="hide-sm">Test call</th><th></th></tr></thead><tbody>
    ${rows.map((p) => `<tr>
      <td><input type="checkbox" data-sel="${esc(p.place_id)}" ${sel.has(p.place_id) ? 'checked' : ''}></td>
      <td>${scoreBadge(p.score)}</td>
      <td><a href="#" data-open="${esc(p.place_id)}"><b>${esc(p.name)}</b></a> ${p.status !== 'new' ? badge(p.status === 'added' ? 'ok' : '', p.status) : ''}
        <div class="small muted">${esc(industryLabel(p.industry))} · ${p.rating ? `★ ${p.rating} (${num(p.review_count)})` : 'no reviews'} · ${esc([p.city, p.state].filter(Boolean).join(', '))}</div>
        ${p.website ? `<a class="small" href="${esc(p.website)}" target="_blank" rel="noopener">website</a>` : '<span class="small amber-text">no website</span>'}${p.maps_url ? ` · <a class="small" href="${esc(p.maps_url)}" target="_blank" rel="noopener">maps</a>` : ''}</td>
      <td class="hide-sm mono nowrap">${p.phone ? `<a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>` : '—'}</td>
      <td class="small" style="max-width:380px">${p.reasons.slice(0, 3).map((r) => `<div>• ${esc(r)}</div>`).join('')}</td>
      <td class="hide-sm nowrap">${testCallButtons(p)}</td>
      <td><button class="btn xs" data-open="${esc(p.place_id)}">Script</button></td>
    </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><h3>No prospects here yet</h3><p>Pick an industry, enter a ZIP code, and click Find businesses.</p></div>';

  const refreshBulk = () => { $('#bulk .small').textContent = sel.size ? `${sel.size} selected` : ''; ['#addc', '#dismiss'].forEach((b) => ($(b).disabled = !sel.size)); $('#toghl').disabled = !sel.size || !ghlOn; };
  $$('[data-sel]').forEach((c) => (c.onchange = () => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); refreshBulk(); }));
  $('#all')?.addEventListener('change', (e) => { rows.forEach((p) => (e.target.checked ? sel.add(p.place_id) : sel.delete(p.place_id))); load(); });
  $('#selhot').onclick = () => { rows.filter((p) => p.score >= 45).forEach((p) => sel.add(p.place_id)); load(); };
  $('#addc').onclick = (e) => busy(e.currentTarget, async () => { const r = await api('prospects/add-contacts', { method: 'POST', body: { ids: [...sel] } }); toast(`Added ${r.added} to Contacts`, 'ok'); sel.clear(); load(); });
  $('#dismiss').onclick = async () => { for (const id of sel) await api(`prospects/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'dismissed' } }); sel.clear(); load(); };
  $('#toghl').onclick = () => sendDialog([...sel]);
  $$('[data-tc]').forEach((b) => (b.onclick = async () => {
    const [id, result] = b.dataset.tc.split('|');
    await api(`prospects/${encodeURIComponent(id)}/test-call`, { method: 'POST', body: { result: result || null } });
    load();
  }));
  $$('[data-open]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openProspect(a.dataset.open); }));
}

function testCallButtons(p) {
  const b = (r, l, cls) => `<button class="btn xs ${p.test_call === r ? cls : ''}" style="margin-right:3px" data-tc="${esc(p.place_id)}|${p.test_call === r ? '' : r}" title="Log a test call result">${l}</button>`;
  return `${b('rang_out', 'Rang out', 'danger')}${b('voicemail', 'VM', 'danger')}${b('answered', 'Answered', 'primary')}`;
}

async function sendDialog(ids) {
  let users = [];
  try { users = await api('ghl/users'); } catch (e) { toast(`Couldn't load GHL users (${e.message}). Leads will be unassigned.`, 'err'); }
  modal(`<h2>Send ${ids.length} lead${ids.length > 1 ? 's' : ''} to GoHighLevel</h2>
    <p class="muted">Creates or updates each business as a GHL contact, tagged <code>voicedrop-prospect</code>, with the opportunity reasons and a full call script added as a note.</p>
    <label class="field">Assign to SDR<select id="sdr"><option value="">Unassigned</option>${users.map((u) => `<option value="${esc(u.id)}">${esc(u.name || u.email)}</option>`).join('')}</select></label>
    <div class="btn-row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="send">Send to GHL</button></div>`, {
    onMount(el, close) {
      el.querySelector('#send').onclick = (e) => busy(e.currentTarget, async () => {
        const r = await api('prospects/send-ghl', { method: 'POST', body: { ids, assignedTo: el.querySelector('#sdr').value || null } });
        toast(`Sent ${r.sent} to GHL${r.failed.length ? ` · ${r.failed.length} failed` : ''}`, r.failed.length ? 'err' : 'ok');
        r.failed.slice(0, 3).forEach((m) => toast(m, 'err'));
        sel.clear(); close(); load();
      });
    },
  });
}

async function openProspect(id) {
  const p = await api(`prospects/${encodeURIComponent(id)}`);
  const s = p.script;
  modal(`<div class="row between"><h2>${esc(p.name)}</h2><button class="btn sm ghost" data-close>✕</button></div>
    <div class="row" style="margin-bottom:8px">${scoreBadge(p.score)} <span class="muted small">${esc(p.address)}</span></div>
    <div class="row">${p.phone ? `<a class="btn sm primary" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">📞 Call ${esc(p.phone)}</a>` : ''}${p.website ? `<a class="btn sm" href="${esc(p.website)}" target="_blank" rel="noopener">Website</a>` : ''}${p.maps_url ? `<a class="btn sm" href="${esc(p.maps_url)}" target="_blank" rel="noopener">Google Maps</a>` : ''}</div>
    <h3 style="margin-top:16px">Why this lead</h3>
    ${p.reasons.length ? `<ul class="small" style="margin:0;padding-left:18px">${p.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p class="small muted">No strong signals yet. Try a test call.</p>'}
    <div class="row" style="margin-top:10px"><span class="small bold">Test call result:</span>${testCallButtons(p)}</div>
    <div class="form-grid" style="margin-top:12px"><label class="field">Industry${industrySelect(p.industry, 'id="pind"')}</label></div>
    ${p.weekday_text.length ? `<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Opening hours</summary><div class="small">${p.weekday_text.map(esc).join('<br>')}</div></details>` : ''}
    <div class="divider"></div>
    <div class="row between"><h3 style="margin:0">Call script</h3><button class="btn xs" id="copy">Copy script</button></div>
    <div class="stack small" style="margin-top:8px">
      <div><b>Gatekeeper</b><br>${esc(s.gatekeeper)}</div>
      <div><b>1. Opener</b><br>${esc(s.opener)}</div>
      <div><b>2. Hook</b><br>${esc(s.hook)}</div>
      <div><b>3. Question</b><br>${esc(s.question)}</div>
      <div><b>4. Pitch</b><br>${esc(s.pitch)}</div>
      <div><b>5. Ask</b><br>${esc(s.ask)}</div>
      <div><b>Objections</b>${s.objections.map(([q, a]) => `<div style="margin-top:4px"><i>${esc(q)}</i>: ${esc(a)}</div>`).join('')}</div>
      <div><b>Voicemail</b> <span class="muted">(leave it yourself during the call)</span><br>${esc(s.voicemail)}</div>
      <div class="notice small">In two-party-consent states, open with: "This call may be recorded for quality."</div>
    </div>`, {
    drawer: true,
    onMount(el, close) {
      el.querySelector('#copy').onclick = () => { navigator.clipboard.writeText(s.text); toast('Script copied', 'ok'); };
      el.querySelector('#pind').onchange = async (e) => { await api(`prospects/${encodeURIComponent(id)}`, { method: 'PATCH', body: { industry: e.target.value } }); close(); openProspect(id); };
      el.querySelectorAll('[data-tc]').forEach((b) => (b.onclick = async () => {
        const [, result] = b.dataset.tc.split('|');
        await api(`prospects/${encodeURIComponent(id)}/test-call`, { method: 'POST', body: { result: result || null } });
        close(); openProspect(id); load();
      }));
    },
  });
}

