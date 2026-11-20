# Lobsang VoiceDrop

Personalized voice outreach for **Lobsang Solutions**. Pick contacts from GoHighLevel, generate a natural, industry-specific voicemail for each one, approve and voice the scripts, then deliver them through a compliant voicemail-drop provider or download them. The goal is to start conversations about the **AI Voice Agent** and **Missed Call Text Back**.

> *Every missed call could be a customer and revenue walking straight to your competitor.*

## Quick start

```bash
npm install
```

```bash
cp .env.example .env    # then fill in keys (see below)
```

```bash
npm start               # http://localhost:3000
```

```bash
npm test                # 9 end-to-end + unit tests with mock providers (no network)
```

Requires **Node.js 22.5 or newer**. Storage is the built-in `node:sqlite`, so there is no database server and no native build. Everything is stored in `data/`; back that folder up.

Docker: `docker build -t voicedrop .` then `docker run -p 3000:3000 --env-file .env -v voicedrop-data:/app/data voicedrop`.

## What works today

| Area | Status | Notes |
|---|---|---|
| Prospecting | ✅ (needs Google key) | Search Google Places (official API) by niche plus ZIP, city or address. Each business gets a 0–100 **Missed-Call Opportunity Score** from review complaints about phones, volume, hours, website booking/chat, rating, and your own test-call results. Comes with a live SDR call script (gatekeeper, opener, hook, pitch, ask, objections, voicemail). Add to Contacts or **Send to GHL** (upsert, assign to an SDR, script saved as a note). Review text is used for scoring only and never stored. |
| GHL contact sync | ✅ | Private Integration token. Contacts, tags, custom fields, DND per channel, pipeline stage. Read-only. |
| CSV import | ✅ | Flexible column names; extra columns become custom fields. `public/sample-contacts.csv` is a sample. |
| Contact dashboard | ✅ | Search; filter by tag, industry, pipeline stage, custom field, consent and source; pagination; select page, select all matching, deselect all. |
| Industry intelligence | ✅ | 12 industries with pain point, missed-call scenario, competitor risk, hedged impact, vocabulary and solution. Industry is detected from existing CRM data at no cost, and you can override it per contact. |
| Script generation | ✅ | Free template engine (default) builds the 6-part structure. Optional AI polish makes **one cached call per industry**; "business-specific" personalization adds one small call per contact. |
| Controls | ✅ | Tone, 15/20/30/45s, offer, CTA, personalization, callback line, follow-up SMS. |
| Script review | ✅ | Script beside each contact, word count and spoken-length estimate, lint for jargon, guarantees and $/% claims, editing, approve or unapprove. Editing resets approval. |
| TTS | ✅ (needs key) | OpenAI `gpt-4o-mini-tts` (default; speaking-style instructions) or ElevenLabs. Audio is generated only for approved scripts and cached by content hash, so unchanged scripts are never re-billed. |
| Cost estimator | ✅ | AI, TTS, delivery and SMS shown separately as estimates before sending and actuals afterwards; cost per delivery. |
| Manual download | ✅ | Per-file MP3 or a ZIP of every approved MP3 plus a CSV manifest. |
| Campaign launch | ✅ | Final review checklist, typed-name confirmation, schedule, pause/resume/stop, rate limiting, retry failed (max 3), send to one. |
| Delivery providers | ✅ (needs account) | `webhook` (Zapier/Make/n8n/any provider), `slybroadcast`, `ghl_workflow` handoff. Receipts arrive via webhook. |
| Follow-up SMS | ✅ (needs GHL) | Sent through the GHL Conversations API after a delivery. Requires SMS consent. Sent at most once per contact. |
| Workflow triggers | ✅ (opt-in) | Tags `voicedrop-delivered`, `-sms-sent`, `-replied`, `-demo-requested`, `-opted-out`. |
| Reply assistant | ✅ | Free keyword classifier first, cheap AI only when unsure. Lead score and industry-aware suggested reply; send through GHL only when you click Send. Opt-outs are suppressed automatically. |
| Compliance | ✅ | Consent, DND, opt-out tags, suppression list, 90-day duplicate guard, local calling hours by timezone/state (stricter state windows built in), global stop, legal acknowledgement gate, full audit log. |
| Analytics | ✅ | Dashboard KPIs, results by industry, cost by category, provider, campaign and day, audio-cache savings. |

### What GHL can't do through its public API, and the workaround

