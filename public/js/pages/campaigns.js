import { api, state, esc, money, num, pct, ago, toast, modal, busy, badge, label, industryLabel, industrySelect, confirmDialog, $, $$ } from '../core.js';

const TONE_L = { friendly: 'Friendly', conversational: 'Conversational', professional: 'Professional', curiosity: 'Curiosity-driven', bold: 'Bold' };
const OFFER_L = { voice: 'AI Voice Agent', text: 'Missed Call Text Back', both: 'Both' };
const CTA_L = { reply_text: 'Reply to my text', visit_demo: 'Visit demo page', schedule_call: 'Schedule a quick call' };
const PERS_L = { basic: 'Basic (first name)', advanced: 'Advanced (+ business & city)', business: 'Business-specific (AI per contact)' };

const seg = (name, values, current, labels) => `<div class="seg" data-seg="${name}">${values.map((v) => `<button type="button" data-v="${v}" class="${String(v) === String(current) ? 'on' : ''}">${esc(labels?.[v] ?? v)}</button>`).join('')}</div>`;

export function optionsForm(o) {
  const opts = state.options;
  const providers = opts.tts;
  const prov = providers.find((p) => p.name === o.voice?.provider) || providers.find((p) => p.configured) || providers[0];
  return `<div class="stack">
    <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
      <label class="field">Outreach tone ${seg('tone', opts.tones, o.tone, TONE_L)}</label>
      <label class="field">Message length ${seg('duration', opts.durations, o.duration, Object.fromEntries(opts.durations.map((d) => [d, `${d}s`])))}</label>
      <label class="field">Primary offer ${seg('offer', opts.offers, o.offer, OFFER_L)}</label>
      <label class="field">Call to action ${seg('cta', opts.ctas, o.cta, CTA_L)}</label>
    </div>
    <label class="field">Personalization ${seg('personalization', opts.personalization, o.personalization, PERS_L)}</label>
    <div class="row">
      <label class="check"><input type="checkbox" data-opt="useAI" ${o.useAI ? 'checked' : ''}> Polish with AI <span class="muted small">(${state.status.ai.active === 'template' ? 'no AI key set: free templates will be used' : `${esc(state.status.ai.model)}: one call per industry, cached`})</span></label>
      <label class="check"><input type="checkbox" data-opt="includeCallback" ${o.includeCallback ? 'checked' : ''}> Say callback number at the end</label>
      <label class="check"><input type="checkbox" data-opt="sendSms" ${o.sendSms ? 'checked' : ''}> Send follow-up SMS after delivery (GHL, consent required)</label>
    </div>
    <div class="divider"></div>
    <h3>Voice</h3>
    <div class="form-grid">
      <label class="field">Provider<select data-voice="provider">${providers.map((p) => `<option value="${p.name}" ${p.name === prov.name ? 'selected' : ''}>${esc(p.label)}${p.configured ? '' : ' (not configured)'}</option>`).join('')}</select></label>
      <label class="field">Voice<select data-voice="voice">${prov.voices.map((v) => `<option value="${v.id}" ${v.id === o.voice?.voice ? 'selected' : ''}>${esc(v.name)} · ${v.gender} · ${esc(v.note)}</option>`).join('')}</select></label>
      <label class="field">Speaking style<select data-voice="style">${state.options.ttsStyles.map((s) => `<option ${s === o.voice?.style ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="field">Speed <span class="hint" data-speedv>${Number(o.voice?.speed || 1).toFixed(2)}×</span><input type="range" min="0.8" max="1.2" step="0.05" data-voice="speed" value="${o.voice?.speed || 1}"></label>
    </div>
  </div>`;
}

export function bindOptions(el, onChange) {
  $$('[data-seg]', el).forEach((s) => s.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', s).forEach((x) => x.classList.toggle('on', x === b)); onChange?.();
  }));
  $$('[data-opt]', el).forEach((i) => i.addEventListener('change', () => onChange?.()));
  const provSel = $('[data-voice=provider]', el);
  provSel?.addEventListener('change', () => {
    const p = state.options.tts.find((x) => x.name === provSel.value);
    $('[data-voice=voice]', el).innerHTML = p.voices.map((v) => `<option value="${v.id}">${esc(v.name)} · ${v.gender} · ${esc(v.note)}</option>`).join('');
    onChange?.();
  });
  $('[data-voice=speed]', el)?.addEventListener('input', (e) => { $('[data-speedv]', el).textContent = `${Number(e.target.value).toFixed(2)}×`; });
  $$('[data-voice]', el).forEach((i) => i.addEventListener('change', () => onChange?.()));
}

export function readOptions(el) {
  const o = {};
  $$('[data-seg]', el).forEach((s) => { const v = $('button.on', s)?.dataset.v; o[s.dataset.seg] = s.dataset.seg === 'duration' ? Number(v) : v; });
  $$('[data-opt]', el).forEach((i) => (o[i.dataset.opt] = i.checked));
  o.voice = {};
  $$('[data-voice]', el).forEach((i) => (o.voice[i.dataset.voice] = i.dataset.voice === 'speed' ? Number(i.value) : i.value));
  return o;
}

// ============================================================== router =====
export async function render(root, { path, rest }) {
  if (path === 'campaign') return workspace(root, Number(rest[0]), rest[1] || 'scripts');
  if (path === 'builder' && rest[0] === 'new') return newCampaign(root);
  return list(root, path);
}

async function list(root, path) {
  const rows = await api('campaigns');
  const isHistory = path === 'history';
  const shown = isHistory ? rows : rows.filter((c) => !['completed', 'stopped'].includes(c.status));
  root.innerHTML = `
  <div class="page-head"><div><h1>${isHistory ? 'Campaign History' : 'Campaign Builder'}</h1>
    <p>${isHistory ? 'Every campaign, its delivery results, replies, and cost.' : 'Build a campaign: choose contacts, set the message, approve scripts, voice them, then review and launch.'}</p></div>
    <div class="btn-row"><a class="btn primary" href="#/builder/new">+ New campaign</a></div></div>
  ${shown.length ? `<div class="table-wrap"><table><thead><tr><th>Campaign</th><th>Status</th><th class="num">Contacts</th><th class="num">Approved</th><th class="num">Audio</th>
    <th class="num">Sent</th><th class="num">Failed</th><th class="num">Replies</th><th class="num">Cost</th><th class="num hide-sm">Per delivery</th><th class="hide-sm">Created</th></tr></thead><tbody>
    ${shown.map((c) => `<tr class="clickable" data-go="${c.id}"><td><b>${esc(c.name)}</b><div class="small muted">${esc((c.industries || '').split(',').filter(Boolean).map(industryLabel).join(', ') || '—')}</div></td>
      <td>${badge(c.status)}${c.scheduled_at && c.status === 'scheduled' ? `<div class="small muted">${new Date(c.scheduled_at).toLocaleString()}</div>` : ''}</td>
      <td class="num">${num(c.contacts)}</td><td class="num">${num(c.approved)}</td><td class="num">${num(c.audio)}</td><td class="num">${num(c.sent)}</td>
      <td class="num ${c.failed ? 'red-text' : ''}">${num(c.failed)}</td><td class="num">${num(c.replies)}</td><td class="num">${money(c.cost)}</td>
      <td class="num hide-sm">${c.costPerDelivery == null ? '—' : money(c.costPerDelivery)}</td><td class="hide-sm small muted">${ago(c.created_at)}</td></tr>`).join('')}
  </tbody></table></div>` : `<div class="card empty"><h3>${isHistory ? 'No campaigns yet' : 'No active campaigns'}</h3><p>Select contacts on the Contacts page, then create a campaign.</p><a class="btn primary" href="#/contacts">Choose contacts</a></div>`}`;
  $$('[data-go]').forEach((tr) => (tr.onclick = () => { location.hash = `#/campaign/${tr.dataset.go}/${isHistory ? 'delivery' : 'scripts'}`; }));
}

async function newCampaign(root) {
  const ids = [...state.selected];
  const o = state.options.defaults;
  root.innerHTML = `
  <div class="page-head"><div><h1>New campaign</h1><p>Set how the message should sound. You'll review and edit every script before any audio is generated.</p></div></div>
  <div class="card stack" id="nc">
    <label class="field">Campaign name<input id="name" placeholder="e.g. Austin HVAC – November" value="${esc(defaultName(ids.length))}"></label>
    <div class="notice ${ids.length ? '' : 'warn'}">${ids.length ? `<b>${num(ids.length)}</b> contacts selected. Industries are detected automatically and can be overridden per contact.` : 'No contacts selected. You can create the campaign now and add contacts from the Contacts page later, or <a href="#/contacts">select contacts first</a>.'}</div>
    ${optionsForm(o)}
    <div class="btn-row" style="justify-content:flex-end"><a class="btn" href="#/contacts">Back to contacts</a><button class="btn primary" id="create">Create &amp; generate scripts →</button></div>
  </div>`;
  bindOptions($('#nc'));
  $('#create').onclick = (e) => busy(e.currentTarget, async () => {
    const c = await api('campaigns', { method: 'POST', body: { name: $('#name').value, options: readOptions($('#nc')), contactIds: ids } });
    state.selected.clear();
    if (ids.length) {
      const r = await api(`campaigns/${c.id}/generate`, { method: 'POST', body: {} });
      toast(`Generated ${r.generated} scripts (${r.ai} AI, ${r.template} template)`, 'ok');
      r.errors.slice(0, 2).forEach((m) => toast(m, 'err'));
    }
    location.hash = `#/campaign/${c.id}/scripts`;
  });
}
const defaultName = (n) => `Voice outreach – ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${n ? ` (${n})` : ''}`;

// ============================================================ workspace ====
const TABS = [['settings', 'Settings'], ['scripts', 'Scripts'], ['audio', 'Audio'], ['review', 'Review & launch'], ['delivery', 'Delivery']];

async function workspace(root, id, tab) {
  const { campaign: c, rows } = await api(`campaigns/${id}`);
  const locked = ['running', 'completed', 'scheduled', 'paused', 'stopped'].includes(c.status);
  const approved = rows.filter((r) => r.script_status === 'approved').length;
  const voiced = rows.filter((r) => r.script_status === 'approved' && r.audio_id).length;
  const done = { settings: true, scripts: rows.length && approved === rows.filter((r) => r.compliance_status !== 'blocked').length, audio: approved && voiced === approved, review: locked, delivery: c.status === 'completed' };
  root.innerHTML = `
  <div class="page-head"><div><div class="small muted"><a href="#/builder">Campaigns</a> /</div><h1>${esc(c.name)} ${badge(c.status)}</h1>
    <p>${num(rows.length)} contacts · ${num(approved)} approved · ${num(voiced)} voiced · ${esc(TONE_L[c.options.tone])}, ${c.options.duration}s, ${esc(OFFER_L[c.options.offer])}</p></div>
    <div class="btn-row">
      ${c.status === 'running' || c.status === 'scheduled' ? '<button class="btn" data-run="pause">❚❚ Pause</button>' : ''}
      ${c.status === 'paused' ? '<button class="btn primary" data-run="resume">▶ Resume</button>' : ''}
      ${['running', 'paused', 'scheduled'].includes(c.status) ? '<button class="btn danger-ghost" data-run="stop">■ Stop</button>' : ''}
      ${!['running', 'scheduled'].includes(c.status) ? '<button class="btn ghost red-text" id="del">Delete</button>' : ''}
    </div></div>
  <nav class="steps">${TABS.map(([k, l], i) => `<a href="#/campaign/${id}/${k}" class="${k === tab ? 'on' : ''} ${done[k] && k !== tab ? 'done' : ''}"><span class="n">${done[k] && k !== tab ? '✓' : i + 1}</span>${l}</a>`).join('')}</nav>
  <div id="tab"></div>`;
  $$('[data-run]').forEach((b) => (b.onclick = () => busy(b, async () => {
    if (b.dataset.run === 'stop' && !(await confirmDialog({ title: 'Stop campaign?', body: '<p>Queued voicemail drops will be skipped. This cannot be resumed.</p>', confirmText: 'Stop campaign', danger: true }))) return;
    await api(`campaigns/${id}/${b.dataset.run}`, { method: 'POST' }); workspace(root, id, tab);
  })));
  $('#del')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Delete campaign?', body: '<p>Scripts and delivery records for this campaign are removed. Audio files stay cached. The audit log keeps a record.</p>', confirmText: 'Delete', danger: true }))) return;
    await api(`campaigns/${id}`, { method: 'DELETE' }); location.hash = '#/builder';
  });
  const el = $('#tab');
  const reload = () => workspace(root, id, tab);
  ({ settings: tabSettings, scripts: tabScripts, audio: tabAudio, review: tabReview, delivery: tabDelivery }[tab] || tabScripts)(el, c, rows, reload, locked);
}

