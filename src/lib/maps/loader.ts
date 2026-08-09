/**
 * Google Maps JavaScript API loader.
 *
 * Hand-rolled rather than pulling in @googlemaps/js-api-loader: the whole job is
 * "append one script tag once and resolve when it fires", and this app is a static
 * export where every dependency ships to the browser.
 *
 * THE KEY IS PUBLIC. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is inlined into the bundle
 * at BUILD time — like every NEXT_PUBLIC_* value here — so anyone can read it out
 * of the JavaScript. That is normal for Maps and not a leak to be fixed by hiding
 * it: what protects the key is an HTTP-referrer restriction in the Google Cloud
 * console, limited to this app's domains, plus an API restriction to just Maps
 * JavaScript and Places. Without those a public key is a billable one.
 *
 * Being build-time also means changing the key on a running host does nothing. It
 * has to be set before `pnpm build` and the app rebuilt — the same trap DEPLOY.md
 * documents for NEXT_PUBLIC_API_URL.
 */

const MAPS_SCRIPT_ID = 'google-maps-js';

/** Libraries the picker needs: `places` for search, `marker` for the advanced pin. */
const LIBRARIES = ['places', 'marker'] as const;

export class MapsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapsUnavailableError';
  }
}

export function googleMapsApiKey(): string {
  return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
}

/** Whether a key was compiled in. Drives the fallback UI rather than an exception. */
export function isMapsConfigured(): boolean {
  return googleMapsApiKey().length > 0;
}

/**
 * Shared across every caller so a page with two maps loads the script once.
 * Retained on success only — a rejected attempt is cleared so a later retry (a
 * transient network failure, say) is not permanently poisoned by the first.
 */
let loadPromise: Promise<typeof google.maps> | null = null;

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === 'undefined') {
    return Promise.reject(new MapsUnavailableError('Google Maps can only load in a browser.'));
  }
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loadPromise) return loadPromise;

  const key = googleMapsApiKey();
  if (!key) {
    // Deliberately not cached: setting the key and rebuilding should fix it without
    // anything here remembering the failure.
    return Promise.reject(
      new MapsUnavailableError(
        'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set, so the map cannot load. It is ' +
          'inlined at build time — set it and rebuild. Coordinates can still be ' +
          'entered by hand in the meantime.',
      ),
    );
  }

  loadPromise = new Promise<typeof google.maps>((resolve, reject) => {
    const existing = document.getElementById(MAPS_SCRIPT_ID) as HTMLScriptElement | null;

    const onReady = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new MapsUnavailableError('Google Maps loaded but exposed no API.'));
    };

    if (existing) {
      existing.addEventListener('load', onReady);
      existing.addEventListener('error', () => reject(new MapsUnavailableError('Failed to load Google Maps.')));
      return;
    }

    const script = document.createElement('script');
    script.id = MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    // `loading=async` is what Google asks for to avoid the deprecation warning and
    // to let the library bootstrap without blocking parse.
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&libraries=${LIBRARIES.join(',')}&loading=async&v=weekly`;
    script.addEventListener('load', onReady);
    script.addEventListener('error', () =>
      reject(
        new MapsUnavailableError(
          'Failed to load Google Maps. Check that the API key is valid, that billing ' +
            'is enabled, and that this domain is on the key’s HTTP referrer allowlist.',
        ),
      ),
    );
    document.head.appendChild(script);
  }).catch((err) => {
    loadPromise = null;
    throw err;
  });

  return loadPromise;
}
