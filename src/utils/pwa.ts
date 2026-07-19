// Shared PWA helpers for install detection and prompt-dismissal state.

/** The `beforeinstallprompt` event isn't in the DOM lib types yet. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = 'mb-pwa-install-dismissed-until';
export const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** True when the app is running as an installed PWA (standalone window). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    // iOS Safari exposes this non-standard flag when launched from the home screen.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** True for iOS / iPadOS, which don't support `beforeinstallprompt`. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ masquerades as macOS but reports touch points.
  const iPadOS = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return (iOSDevice || iPadOS) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

/** Whether the install banner is currently within its 7-day snooze window. */
export function isInstallDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return Date.now() < until;
}

/** Snooze the install banner for 7 days. */
export function snoozeInstallPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + INSTALL_DISMISS_MS));
  } catch {
    /* storage unavailable (private mode) — banner simply reappears next visit */
  }
}

/** Clear the snooze (e.g. once the app has been installed). */
export function clearInstallDismissal(): void {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}