function tabSettings(el, c, rows, reload, locked) {
  el.innerHTML = `<div class="card stack" id="opts">
    <label class="field">Campaign name<input id="cname" value="${esc(c.name)}" ${locked ? 'disabled' : ''}></label>
    ${optionsForm(c.options)}
    <div class="notice">Changing tone, length, offer, CTA, or personalization does not rewrite existing scripts. Click <b>Regenerate</b> on the Scripts tab to apply it (edited scripts are kept unless you force it).</div>
    <div class="btn-row" style="justify-content:flex-end"><button class="btn primary" id="save" ${locked ? 'disabled' : ''}>Save settings</button></div>
  </div>
  <div class="card"><div class="card-head"><h3>Contacts in this campaign</h3><a class="btn sm" href="#/contacts">Add contacts…</a></div>
    ${state.selected.size && !locked ? `<div class="notice" style="margin-bottom:10px">You have ${num(state.selected.size)} contacts selected on the Contacts page. <button class="btn sm primary" id="addsel">Add them to this campaign</button></div>` : ''}
    <p class="muted small">${num(rows.length)} contacts. Remove contacts from the Scripts tab.</p></div>`;
  bindOptions($('#opts'));
  $('#save').onclick = (e) => busy(e.currentTarget, async () => { await api(`campaigns/${c.id}`, { method: 'PATCH', body: { name: $('#cname').value, options: readOptions($('#opts')) } }); toast('Saved', 'ok'); reload(); });
  $('#addsel')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await api(`campaigns/${c.id}/contacts`, { method: 'POST', body: { contactIds: [...state.selected] } });
    state.selected.clear(); toast(`Added ${r.added} contacts. Generate their scripts on the Scripts tab.`, 'ok'); reload();
  }));
}

