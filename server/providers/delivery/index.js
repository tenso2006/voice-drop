// Voicemail-drop delivery abstraction. Each provider implements:
//   send({ to, audioUrl, callerId, contact, campaignContactId, callbackUrl }) -> { providerMessageId, status }
//   parseCallback(body, query) -> [{ providerMessageId, status, detail }]
// GoHighLevel has NO public ringless-voicemail API, so delivery goes through a
// dedicated provider or is handed off to a GHL workflow you control.
import { config } from '../../config.js';
import * as ghl from '../crm/ghl.js';

const STATUS_MAP = (s) => {
  const v = String(s || '').toLowerCase();
  if (/deliver|success|complete|ok|answered|voicemail/.test(v)) return 'delivered';
  if (/fail|error|invalid|reject|undeliver|landline|busy|no.?answer|cancel/.test(v)) return 'failed';
  if (/queue|pending|accepted|sent|process/.test(v)) return 'sent';
  return 'sent';
};

const providers = {
  manual: {
    label: 'Manual (download audio only)',
    description: 'No delivery integration. Preview and download MP3s; nothing is marked delivered.',
    configured: () => true,
    canSend: false,
    needsPublicAudio: false,
  },

  webhook: {
    label: 'Generic webhook (Zapier / Make / n8n / your provider)',
    description: 'POSTs a JSON job to VOICEDROP_WEBHOOK_URL. Your automation forwards it to an approved voicemail-drop provider and calls back /webhooks/voicedrop/webhook with the status.',
    configured: () => !!config.delivery.webhookUrl,
    canSend: true,
    needsPublicAudio: true,
    async send({ to, audioUrl, callerId, contact, campaignContactId, callbackUrl, campaign }) {
      const r = await fetch(config.delivery.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(config.delivery.webhookAuth ? { Authorization: config.delivery.webhookAuth } : {}) },
        body: JSON.stringify({
          type: 'voicedrop.send', external_id: `cc_${campaignContactId}`, to, audio_url: audioUrl, caller_id: callerId,
          callback_url: callbackUrl, campaign: { id: campaign.id, name: campaign.name },
          contact: { id: contact.external_id, source: contact.source, first_name: contact.first_name, business_name: contact.business_name },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`Webhook returned ${r.status}: ${text.slice(0, 200)}`);
      let j = {}; try { j = JSON.parse(text); } catch { /* plain text ok */ }
      return { providerMessageId: String(j.id || j.message_id || j.session_id || `cc_${campaignContactId}`), status: j.status ? STATUS_MAP(j.status) : 'sent' };
    },
    parseCallback(body) {
      const items = Array.isArray(body) ? body : [body];
      return items.map((b) => ({ providerMessageId: String(b.id || b.message_id || b.external_id || ''), externalId: b.external_id, status: STATUS_MAP(b.status), detail: b.reason || b.detail || b.status }));
    },
  },

  slybroadcast: {
    label: 'Slybroadcast',
    description: 'Ringless voicemail via the Slybroadcast API. Verify your account terms and send one test drop to your own phone before any campaign.',
    configured: () => !!(config.delivery.slyUser && config.delivery.slyPassword && config.delivery.slyCallerId),
    canSend: true,
    needsPublicAudio: true,
    async send({ to, audioUrl, callbackUrl }) {
      const form = new URLSearchParams({
        c_uid: config.delivery.slyUser, c_password: config.delivery.slyPassword,
        c_phone: to.replace(/^\+1/, '').replace(/\D/g, ''), c_url: audioUrl, c_audio: 'Mp3',
        c_callerID: config.delivery.slyCallerId.replace(/\D/g, ''), c_date: 'now', mobile_only: '0', c_dispo_url: callbackUrl,
      });
      const r = await fetch('https://www.mobile-sphere.com/gateway/vmb.php', { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
      const text = (await r.text()).trim();
      if (!r.ok || !/^OK/i.test(text)) throw new Error(`Slybroadcast: ${text.slice(0, 200) || r.status}`);
      const id = (text.match(/session_id=([\w-]+)/i) || [])[1] || '';
      return { providerMessageId: id, status: 'sent' };
    },
    parseCallback(body) {
      // Disposition callbacks arrive as var=session_id|phone|status|reason|time
      const v = String(body.var || '');
      const [sid, phone, status, reason] = v.split('|');
      return [{ providerMessageId: sid, phone, status: STATUS_MAP(status), detail: [status, reason].filter(Boolean).join(': ') }];
    },
  },

  ghl_workflow: {
    label: 'GHL workflow handoff',
    description: 'Writes the audio URL into a contact custom field and adds the tag "voicedrop-ready". A GHL workflow you build (trigger: tag added) performs the voicemail step using whatever approved provider/app your account has. Status is "handed off", not delivered.',
    configured: () => ghl.ghlConfigured() && !!config.delivery.ghlAudioField,
    canSend: true,
    needsPublicAudio: true,
    async send({ audioUrl, contact }) {
      if (contact.source !== 'ghl') throw new Error('GHL handoff only works for contacts synced from GHL');
      await ghl.setCustomField(contact.external_id, config.delivery.ghlAudioField, audioUrl);
      await ghl.addTags(contact.external_id, ['voicedrop-ready']);
      return { providerMessageId: `ghl_${contact.external_id}_${Date.now()}`, status: 'handed_off' };
    },
  },
};

export function registerDeliveryProvider(name, impl) { providers[name] = impl; }

export function activeDelivery() {
  const name = config.delivery.provider in providers ? config.delivery.provider : 'manual';
  const p = providers[name];
  return { name, ...p, ready: p.configured() && (!p.needsPublicAudio || !!config.publicBaseUrl) };
}

export function deliveryCatalog() {
  return Object.entries(providers).filter(([n]) => n !== 'test').map(([name, p]) => ({
    name, label: p.label, description: p.description, configured: p.configured(), canSend: p.canSend,
    needsPublicAudio: p.needsPublicAudio, active: activeDelivery().name === name,
  }));
}

export function getDeliveryProvider(name) { return providers[name]; }
