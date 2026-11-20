import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { config, isTest } from './config.js';
import { db, audit } from './db.js';
import { api } from './routes/api.js';
import { getDeliveryProvider } from './providers/delivery/index.js';
import { handleDeliveryCallback, startWorker } from './services/campaigns.js';
import { ingestReply } from './services/replies.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// ------------------------------------------------------------- auth ---------
const sign = (v) => crypto.createHmac('sha256', config.sessionSecret).update(v).digest('hex');
const sessionValue = () => { const t = String(Date.now()); return `${t}.${sign(t)}`; };
function authed(req) {
  if (!config.appPassword) return true;
  const [t, s] = String(req.cookies?.vd_session || '').split('.');
  if (!t || !s || s.length !== 64) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(t)));
  return ok && Date.now() - Number(t) < 1000 * 60 * 60 * 24 * 14;
}
app.post('/auth/login', (req, res) => {
  const pw = String(req.body?.password || '');
  const a = crypto.createHash('sha256').update(pw).digest();
  const b = crypto.createHash('sha256').update(config.appPassword).digest();
  if (!config.appPassword || !crypto.timingSafeEqual(a, b)) {
    audit('auth.failed', 'auth', null, { ip: req.ip }, 'anonymous');
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.cookie('vd_session', sessionValue(), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 1000 * 60 * 60 * 24 * 14 });
  res.json({ ok: true });
});
app.post('/auth/logout', (req, res) => { res.clearCookie('vd_session'); res.json({ ok: true }); });
app.get('/auth/me', (req, res) => res.json({ authed: authed(req), required: !!config.appPassword }));

// --------------------------------------------------- public: audio + hooks --
// Audio is content-addressed (sha256), so URLs are unguessable; delivery
// providers must be able to fetch them without logging in.
app.get('/media/:file', (req, res) => {
  if (!/^[a-f0-9]{64}\.mp3$/.test(req.params.file)) return res.status(404).end();
  const fp = path.join(config.dataDir, 'audio', req.params.file);
  if (!fs.existsSync(fp)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="voicedrop-${req.params.file.slice(0, 10)}.mp3"`);
  res.type('audio/mpeg').sendFile(fp);
});

function webhookAuth(req, res, next) {
  if (!config.webhookSecret) return res.status(503).json({ error: 'Set WEBHOOK_SECRET to enable webhooks' });
  const token = String(req.query.token || req.get('x-webhook-token') || '');
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(config.webhookSecret).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Bad token' });
  next();
}

// Delivery receipts from voicemail-drop providers
app.all('/webhooks/voicedrop/:provider', webhookAuth, (req, res) => {
  const p = getDeliveryProvider(req.params.provider);
  if (!p?.parseCallback) return res.status(404).json({ error: 'Unknown provider' });
  const events = p.parseCallback({ ...req.query, ...req.body }, req.query);
  res.json(handleDeliveryCallback(req.params.provider, events));
});

// Inbound replies: in GHL create a Workflow → trigger "Customer Replied" (SMS)
// → action "Webhook" POST to /webhooks/ghl/inbound?token=... with
// { contact_id: {{contact.id}}, phone: {{contact.phone}}, message: {{message.body}} }
app.post('/webhooks/ghl/inbound', webhookAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const body = b.message?.body ?? b.message ?? b.body ?? b.text ?? b.customData?.message;
    const r = await ingestReply({
      ghlContactId: b.contact_id || b.contactId || b.contact?.id || b.customData?.contact_id,
      phone: b.phone || b.contact?.phone,
      body: typeof body === 'string' ? body : JSON.stringify(body || ''),
      externalId: b.messageId || b.message_id || b.message?.id ? `ghl_${b.messageId || b.message_id || b.message?.id}` : null,
      source: 'ghl_webhook',
    });
    res.json({ ok: true, category: r.category, duplicate: !!r.duplicate });
  } catch (e) { next(e); }
});

app.get('/health', (req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });

// ---------------------------------------------------------- private API -----
app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'Login required' })), api);

// ------------------------------------------------------------- frontend -----
app.use(express.static(path.join(config.root, 'public'), { index: 'index.html', etag: true, lastModified: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get(/^\/(?!api|media|webhooks|auth).*/, (req, res) => res.sendFile(path.join(config.root, 'public', 'index.html')));

// ------------------------------------------------------------- errors -------
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status && err.status >= 400 && err.status < 600 ? (err.status === 401 && req.path.startsWith('/api/ghl') ? 502 : err.status) : 500;
  if (status >= 500) console.error('[error]', req.method, req.path, err.message);
  res.status(status).json({ error: err.message || 'Server error' });
});

if (!isTest) {
  app.listen(config.port, () => {
    console.log(`Lobsang VoiceDrop running on http://localhost:${config.port}`);
    if (!config.appPassword) console.warn('⚠  APP_PASSWORD is not set. Set it before exposing this app to the internet.');
  });
  startWorker();
}