function tabScripts(el, c, rows, reload, locked) {
  const pending = rows.filter((r) => !r.script).length;
  const eligibleDrafts = rows.filter((r) => r.script && r.script_status !== 'approved' && r.compliance_status !== 'blocked' && !r.lint?.issues.includes('Unfilled placeholder'));
  const filter = sessionStorage.getItem('vd_sf') || 'all';
  const shown = rows.filter((r) => filter === 'all' || (filter === 'blocked' ? r.compliance_status === 'blocked' : filter === 'approved' ? r.script_status === 'approved' : r.script_status !== 'approved' && r.compliance_status !== 'blocked'));
  el.innerHTML = `
  <div class="card" style="margin-bottom:14px"><div class="row between">
    <div class="btn-row">
      <button class="btn primary" id="gen" ${locked ? 'disabled' : ''}>${pending ? `Generate ${pending} script${pending > 1 ? 's' : ''}` : 'Regenerate drafts'}</button>
      <button class="btn" id="regen-all" ${locked ? 'disabled' : ''} title="Rewrites every script including edited and approved ones">Force regenerate all</button>
      <button class="btn" id="approve-all" ${locked || !eligibleDrafts.length ? 'disabled' : ''}>✓ Approve ${eligibleDrafts.length} eligible</button>
      <button class="btn ghost" id="recheck">Re-check compliance</button>
    </div>
    ${seg('sf', ['all', 'review', 'approved', 'blocked'], filter, { all: `All (${rows.length})`, review: 'Needs review', approved: 'Approved', blocked: 'Blocked' })}
  </div></div>
  ${!rows.length ? '<div class="card empty"><h3>No contacts in this campaign</h3><p>Select contacts on the Contacts page, then add them from the Settings tab.</p></div>' : ''}
  <div id="srows">${shown.map((r) => scriptRow(r, locked)).join('')}</div>`;

  $('[data-seg=sf]').onclick = (e) => { const b = e.target.closest('button'); if (b) { sessionStorage.setItem('vd_sf', b.dataset.v); tabScripts(el, c, rows, reload, locked); } };
  $('#gen').onclick = (e) => busy(e.currentTarget, async () => { const r = await api(`campaigns/${c.id}/generate`, { method: 'POST', body: {} }); toast(`Generated ${r.generated} (${r.ai} AI · ${r.template} template)`, 'ok'); r.errors.slice(0, 2).forEach((m) => toast(m, 'err')); reload(); });
  $('#regen-all').onclick = async (e) => {
    if (!(await confirmDialog({ title: 'Regenerate every script?', body: '<p>This overwrites edited and approved scripts and resets approvals. Existing audio stays cached and will be reused if a script ends up identical.</p>', confirmText: 'Regenerate all', danger: true }))) return;
    busy(e.target, async () => { await api(`campaigns/${c.id}/generate`, { method: 'POST', body: { force: true } }); reload(); });
  };
  $('#approve-all').onclick = (e) => busy(e.currentTarget, async () => { const r = await api(`campaigns/${c.id}/approve`, { method: 'POST', body: { ids: eligibleDrafts.map((x) => x.id) } }); toast(`Approved ${r.changed}${r.refused.length ? ` · ${r.refused.length} refused by compliance` : ''}`, 'ok'); reload(); });
  $('#recheck').onclick = (e) => busy(e.currentTarget, async () => { const r = await api(`campaigns/${c.id}/compliance`, { method: 'POST' }); toast(`OK ${r.ok} · Warnings ${r.warn} · Blocked ${r.blocked}`); reload(); });

  $$('.script-row').forEach((row) => {
    const id = Number(row.dataset.cc);
    const ta = $('textarea.script', row);
    const save = $('[data-save]', row);
    ta?.addEventListener('input', () => {
      save.hidden = false;
      const words = (ta.value.match(/\b[\w'’-]+\b/g) || []).length;
      $('[data-words]', row).textContent = `${words} words · ~${Math.round(words / 2.8)}s`;
    });
    save?.addEventListener('click', () => busy(save, async () => {
      await api(`campaigns/${c.id}/rows/${id}`, { method: 'PATCH', body: { script: ta.value, sms_text: $('textarea.sms', row)?.value } });
      toast('Script saved. Approval reset; approve it again to voice it.', 'ok'); reload();
    }));
    $('textarea.sms', row)?.addEventListener('input', () => { save.hidden = false; });
    $('[data-approve]', row)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      if (!save.hidden) await api(`campaigns/${c.id}/rows/${id}`, { method: 'PATCH', body: { script: ta.value, sms_text: $('textarea.sms', row)?.value } });
      const r = await api(`campaigns/${c.id}/approve`, { method: 'POST', body: { ids: [id], status: e.currentTarget.dataset.approve } });
      if (r.refused.length) toast('Refused: compliance blocked or unfilled placeholder', 'err');
      reload();
    }));
    $('[data-regen]', row)?.addEventListener('click', (e) => busy(e.currentTarget, async () => { await api(`campaigns/${c.id}/generate`, { method: 'POST', body: { ids: [id], force: true } }); reload(); }));
    $('[data-ind]', row)?.addEventListener('change', (e) => busy(null, async () => { await api(`campaigns/${c.id}/rows/${id}/industry`, { method: 'POST', body: { industry: e.target.value } }); toast('Industry changed, script regenerated', 'ok'); reload(); }));
    $('[data-remove]', row)?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Remove from campaign?', body: '<p>The contact stays in your contact list.</p>', confirmText: 'Remove' }))) return;
      await api(`campaigns/${c.id}/contacts/remove`, { method: 'POST', body: { ids: [id] } }); reload();
    });
  });
}

