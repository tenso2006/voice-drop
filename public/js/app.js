import { api, state, esc, icon, toast, confirmDialog, $ } from './core.js';
import * as dashboard from './pages/dashboard.js';
import * as contacts from './pages/contacts.js';
import * as prospecting from './pages/prospecting.js';
import * as campaigns from './pages/campaigns.js';
import * as scripts from './pages/scripts.js';
import * as voices from './pages/voices.js';
import * as replies from './pages/replies.js';
import * as costs from './pages/costs.js';
import * as integrations from './pages/integrations.js';
import * as settings from './pages/settings.js';

const NAV = [
  ['dashboard', 'Dashboard', 'dashboard', dashboard],
  ['prospecting', 'Prospecting', 'search', prospecting],
  ['contacts', 'Contacts', 'contacts', contacts],
  ['builder', 'Campaign Builder', 'builder', campaigns],
  ['scripts', 'AI Script Generator', 'script', scripts],
  ['voices', 'Voice Library', 'voice', voices],
  ['history', 'Campaign History', 'history', campaigns],
  ['replies', 'Replies & Conversations', 'replies', replies],
  ['costs', 'Cost Analytics', 'costs', costs],
  ['integrations', 'Integrations', 'integrations', integrations],
  ['settings', 'Settings', 'settings', settings],
];

function renderLogin() {
  document.getElementById('app').innerHTML = `<div class="login"><form class="modal" id="login">
    <div class="brand" style="padding:0 0 14px"><div class="brand-mark">${icon('voice')}</div><div><div class="brand-name" style="color:var(--ink)">Lobsang VoiceDrop</div><div class="muted small">Sign in to continue</div></div></div>
    <label class="field">Password<input type="password" name="password" autofocus required></label>
    <button class="btn primary" style="width:100%;margin-top:14px">Sign in</button></form></div>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/auth/login', { method: 'POST', body: { password: e.target.password.value } }); location.hash = '#/dashboard'; boot(); }
    catch (err) { toast(err.message, 'err'); }
  };
}

function shell() {
  const s = state.status;
  const pill = (ok, text, warn) => `<span class="pill"><span class="dot ${ok ? 'ok' : warn ? 'warn' : 'bad'}"></span>${esc(text)}</span>`;
  document.getElementById('app').innerHTML = `
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="brand-mark">${icon('voice')}</div><div><div class="brand-name">Lobsang VoiceDrop</div><div class="brand-sub">Lobsang Solutions</div></div></div>
      <nav class="nav">${NAV.map(([k, l, i]) => `<a href="#/${k}" data-nav="${k}">${icon(i)}<span>${l}</span>${k === 'replies' ? '<span class="badge" id="unread" hidden></span>' : ''}</a>`).join('')}</nav>
      <div class="sidebar-foot">“<em>Every missed call is an opportunity to win a customer.</em>”</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn sm menu-btn" id="menu" aria-label="Menu">☰</button>
        <div class="pills" id="pills">
          ${pill(s.ghl.configured, s.ghl.configured ? 'GHL connected' : 'GHL not set')}
          ${pill(true, s.ai.active === 'template' ? 'Scripts: free templates' : `AI: ${s.ai.model}`, s.ai.active === 'template')}
          ${pill(s.tts.some((t) => t.configured), s.tts.some((t) => t.configured) ? `Voice: ${s.tts.find((t) => t.configured).label}` : 'Voice: not set')}
          ${pill(s.delivery.ready && s.delivery.canSend, s.delivery.canSend ? `Delivery: ${s.delivery.label}` : 'Delivery: manual download', !s.delivery.canSend)}
        </div>
        <div class="spacer"></div>
        <button class="btn sm ${s.settings.globalStop ? 'danger' : 'danger-ghost'}" id="gstop" title="Immediately pause all campaigns">${s.settings.globalStop ? '■ Global stop ON' : '■ Global stop'}</button>
        ${s.auth ? '<button class="btn sm ghost" id="logout">Sign out</button>' : ''}
      </header>
      ${!s.auth ? '<div class="notice warn" style="margin:12px 26px 0">APP_PASSWORD is not set. Anyone who can reach this server can use it. Set it in <code>.env</code> before deploying.</div>' : ''}
      ${s.settings.globalStop ? '<div class="notice danger" style="margin:12px 26px 0"><b>Global stop is ON.</b> No voicemail drops or SMS will be sent until you turn it off.</div>' : ''}
      <main class="content" id="view"></main>
    </div>
  </div>`;
  $('#menu').onclick = () => $('#sidebar').classList.toggle('open');
  $('#gstop').onclick = async () => {
    const on = !state.status.settings.globalStop;
    if (on && !(await confirmDialog({ title: 'Stop all outreach?', body: '<p>This pauses every running or scheduled campaign and blocks all sends until you turn it back off.</p>', confirmText: 'Stop everything', danger: true }))) return;
    await api('settings/global-stop', { method: 'POST', body: { on } });
    await refreshStatus(); shell(); route();
  };
  $('#logout')?.addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.hash = '#/login'; boot(); });
}

export async function refreshStatus() {
  state.status = await api('status');
  const unread = await api('dashboard').then((d) => d.totals.unread).catch(() => 0);
  const el = document.getElementById('unread');
  if (el) { el.hidden = !unread; el.textContent = unread; }
  return state.status;
}

async function route() {
  if (!document.getElementById('view')) return;
  const [path, ...rest] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  const entry = NAV.find(([k]) => k === path) || (path === 'campaign' ? ['builder', '', '', campaigns] : NAV[0]);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === entry[0]));
  $('#sidebar')?.classList.remove('open');
  const view = document.getElementById('view');
  view.innerHTML = '<div class="loading">Loading…</div>';
  window.scrollTo(0, 0);
  try { await entry[3].render(view, { path, rest }); }
  catch (e) { view.innerHTML = `<div class="notice danger">${esc(e.message)}</div>`; }
}

async function boot() {
  const me = await fetch('/auth/me').then((r) => r.json());
  if (me.required && !me.authed) return renderLogin();
  if (location.hash === '#/login') location.hash = '#/dashboard';
  [state.status, state.options] = await Promise.all([api('status'), api('options')]);
  shell();
  refreshStatus();
  route();
}

window.addEventListener('hashchange', () => (location.hash === '#/login' ? renderLogin() : route()));
boot().catch((e) => { document.getElementById('app').innerHTML = `<div class="loading">Could not load the app: ${esc(e.message)}</div>`; });
