// Google Places API (New) — official, ToS-compliant business search.
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
// Enable "Places API (New)" in Google Cloud and put the key in GOOGLE_PLACES_API_KEY.
import { config } from '../../config.js';

const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
  'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.websiteUri',
  'places.rating', 'places.userRatingCount', 'places.regularOpeningHours', 'places.businessStatus',
  'places.primaryType', 'places.types', 'places.googleMapsUri', 'places.reviews', 'nextPageToken',
].join(',');

export const placesConfigured = () => !!config.leads.googleKey;

// One request = up to 20 places. Returns { places, nextPageToken }.
export async function textSearch({ query, pageToken }) {
  if (!placesConfigured()) throw Object.assign(new Error('Add GOOGLE_PLACES_API_KEY to .env to use Prospecting'), { status: 412 });
  const body = pageToken ? { textQuery: query, pageToken } : { textQuery: query, pageSize: 20, languageCode: 'en', regionCode: 'US' };
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.leads.googleKey, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error?.message || r.statusText;
    throw Object.assign(new Error(`Google Places error (${r.status}): ${msg}`), { status: r.status === 403 || r.status === 400 ? 502 : r.status });
  }
  return { places: j.places || [], nextPageToken: j.nextPageToken || null };
}

const comp = (p, type, short = false) => {
  const c = (p.addressComponents || []).find((x) => (x.types || []).includes(type));
  return c ? (short ? c.shortText : c.longText) : '';
};

export function normalizePlace(p) {
  return {
    place_id: p.id,
    name: p.displayName?.text || '',
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
    website: p.websiteUri || '',
    address: p.formattedAddress || '',
    city: comp(p, 'locality') || comp(p, 'sublocality') || comp(p, 'postal_town'),
    state: comp(p, 'administrative_area_level_1', true),
    zip: comp(p, 'postal_code'),
    rating: p.rating ?? null,
    review_count: p.userRatingCount ?? 0,
    hours: p.regularOpeningHours?.periods || null,
    weekday_text: p.regularOpeningHours?.weekdayDescriptions || null,
    business_status: p.businessStatus || 'OPERATIONAL',
    primary_type: p.primaryType || '',
    types: p.types || [],
    maps_url: p.googleMapsUri || '',
    // Review text is used transiently for scoring only; it is not stored.
    reviews: (p.reviews || []).map((r) => ({ text: r.text?.text || r.originalText?.text || '', rating: r.rating, when: r.relativePublishTimeDescription })),
  };
}