function scriptRow(r, locked) {
  const editable = !locked && ['not_sent', 'failed', 'skipped', 'manual'].includes(r.delivery_status);
  const blocked = r.compliance_status === 'blocked';
  return `<div class="script-row ${r.script_status === 'approved' ? 'approved' : ''} ${blocked ? 'blocked' : ''}" data-cc="${r.id}">
    <div class="contact-mini">
      <div class="name">${esc([r.first_name, r.last_name].filter(Boolean).join(' ') || '(no name)')}</div>
      <div class="biz">${esc(r.business_name || '—')}</div>
      <div class="small muted mono">${esc(r.phone || '')}</div>
      <div class="small muted">${esc([r.city, r.state].filter(Boolean).join(', '))}</div>
      <div style="margin-top:8px">${industrySelect(r.industry, `data-ind ${editable ? '' : 'disabled'} style="padding:4px 8px;font-size:12.5px"`)}</div>
      <div class="row" style="margin-top:8px;gap:4px">${badge(r.compliance_status || 'pending', blocked ? 'Blocked' : r.compliance_status === 'warn' ? 'Check' : r.compliance_status === 'ok' ? 'Compliant' : 'Unchecked')}${r.consent_voice ? badge('ok', 'Consent') : ''}</div>
      ${r.compliance_notes.length ? `<ul class="notes">${r.compliance_notes.map((n) => `<li class="${n.level}">• ${esc(n.msg)}</li>`).join('')}</ul>` : ''}
    </div>
    <div>
      ${r.script ? `<textarea class="script" ${editable ? '' : 'readonly'} aria-label="Voicemail script">${esc(r.script)}</textarea>
        <div class="script-meta"><span data-words>${r.lint.words} words · ~${Math.round(r.lint.seconds)}s</span>
          <span class="badge">${r.script_source === 'ai' ? 'AI' : r.script_source === 'edited' ? 'Edited' : 'Template'}</span>
          ${r.lint.issues.map((i) => `<span class="badge amber">${esc(i)}</span>`).join('')}</div>
        <details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">Follow-up SMS (${(r.sms_text || '').length} chars)</summary>
          <textarea class="sms" style="min-height:70px;margin-top:6px" ${editable ? '' : 'readonly'}>${esc(r.sms_text || '')}</textarea></details>`
        : '<div class="muted" style="padding:20px 0">No script yet. Click Generate.</div>'}
    </div>
    <div class="stack">
      ${badge(r.script_status)}
      ${r.audio_url ? `<audio controls preload="none" src="${r.audio_url}"></audio>` : ''}
      ${editable ? `<button class="btn sm primary" data-save hidden>Save edits</button>
        ${r.script && !blocked ? (r.script_status === 'approved' ? '<button class="btn sm" data-approve="draft">Unapprove</button>' : '<button class="btn sm primary" data-approve="approved">✓ Approve</button>') : ''}
        ${r.script ? '<button class="btn sm" data-regen>↻ Regenerate</button>' : ''}
        <button class="btn sm ghost red-text" data-remove>Remove</button>` : `<span class="small muted">${badge(r.delivery_status)}</span>`}
    </div>
  </div>`;
}