* **Ringless voicemail:** GHL has no public RVM endpoint. Use a dedicated provider (`VOICEDROP_PROVIDER=webhook` or `slybroadcast`), or `ghl_workflow`. That last option writes the audio URL into a contact custom field and adds the tag `voicedrop-ready`, so a GHL workflow you build can run the voicemail step through whatever approved app your account has. Its status shows **handed off**, never "delivered".
* **Smart Lists:** these aren't exposed by the API. In GHL, add a workflow or bulk action that tags the smart-list contacts, then sync or filter by that tag.
* **Inbound replies:** a Private Integration can't subscribe to app-level webhooks. Create a GHL workflow: **Customer Replied → Webhook** to `/webhooks/ghl/inbound?token=WEBHOOK_SECRET`, or click **Pull from GHL** on the Replies page.

## Configuration

All secrets stay in `.env` on the server. The browser only sees "configured: yes/no".

| Variable | Purpose |
|---|---|
| `APP_PASSWORD`, `SESSION_SECRET` | Login for the app. **Set these before deploying.** |
| `PUBLIC_BASE_URL` | Public HTTPS URL of the app. Delivery providers fetch MP3s from `/media/<sha256>.mp3`. |
| `WEBHOOK_SECRET` | Required token for `/webhooks/*`. |
| `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID` | GHL sub-account Private Integration. Scopes: contacts.readonly, contacts.write, locations.readonly, locations/customFields.readonly, locations/tags.readonly, opportunities.readonly, conversations.readonly, conversations/message.write. |
| `GOOGLE_PLACES_API_KEY` | Prospecting. Enable "Places API (New)" in Google Cloud and restrict the key to it. GHL token also needs `users.readonly` to list SDRs. |
| `OPENAI_API_KEY` | TTS (and optional text AI). |
| `ANTHROPIC_API_KEY` | Optional AI polish and reply classification (default model `claude-haiku-5-5`). |
| `ELEVENLABS_API_KEY`, `TTS_PROVIDER` | Alternative TTS vendor. |
| `VOICEDROP_PROVIDER` + provider vars | `manual` (default), `webhook`, `slybroadcast`, `ghl_workflow`. |
| `VOICEDROP_COST_PER_DROP`, `SMS_COST_PER_SEGMENT`, `PRICE_*` | Keep the estimates matched to your contracts. |

Sender name, company, callback number, demo and booking links, calling hours, consent rules and dedupe window are edited in **Settings**.

## Typical operating cost

At a 30-second message with templates and OpenAI `gpt-4o-mini-tts`:

* Script: **$0**. With AI polish, about $0.0005 per industry per campaign.
* Audio: about **$0.005** per message, and $0 when cached.
* Delivery: your provider's per-drop price (set `VOICEDROP_COST_PER_DROP`).
* Follow-up SMS: your GHL/LC Phone rate.

## Architecture

```
server/
  index.js                 Express app, auth, public media, webhooks
  config.js / db.js        env config, SQLite schema, settings, audit, cost ledger
  data/industries.js       Industry Intelligence Library (add industries here)
  providers/
    crm/ghl.js             GHL API v2 client (throttled, retries 429)
    ai/index.js            AI abstraction: anthropic | openai | template fallback
    tts/index.js           TTS abstraction: openai | elevenlabs
    delivery/index.js      Voicemail-drop abstraction: manual | webhook | slybroadcast | ghl_workflow
  services/
    scriptEngine.js        6-part template engine, lint, SMS templates
    generator.js           per-campaign generation with cached AI base scripts
    audio.js               content-addressed TTS cache + cost tracking
    compliance.js          consent/DND/suppression/dedupe/calling-window engine
    campaigns.js           estimator, review gate, launch, worker, SMS follow-up, receipts
    replies.js             classifier, suggestions, opt-out handling, GHL pull
public/                    vanilla-JS SPA (no build step)
test/                      node:test suites with mock providers
```

To add a provider, implement the small interface at the top of the matching `providers/*/index.js` file and register it. Nothing else changes.

## Compliance notice

Prerecorded and AI-generated voice messages, including ringless voicemail, are treated as calls under the TCPA. Marketing messages to mobile numbers generally require prior express **written** consent, and several states add stricter rules. The app enforces the policy you configure: it blocks mobile and unknown-line numbers without documented consent by default, honors DND, opt-outs and suppression, keeps to calling hours, and records an audit trail. It does not replace legal review. Launching is disabled until the legal-review acknowledgement in Settings is checked.
