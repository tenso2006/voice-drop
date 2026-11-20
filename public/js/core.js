// Small UI toolkit: API client, escaping, toasts, modals, formatting.
export const state = { status: null, options: null, selected: new Set() };

export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(path.startsWith('/') ? path : `/api/${path}`, opts);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && path !== '/auth/login') { location.hash = '#/login'; throw new Error('Login required'); }
  if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
  return data;
}

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const money = (n, d) => (n == null ? '—' : `$${Number(n).toFixed(d ?? (Math.abs(n) < 1 && n !== 0 ? 4 : 2))}`);
export const num = (n) => (n == null ? '—' : Number(n).toLocaleString());
export const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
export const ago = (s) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`; return d.toLocaleDateString();
};
export const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function toast(msg, kind = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`; t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
}

export function modal(html, { drawer = false, onMount } = {}) {
  const o = document.createElement('div');
  o.className = `overlay ${drawer ? '' : 'center'}`;
  o.innerHTML = `<div class="${drawer ? 'drawer' : 'modal'}" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { o.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  o.addEventListener('mousedown', (e) => e.target === o && close());
  o.addEventListener('click', (e) => e.target.closest('[data-close]') && close());
  document.addEventListener('keydown', onKey);
  document.body.append(o);
  onMount?.(o.firstElementChild, close);
  return close;
}

export function confirmDialog({ title, body, confirmText = 'Confirm', danger = false, requireText = null }) {
  return new Promise((resolve) => {
    modal(`<h2>${esc(title)}</h2><div class="stack" style="margin:10px 0 18px">${body}
      ${requireText ? `<label class="field">Type <b>${esc(requireText)}</b> to confirm<input id="cd-in" autocomplete="off"></label>` : ''}</div>
      <div class="btn-row" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" id="cd-ok" ${requireText ? 'disabled' : ''}>${esc(confirmText)}</button></div>`, {
      onMount(el, close) {
        let done = false;
        const fin = (v) => { if (!done) { done = true; resolve(v); close(); } };
        el.querySelector('#cd-in')?.addEventListener('input', (e) => { el.querySelector('#cd-ok').disabled = e.target.value.trim() !== requireText; });
        el.querySelector('#cd-ok').onclick = () => fin(requireText ? el.querySelector('#cd-in').value.trim() : true);
        el.parentElement.addEventListener('click', (e) => e.target.closest('[data-close]') && fin(false));
        el.querySelector('#cd-in')?.focus();
      },
    });
  });
}

// Wrap a button action with a spinner + error toast.
export async function busy(btn, fn) {
  const html = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${html}`; }
  try { return await fn(); } catch (e) { toast(e.message, 'err'); throw e; } finally { if (btn?.isConnected) { btn.disabled = false; btn.innerHTML = html; } }
}

export const STATUS_BADGE = {
  draft: 'badge', scripts_ready: 'badge blue', audio_ready: 'badge blue', scheduled: 'badge amber', running: 'badge green',
  paused: 'badge amber', completed: 'badge navy', stopped: 'badge red',
  not_sent: 'badge', queued: 'badge amber', sending: 'badge amber', sent: 'badge blue', delivered: 'badge green',
  handed_off: 'badge blue', failed: 'badge red', skipped: 'badge', manual: 'badge',
  approved: 'badge green', pending: 'badge', rejected: 'badge red', ok: 'badge green', warn: 'badge amber', blocked: 'badge red',
  interested: 'badge green', demo: 'badge green', pricing: 'badge blue', later: 'badge amber', already_has: 'badge',
  not_interested: 'badge', opt_out: 'badge red', new: 'badge blue', replied: 'badge green', closed: 'badge', ignored: 'badge',
};
export const badge = (s, text) => `<span class="${STATUS_BADGE[s] || 'badge'}">${esc(text || label(s))}</span>`;

export const industryLabel = (key) => state.options?.industries.find((i) => i.key === key)?.label || label(key || 'other');
export const industrySelect = (value, attrs = '') => `<select ${attrs}>${state.options.industries.map((i) => `<option value="${i.key}" ${i.key === value ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}</select>`;

export const ICONS = {
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z',
  dashboard: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z',
  contacts: 'M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-8 1a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm8 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4zm-8 0c-.3 0-.7 0-1.1.1A4.7 4.7 0 0 1 9 18v2H1v-2c0-2 3.6-3.4 7-4z',
  builder: 'M3 17.2V21h3.8l11-11-3.8-3.8zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8z',
  script: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-5 14H7v-2h7zm3-4H7v-2h10zm0-4H7V7h10z',
  voice: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5.3-3A5.3 5.3 0 0 1 12 16.1 5.3 5.3 0 0 1 6.7 11H5a7 7 0 0 0 6 6.7V21h2v-3.3A7 7 0 0 0 19 11z',
  history: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2 4.9l-1.4 1.4A9 9 0 1 0 13 3zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8z',
  replies: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 9h12v2H6zm8 5H6v-2h8zm4-6H6V6h12z',
  costs: 'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z',
  integrations: 'M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z',
  settings: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 3.5-3.5 3.5 3.5 0 0 1-3.5 3.5z',
};
export const icon = (k) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${ICONS[k]}"/></svg>`;