function tabAudio(el, c, rows, reload, locked) {
  const approved = rows.filter((r) => r.script_status === 'approved');
  const need = approved.filter((r) => !r.audio_id).length;
  const tts = state.status.tts.find((t) => t.name === c.options.voice?.provider) || state.status.tts.find((t) => t.configured);
  el.innerHTML = `
  ${!state.status.tts.some((t) => t.configured) ? '<div class="notice warn" style="margin-bottom:14px">No text-to-speech provider configured. Add <code>OPENAI_API_KEY</code> (recommended, low cost) or <code>ELEVENLABS_API_KEY</code> to <code>.env</code> and restart. See <a href="#/integrations">Integrations</a>.</div>' : ''}
  <div class="card" style="margin-bottom:14px"><div class="row between">
    <div><b>${num(approved.length)}</b> approved scripts · <b>${num(approved.length - need)}</b> voiced · voice <b>${esc(c.options.voice?.voice || 'default')}</b> (${esc(tts?.label || 'n/a')}, ${esc(c.options.voice?.style)}, ${Number(c.options.voice?.speed || 1).toFixed(2)}×)
      <div class="small muted">Audio is generated only for approved scripts. Identical script + voice settings are reused from cache at no cost.</div></div>
    <div class="btn-row">
      <button class="btn primary" id="genaudio" ${need && !locked ? '' : 'disabled'}>🎙 Generate ${need} audio file${need === 1 ? '' : 's'}</button>
      <a class="btn" href="/api/campaigns/${c.id}/download" ${approved.length - need ? '' : 'style="pointer-events:none;opacity:.5"'}>⬇ Download all (ZIP)</a>
    </div></div></div>
  ${approved.length ? `<div class="table-wrap"><table><thead><tr><th>Contact</th><th>Audio</th><th class="num hide-sm">Length</th><th class="hide-sm">Script</th><th></th></tr></thead><tbody>
    ${approved.map((r) => `<tr><td><b>${esc(r.first_name || '')}</b><div class="small muted">${esc(r.business_name || '')}</div></td>
      <td style="min-width:240px">${r.audio_url ? `<audio controls preload="none" src="${r.audio_url}"></audio>` : '<span class="muted small">Not generated</span>'}</td>
      <td class="num hide-sm">${r.audio_duration ? `${Math.round(r.audio_duration)}s` : '—'}</td>
      <td class="hide-sm small" style="max-width:420px">${esc(r.script.slice(0, 160))}…</td>
      <td>${r.audio_url ? `<a class="btn xs" href="${r.audio_url}?download=1">MP3</a>` : ''}</td></tr>`).join('')}
  </tbody></table></div>` : '<div class="card empty"><h3>No approved scripts yet</h3><p>Approve scripts on the Scripts tab first. Audio is never generated for unapproved scripts.</p></div>'}`;
  $('#genaudio').onclick = (e) => busy(e.currentTarget, async () => {
    const r = await api(`campaigns/${c.id}/audio`, { method: 'POST', body: {} });
    toast(`${r.created} new · ${r.reused} reused from cache · ${r.unchanged} unchanged · cost ${money(r.cost)}`, r.failed ? 'err' : 'ok');
    r.errors.slice(0, 1).forEach((m) => toast(m, 'err'));
    reload();
  });
}

