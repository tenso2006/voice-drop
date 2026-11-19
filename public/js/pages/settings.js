import { api, esc, ago, toast, busy, confirmDialog, $, $$ } from '../core.js';
import { refreshStatus } from '../app.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function render(root) {
  const [s, sup, log] = await Promise.all([api('settings'), api('suppression'), api('audit?limit=150')]);
  root.innerHTML = `
  <div class="page-head"><div><h1>Settings</h1><p>Sender identity, compliance safeguards, suppression list, and the audit log.</p></div></div>
  <form id="sf">
  <div class="card"><div class="card-head"><h2>Sender identity</h2></div>
    <div class="form-grid">
      <label class="field">Your name<input name="senderName" value="${esc(s.senderName)}"></label>
      <label class="field">Company<input name="senderCompany" value="${esc(s.senderCompany)}"></label>
      <label class="field">Callback number <span class="hint">said in messages, used as caller ID</span><input name="callbackNumber" value="${esc(s.callbackNumber || '')}" placeholder="+15125550100"></label>
      <label class="field">Demo page URL<input name="demoUrl" value="${esc(s.demoUrl || '')}" placeholder="https://…"></label>
      <label class="field">Booking link<input name="bookingUrl" value="${esc(s.bookingUrl || '')}" placeholder="https://…"></label>
      <label class="field">Follow-up SMS delay (min)<input name="smsFollowupDelayMin" type="number" min="0" max="1440" value="${s.smsFollowupDelayMin}"></label>
    </div></div>

  <div class="card"><div class="card-head"><h2>Compliance safeguards</h2></div>
    <div class="notice warn small" style="margin-bottom:12px">Prerecorded and AI-generated voice messages, including ringless voicemail, are treated as calls under the TCPA. Marketing messages to mobile numbers generally need prior express <b>written</b> consent, and many states add their own rules. These controls help you enforce your policy; they are not legal advice.</div>
    <div class="form-grid">
      <label class="field">Calling window start<input name="quietStart" type="time" value="${esc(s.quietStart)}"></label>
      <label class="field">Calling window end<input name="quietEnd" type="time" value="${esc(s.quietEnd)}"></label>
      <label class="field">Default time zone <span class="hint">when contact has none</span><input name="defaultTimezone" value="${esc(s.defaultTimezone)}"></label>
      <label class="field">No re-contact within (days)<input name="dedupeDays" type="number" min="1" value="${s.dedupeDays}"></label>
    </div>
    <div class="row" style="margin-top:10px"><span class="small bold">Allowed days</span>${DAYS.map((d, i) => `<label class="check"><input type="checkbox" name="day" value="${i}" ${s.allowedDays.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
    <p class="small muted">Stricter state windows (FL, OK, MD, WA, TX) are applied automatically on top of these.</p>
    <div class="stack" style="margin-top:10px">
      <label class="check"><input type="checkbox" name="requireVoiceConsentForMobile" ${s.requireVoiceConsentForMobile ? 'checked' : ''}> Block voice drops to <b>mobile</b> numbers without documented consent</label>
      <label class="check"><input type="checkbox" name="blockUnknownLineType" ${s.blockUnknownLineType ? 'checked' : ''}> Block numbers with <b>unknown</b> line type unless consent is documented (recommended: unknown may be mobile)</label>
      <label class="check"><input type="checkbox" name="requireVoiceConsentAll" ${s.requireVoiceConsentAll ? 'checked' : ''}> Require documented consent for <b>every</b> voice drop</label>
    </div>
    <div class="form-grid" style="margin-top:12px">
      <label class="field">Consent tag in GHL<input name="consentTag" value="${esc(s.consentTag)}"></label>
      <label class="field">Consent custom field key<input name="consentField" value="${esc(s.consentField)}"></label>
      <label class="field">Opt-out tags <span class="hint">comma separated</span><input name="optOutTags" value="${esc(s.optOutTags.join(', '))}"></label>
    </div>
    <div class="divider"></div>
    <label class="check"><input type="checkbox" name="writeBackTags" ${s.writeBackTags ? 'checked' : ''}> <span>Allow VoiceDrop to <b>add tags</b> in GHL to trigger workflows. Off by default; no other contact data is ever changed.</span></label>
    <label class="field" style="max-width:240px;margin-top:8px">Workflow tag prefix<input name="tagPrefix" value="${esc(s.tagPrefix)}"></label>
    <div class="divider"></div>
    <label class="check"><input type="checkbox" name="legalReviewAcknowledged" ${s.legalReviewAcknowledged ? 'checked' : ''}> I confirm my consent process, scripts, and use of voicemail drops have been reviewed for TCPA, Do-Not-Call, state law, and provider policy compliance. <span class="muted">(required to launch campaigns)</span></label>
  </div>
  <div class="btn-row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" id="save">Save settings</button></div>
  </form>

  <div class="card"><div class="card-head"><h2>Suppression list</h2><span class="small muted">${sup.length} numbers never contacted</span></div>
    <div class="row"><input id="supin" placeholder="Phone numbers, separated by commas or new lines" style="flex:1"><input id="supreason" placeholder="Reason" style="max-width:200px"><button class="btn" id="supadd">Add</button></div>
    ${sup.length ? `<div class="table-wrap" style="margin-top:10px;max-height:300px"><table><thead><tr><th>Phone</th><th>Reason</th><th>Source</th><th>Added</th><th></th></tr></thead><tbody>
    ${sup.map((x) => `<tr><td class="mono">${esc(x.phone)}</td><td>${esc(x.reason || '')}</td><td class="small">${esc(x.source || '')}</td><td class="small muted">${ago(x.created_at)}</td><td><button class="btn xs ghost" data-unsup="${esc(x.phone)}">Remove</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}
  </div>

  <div class="card"><div class="card-head"><h2>Audit log</h2><span class="small muted">Consent, approvals, launches, deliveries, opt-outs, settings changes</span></div>
    <div class="table-wrap" style="max-height:420px"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th class="hide-sm">Detail</th></tr></thead><tbody>
    ${log.map((l) => `<tr><td class="small nowrap">${esc(l.created_at)}</td><td class="small">${esc(l.actor)}</td><td><code>${esc(l.action)}</code></td><td class="small">${esc([l.entity, l.entity_id].filter(Boolean).join(' '))}</td>
      <td class="hide-sm small muted" style="max-width:420px;word-break:break-word">${esc(l.detail ? JSON.stringify(l.detail) : '')}</td></tr>`).join('')}
    </tbody></table></div></div>`;

  $('#sf').onsubmit = (e) => {
    e.preventDefault();
    busy($('#save'), async () => {
      const f = e.target;
      const body = {};
      for (const el of f.elements) {
        if (!el.name || el.name === 'day') continue;
        body[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
      }
      body.allowedDays = $$('input[name=day]:checked', f).map((x) => Number(x.value));
      body.optOutTags = body.optOutTags.split(',').map((x) => x.trim()).filter(Boolean);
      if (body.legalReviewAcknowledged && !s.legalReviewAcknowledged && !(await confirmDialog({ title: 'Confirm legal review', body: '<p>This acknowledgement is recorded in the audit log with a timestamp.</p>', confirmText: 'I confirm' }))) return;
      await api('settings', { method: 'PATCH', body });
      await refreshStatus();
      toast('Settings saved', 'ok'); render(root);
    });
  };
  $('#supadd').onclick = (e) => busy(e.currentTarget, async () => { const r = await api('suppression', { method: 'POST', body: { phones: $('#supin').value, reason: $('#supreason').value } }); toast(`${r.added} added`, 'ok'); render(root); });
  root.querySelectorAll('[data-unsup]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog({ title: 'Remove from suppression?', body: `<p>${esc(b.dataset.unsup)} could be contacted again. Only do this if the person re-consented.</p>`, confirmText: 'Remove', danger: true }))) return;
    await api(`suppression/${encodeURIComponent(b.dataset.unsup)}`, { method: 'DELETE' }); render(root);
  }));
}
