import { api, state, esc, num, toast, modal, busy, badge, industryLabel, industrySelect, $, $$ } from '../core.js';

const f = { q: '', tag: '', industry: '', stage: '', source: '', consent: '', field: '', fieldValue: '', page: 1, pageSize: 50 };

export async function render(root) {
  const facets = await api('contacts/facets');
  root.innerHTML = `
  <div class="page-head"><div><h1>Contacts</h1><p>Pick the prospects to reach. Data is read from GHL and cached locally; nothing is written back without your permission.</p></div>
    <div class="btn-row">
      <button class="btn" id="csv">Import CSV</button>
      <button class="btn primary" id="sync" ${state.status.ghl.configured ? '' : 'title="Configure GHL in Integrations first"'}>↻ Sync from GHL</button>
    </div></div>
  ${facets.total ? '' : `<div class="notice" style="margin-bottom:16px">No contacts yet. ${state.status.ghl.configured ? 'Click <b>Sync from GHL</b> to import your location\'s contacts.' : 'Connect GoHighLevel in <a href="#/integrations">Integrations</a>, or import a CSV (<a href="/sample-contacts.csv" download>download a sample</a>).'}</div>`}
  <div class="card">
    <div class="form-grid" style="grid-template-columns:2fr repeat(5,minmax(130px,1fr))">
      <input id="q" placeholder="Search name, business, phone, city…" value="${esc(f.q)}">
      <select id="tag"><option value="">All tags</option>${facets.tags.map((t) => `<option ${t.tag === f.tag ? 'selected' : ''} value="${esc(t.tag)}">${esc(t.tag)} (${t.n})</option>`).join('')}</select>
      <select id="industry"><option value="">All industries</option>${facets.industries.map((i) => `<option ${i.industry === f.industry ? 'selected' : ''} value="${i.industry}">${esc(industryLabel(i.industry))} (${i.n})</option>`).join('')}</select>
      <select id="stage"><option value="">Any pipeline stage</option>${facets.stages.map((s) => `<option ${s.stage === f.stage ? 'selected' : ''} value="${esc(s.stage)}">${esc(s.stage)} (${s.n})</option>`).join('')}</select>
      <select id="consent"><option value="">Any consent</option><option value="voice" ${f.consent === 'voice' ? 'selected' : ''}>Voice consent on file</option><option value="none" ${f.consent === 'none' ? 'selected' : ''}>No voice consent</option></select>
      <select id="source"><option value="">All sources</option><option value="ghl" ${f.source === 'ghl' ? 'selected' : ''}>GHL</option><option value="csv" ${f.source === 'csv' ? 'selected' : ''}>CSV</option></select>
    </div>
    <div class="row" style="margin-top:10px">
      <select id="field" style="max-width:220px"><option value="">Custom field…</option>${facets.fields.map((k) => `<option ${k === f.field ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      <input id="fieldValue" placeholder="contains… (blank = has any value)" style="max-width:260px" value="${esc(f.fieldValue)}">
      <button class="btn sm ghost" id="clear">Clear filters</button>
      <span class="spacer"></span>
      <span id="selinfo" class="small"></span>
    </div>
    <div id="list" style="margin-top:14px"></div>
  </div>`;

  let t;
  const reload = () => { f.page = 1; load(); };
  $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; reload(); }, 250); };
  for (const k of ['tag', 'industry', 'stage', 'consent', 'source', 'field']) $(`#${k}`).onchange = (e) => { f[k] = e.target.value; reload(); };
  $('#fieldValue').onchange = (e) => { f.fieldValue = e.target.value; reload(); };
  $('#clear').onclick = () => { Object.assign(f, { q: '', tag: '', industry: '', stage: '', source: '', consent: '', field: '', fieldValue: '' }); render(root); };
  $('#sync').onclick = (e) => syncDialog(root);
  $('#csv').onclick = () => csvDialog(root);
  await load();
}

async function load() {
  const data = await api(`contacts?${new URLSearchParams(f)}`);
  const sel = state.selected;
  const allOnPage = data.rows.length && data.rows.every((r) => sel.has(r.id));
  $('#list').innerHTML = data.rows.length ? `
    <div class="row between" style="margin-bottom:10px">
      <div class="btn-row">
        <button class="btn sm" id="selpage">${allOnPage ? 'Deselect page' : 'Select page'}</button>
        <button class="btn sm" id="selall">Select all ${num(data.total)} matching</button>
        <button class="btn sm ghost" id="selnone">Deselect all</button>
      </div>
      <button class="btn primary" id="mkcamp" ${sel.size ? '' : 'disabled'}>Create campaign with ${num(sel.size)} selected →</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th style="width:34px"><input type="checkbox" id="chkpage" ${allOnPage ? 'checked' : ''}></th>
      <th>Contact</th><th>Business</th><th class="hide-sm">Phone</th><th>Industry</th><th class="hide-sm">Tags</th><th>Compliance</th></tr></thead><tbody>
    ${data.rows.map((c) => `<tr>
      <td><input type="checkbox" data-id="${esc(c.id)}" ${sel.has(c.id) ? 'checked' : ''}></td>
      <td><a href="#" data-open="${esc(c.id)}"><b>${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)')}</b></a><div class="small muted">${esc([c.city, c.state].filter(Boolean).join(', '))}</div></td>
      <td>${esc(c.business_name || '—')}${c.pipeline_stage ? `<div class="small muted">${esc(c.pipeline_stage)}</div>` : ''}</td>
      <td class="hide-sm mono nowrap">${esc(c.phone || '—')}<div class="small muted">${esc(c.line_type)}</div></td>
      <td>${industrySelect(c.industry, `data-ind="${esc(c.id)}" style="padding:4px 8px;font-size:12.5px;min-width:150px"`)}<div class="small muted">${c.industry_source === 'manual' ? 'manual' : 'auto-detected'}</div></td>
      <td class="hide-sm">${c.tags.slice(0, 4).map((x) => `<span class="tag">${esc(x)}</span>`).join('')}${c.tags.length > 4 ? `<span class="small muted">+${c.tags.length - 4}</span>` : ''}</td>
      <td>${c.dnd ? badge('blocked', 'DND') : ''} ${c.consent_voice ? badge('ok', 'Voice consent') : badge('warn', 'No voice consent')} ${c.consent_sms ? badge('ok', 'SMS') : ''}</td>
    </tr>`).join('')}</tbody></table></div>
    <div class="row between" style="margin-top:10px"><span class="small muted">${num((data.page - 1) * data.pageSize + 1)}–${num(Math.min(data.total, data.page * data.pageSize))} of ${num(data.total)}</span>
      <div class="btn-row"><button class="btn sm" id="prev" ${data.page <= 1 ? 'disabled' : ''}>← Prev</button><button class="btn sm" id="next" ${data.page * data.pageSize >= data.total ? 'disabled' : ''}>Next →</button>
      <select id="psize" style="width:auto;padding:4px 8px">${[25, 50, 100, 250].map((n) => `<option ${n === f.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>`
    : '<div class="empty"><h3>No contacts match</h3><p>Try clearing filters, syncing from GHL, or importing a CSV.</p></div>';

  const updateSel = () => { $('#selinfo').innerHTML = sel.size ? `<b>${num(sel.size)}</b> selected` : ''; const b = $('#mkcamp'); if (b) { b.disabled = !sel.size; b.textContent = `Create campaign with ${num(sel.size)} selected →`; } };
  updateSel();
  $$('[data-id]').forEach((cb) => (cb.onchange = () => { cb.checked ? sel.add(cb.dataset.id) : sel.delete(cb.dataset.id); updateSel(); }));
  const pageToggle = () => { const on = !data.rows.every((r) => sel.has(r.id)); data.rows.forEach((r) => (on ? sel.add(r.id) : sel.delete(r.id))); load(); };
  $('#chkpage') && ($('#chkpage').onchange = pageToggle);
  $('#selpage') && ($('#selpage').onclick = pageToggle);
  $('#selall') && ($('#selall').onclick = () => { data.allIds.forEach((id) => sel.add(id)); load(); });
  $('#selnone') && ($('#selnone').onclick = () => { sel.clear(); load(); });
  $('#prev') && ($('#prev').onclick = () => { f.page--; load(); });
  $('#next') && ($('#next').onclick = () => { f.page++; load(); });
  $('#psize') && ($('#psize').onchange = (e) => { f.pageSize = Number(e.target.value); f.page = 1; load(); });
  $('#mkcamp') && ($('#mkcamp').onclick = () => { location.hash = '#/builder/new'; });
  $$('[data-ind]').forEach((s) => (s.onchange = async () => { await api(`contacts/${encodeURIComponent(s.dataset.ind)}`, { method: 'PATCH', body: { industry: s.value } }); toast('Industry updated (local only)', 'ok'); }));
  $$('[data-open]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openContact(a.dataset.open, load); }));
}

export async function openContact(id, onChange) {
  const c = await api(`contacts/${encodeURIComponent(id)}`);
  modal(`<div class="row between"><h2>${esc([c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone)}</h2><button class="btn sm ghost" data-close>✕</button></div>
    <p class="muted">${esc(c.business_name || '')} · ${badge(c.compliance.status, `Compliance: ${c.compliance.status}`)}</p>
    ${c.compliance.notes.length ? `<ul class="notes">${c.compliance.notes.map((n) => `<li class="${n.level}">• ${esc(n.msg)}</li>`).join('')}</ul>` : ''}
    <div class="divider"></div>
    <dl class="kv">
      <dt>Phone</dt><dd class="mono">${esc(c.phone || '—')}</dd><dt>Email</dt><dd>${esc(c.email || '—')}</dd>
      <dt>Location</dt><dd>${esc([c.city, c.state].filter(Boolean).join(', ') || '—')}</dd>
      <dt>Calling window</dt><dd>${esc(c.window.start)}–${esc(c.window.end)} ${esc(c.window.tz)}</dd>
      <dt>Industry</dt><dd>${esc(industryLabel(c.industry))} <span class="muted small">(${c.industry_source})</span></dd>
      <dt>Pipeline</dt><dd>${esc(c.pipeline_stage || '—')}</dd><dt>Website</dt><dd>${esc(c.website || '—')}</dd>
      <dt>Source</dt><dd>${esc(c.source.toUpperCase())} <span class="mono small muted">${esc(c.external_id)}</span></dd>
      <dt>DND</dt><dd>${c.dnd ? 'All channels' : Object.entries(c.dnd_channels).filter(([, v]) => v === 'active').map(([k]) => k).join(', ') || 'No'}</dd>
      <dt>Tags</dt><dd>${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') || '—'}</dd>
    </dl>
    <h3 style="margin-top:16px">Consent record</h3>
    <div class="stack">
      <label class="field">Line type<select id="lt">${['unknown', 'mobile', 'landline', 'voip'].map((x) => `<option ${x === c.line_type ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="cv" ${c.consent_voice ? 'checked' : ''}> Prior express written consent for prerecorded / AI voice messages is on file</label>
      <label class="check"><input type="checkbox" id="cs" ${c.consent_sms ? 'checked' : ''}> Consent for marketing SMS is on file</label>
      <label class="field">Consent source / note<input id="cn" placeholder="e.g. Web form 2026-03-02, IP 1.2.3.4" value="${esc(c.consent_note || '')}"></label>
      <button class="btn primary" id="savec">Save consent (local + audit log)</button>
    </div>
    ${Object.keys(c.custom_fields).length ? `<h3 style="margin-top:16px">Custom fields</h3><dl class="kv">${Object.entries(c.custom_fields).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd>`).join('')}</dl>` : ''}
    <h3 style="margin-top:16px">Outreach history</h3>
    ${c.history.length ? c.history.map((h) => `<div class="row small" style="padding:4px 0"><a href="#/campaign/${h.campaign_id}">${esc(h.campaign_name)}</a> ${badge(h.delivery_status)} ${h.reply_category ? badge(h.reply_category) : ''}</div>`).join('') : '<p class="muted small">Never contacted.</p>'}
  `, {
    drawer: true,
    onMount(el, close) {
      el.querySelector('#savec').onclick = (e) => busy(e.currentTarget, async () => {
        await api(`contacts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { consent_voice: el.querySelector('#cv').checked, consent_sms: el.querySelector('#cs').checked, consent_note: el.querySelector('#cn').value, line_type: el.querySelector('#lt').value } });
        toast('Consent saved and logged', 'ok'); close(); onChange?.();
      });
    },
  });
}