async function tabReview(el, c, rows, reload, locked) {
  const [est, review] = await Promise.all([api(`campaigns/${c.id}/estimate`), api(`campaigns/${c.id}/review`)]);
  const line = (k, l) => `<tr><td>${l}<div class="small muted">${esc(est.assumptions[k])}</div></td><td class="num">${money(est.estimated[k])}</td><td class="num">${money(est.actual[k])}</td></tr>`;
  const manual = !state.status.delivery.canSend;
  const sample = rows.find((r) => r.script_status === 'approved' && r.audio_url);
  el.innerHTML = `
  <div class="grid g2">
    <div class="card"><div class="card-head"><h2>Cost estimate</h2><span class="small muted">${num(est.eligible)} eligible of ${num(est.contacts)} · ~${est.assumptions.avgSeconds}s avg</span></div>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Estimated</th><th class="num">Actual so far</th></tr></thead><tbody>
      ${line('ai', 'AI script generation')}${line('tts', 'Audio generation')}${line('delivery', 'Voicemail delivery')}${line('sms', 'Follow-up SMS')}
      <tr><td><b>Total</b></td><td class="num"><b>${money(est.estimated.total, 2)}</b></td><td class="num"><b>${money(est.actual.total, 2)}</b></td></tr>
      </tbody></table></div>
      <p class="small muted" style="margin-top:8px">Cost per successful delivery so far: <b>${est.costPerDelivery == null ? '—' : money(est.costPerDelivery)}</b>. Prices are configurable in <code>.env</code>.</p>
    </div>
    <div class="card"><div class="card-head"><h2>Final review</h2></div>
      <div class="stack">${review.checks.map((x) => `<div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="dot ${x.ok ? 'ok' : x.warnOnly ? 'warn' : 'bad'}" style="margin-top:7px"></span><span>${esc(x.label)}</span></div>`).join('')}</div>
      ${sample ? `<div class="divider"></div><div class="small muted">Sample: ${esc(sample.first_name)} at ${esc(sample.business_name || '')}</div><audio controls preload="none" src="${sample.audio_url}"></audio><p class="small" style="margin-top:6px">${esc(sample.script)}</p>` : ''}
    </div>
  </div>
  <div class="card" id="launchbox">
    ${locked ? `<div class="notice ok">Campaign ${esc(c.status)}${c.launched_at ? ` · launched ${ago(c.launched_at)} by ${esc(c.approved_by || 'owner')}` : ''}. Track progress on the <a href="#/campaign/${c.id}/delivery">Delivery</a> tab.</div>`
    : manual ? `<h2>Manual mode</h2><p>No voicemail-drop provider is connected, so nothing will be sent or marked delivered. Download the approved MP3s with a manifest to use them in any approved tool.</p>
        <a class="btn primary" href="/api/campaigns/${c.id}/download">⬇ Download ${num(review.readyCount)} MP3s + manifest</a>
        <p class="small muted" style="margin-top:10px">To send from here, connect a provider in <a href="#/integrations">Integrations</a>.</p>`
    : `<h2>Launch</h2><p>Messages go out at a controlled rate, only inside each contact's permitted calling hours, and compliance is re-checked for every contact right before sending.</p>
      <div class="form-grid" style="max-width:720px">
        <label class="field">When<select id="when"><option value="now">Start now</option><option value="later">Schedule…</option></select></label>
        <label class="field" id="atwrap" hidden>Start at<input type="datetime-local" id="at"></label>
      </div>
      <div class="btn-row" style="margin-top:14px"><button class="btn primary" id="launch" ${review.canLaunch ? '' : 'disabled'}>Review &amp; launch ${num(review.readyCount)} voice drops</button>
      ${!review.canLaunch ? '<span class="small red-text">Complete the red items above first.</span>' : ''}</div>`}
  </div>`;
  $('#when')?.addEventListener('change', (e) => { $('#atwrap').hidden = e.target.value !== 'later'; });
  $('#launch')?.addEventListener('click', async () => {
    const at = $('#when').value === 'later' ? $('#at').value : null;
    if ($('#when').value === 'later' && !at) return toast('Pick a start time', 'err');
    const typed = await confirmDialog({
      title: 'Launch campaign?',
      body: `<p>You're approving <b>${num(review.readyCount)}</b> personalized voice drops${c.options.sendSms ? ' plus follow-up SMS where consent exists' : ''}, estimated total <b>${money(est.estimated.total, 2)}</b>, ${at ? `starting <b>${new Date(at).toLocaleString()}</b>` : 'starting now'}.</p>
        <p class="small muted">You confirm each recipient has the consent required for prerecorded/AI voice messages and that this campaign complies with the TCPA, applicable state laws, and your provider's policies.</p>`,
      confirmText: 'Launch campaign', requireText: c.name,
    });
    if (!typed) return;
    await busy($('#launch'), async () => {
      await api(`campaigns/${c.id}/launch`, { method: 'POST', body: { confirmName: typed, scheduledAt: at ? new Date(at).toISOString() : null } });
      toast('Campaign launched', 'ok'); location.hash = `#/campaign/${c.id}/delivery`;
    });
  });
}