function syncDialog(root) {
  if (!state.status.ghl.configured) return toast('Add GHL_PRIVATE_TOKEN and GHL_LOCATION_ID in .env first (see Integrations).', 'err');
  modal(`<h2>Sync contacts from GoHighLevel</h2>
    <p class="muted">Reads contacts, tags, custom fields, DND status, and pipeline stages. Read-only.</p>
    <div class="stack">
      <label class="field">Only contacts with tag <span class="hint">(optional; tip: use a GHL smart-list workflow to tag contacts)</span><input id="stag" placeholder="e.g. voicedrop-prospect"></label>
      <label class="field">Search query <span class="hint">(optional)</span><input id="sq"></label>
      <label class="field">Max contacts<input id="smax" type="number" value="2000" min="1" max="20000"></label>
      <label class="check"><input type="checkbox" id="spipe" checked> Include pipeline stages (extra API calls)</label>
    </div>
    <div class="btn-row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Start sync</button></div>`, {
    onMount(el, close) {
      el.querySelector('#go').onclick = (e) => busy(e.currentTarget, async () => {
        const r = await api('contacts/sync', { method: 'POST', body: { tag: el.querySelector('#stag').value.trim(), query: el.querySelector('#sq').value.trim(), max: Number(el.querySelector('#smax').value), withPipelines: el.querySelector('#spipe').checked } });
        toast(`Synced ${r.count} contacts`, 'ok'); close(); render(root);
      });
    },
  });
}

function csvDialog(root) {
  modal(`<h2>Import contacts from CSV</h2>
    <p class="muted">Columns recognized: first_name, last_name (or name), business_name/company, phone (required), email, city, state, timezone, website, tags (separated by ;), industry, line_type, consent_voice, consent_sms, consent_note, dnd. Other columns become custom fields.</p>
    <p><a href="/sample-contacts.csv" download>Download sample CSV</a></p>
    <input type="file" id="file" accept=".csv,text/csv">
    <div class="btn-row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Import</button></div>`, {
    onMount(el, close) {
      el.querySelector('#go').onclick = (e) => busy(e.currentTarget, async () => {
        const file = el.querySelector('#file').files[0];
        if (!file) throw new Error('Choose a CSV file');
        const form = new FormData(); form.append('file', file);
        const r = await api('contacts/import', { method: 'POST', form });
        toast(`Imported ${r.imported} contacts${r.skipped ? ` · ${r.skipped} skipped (no phone)` : ''}`, 'ok'); close(); render(root);
      });
    },
  });
}