function tabDelivery(el, c, rows, reload) {
  const count = (fn) => rows.filter(fn).length;
  const sent = count((r) => ['sent', 'delivered', 'handed_off'].includes(r.delivery_status));
  const failed = count((r) => r.delivery_status === 'failed');
  el.innerHTML = `
  <div class="grid g4" style="margin-bottom:14px">
    ${k('Queued', count((r) => r.delivery_status === 'queued'))}${k('Sent / handed off', sent)}${k('Delivered', count((r) => r.delivery_status === 'delivered'))}${k('Failed', failed)}
  </div>
  <div class="card" style="margin-bottom:14px"><div class="row between">
    <span class="muted small">Replies: <b>${count((r) => r.reply_count > 0)}</b> (${pct(count((r) => r.reply_count > 0), sent)}) · SMS sent: <b>${count((r) => r.sms_status === 'sent')}</b> · Skipped: <b>${count((r) => r.delivery_status === 'skipped')}</b></span>
    <div class="btn-row"><button class="btn" id="refresh">↻ Refresh</button><button class="btn" id="retry" ${failed && ['running', 'paused', 'completed'].includes(c.status) ? '' : 'disabled'}>Retry failed (max 3 attempts)</button></div>
  </div></div>
  <div class="table-wrap"><table><thead><tr><th>Contact</th><th>Voice drop</th><th class="hide-sm">Provider ID</th><th>SMS</th><th>Reply</th><th class="hide-sm">Sent</th><th></th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td><b>${esc(r.first_name || '')}</b> <span class="small muted">${esc(r.business_name || '')}</span><div class="small muted mono">${esc(r.phone)}</div></td>
    <td>${badge(r.delivery_status)}${r.delivery_error ? `<div class="small red-text" style="max-width:260px">${esc(r.delivery_error)}</div>` : ''}${r.delivery_attempts > 1 ? `<div class="small muted">${r.delivery_attempts} attempts</div>` : ''}</td>
    <td class="hide-sm mono small">${esc(r.provider_message_id || '—')}</td>
    <td class="small">${esc(label(r.sms_status))}</td>
    <td>${r.reply_category ? badge(r.reply_category) : '<span class="muted small">—</span>'}${r.lead_score != null ? `<div class="small muted">score ${r.lead_score}</div>` : ''}</td>
    <td class="hide-sm small muted">${ago(r.sent_at)}</td>
    <td class="nowrap"><button class="btn xs" data-hist="${r.id}">History</button>
      ${r.script_status === 'approved' && r.audio_id && ['not_sent', 'skipped', 'manual'].includes(r.delivery_status) && state.status.delivery.canSend ? `<button class="btn xs primary" data-one="${r.id}">Send</button>` : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
  $('#refresh').onclick = reload;
  $('#retry').onclick = (e) => busy(e.currentTarget, async () => { const r = await api(`campaigns/${c.id}/retry`, { method: 'POST', body: {} }); toast(`${r.requeued} re-queued`, 'ok'); reload(); });
  $$('[data-hist]').forEach((b) => (b.onclick = async () => {
    const h = await api(`campaigns/${c.id}/rows/${b.dataset.hist}/history`);
    modal(`<div class="row between"><h2>Delivery history</h2><button class="btn sm ghost" data-close>✕</button></div>
      ${h.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Kind</th><th>Status</th><th>Detail</th></tr></thead><tbody>${h.map((x) => `<tr><td class="small">${esc(x.created_at)}</td><td>${esc(x.kind)}</td><td>${badge(x.status)}</td><td class="small">${esc(x.detail || x.provider_message_id || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No delivery events yet.</p>'}`);
  }));
  $$('[data-one]').forEach((b) => (b.onclick = async () => {
    const r = rows.find((x) => x.id === Number(b.dataset.one));
    if (!(await confirmDialog({ title: `Send to ${r.first_name || r.phone}?`, body: `<p>Sends this one approved voice drop now (if inside their calling hours). Compliance is re-checked first.</p><audio controls src="${r.audio_url}"></audio>`, confirmText: 'Send voice drop' }))) return;
    busy(b, async () => { const res = await api(`campaigns/${c.id}/rows/${r.id}/send`, { method: 'POST', body: { confirm: true } }); toast(res.status === 'deferred' ? `Queued: ${res.reason}` : `Result: ${res.status}${res.error ? ` – ${res.error}` : ''}`, res.status === 'failed' ? 'err' : 'ok'); reload(); });
  }));
  if (['running', 'scheduled'].includes(c.status)) setTimeout(() => location.hash.includes(`/campaign/${c.id}/delivery`) && reload(), 20000);
}
const k = (l, v) => `<div class="card kpi"><div class="label">${l}</div><div class="value">${num(v)}</div></div>`;
