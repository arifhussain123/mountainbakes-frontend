import type { LocationSource, LoginSession, LoginSessionState } from '@mb/shared';

/**
 * Everything the three Security screens agree on about how a session reads.
 *
 * Shared rather than repeated because the history table, the active roster and
 * the detail dialog all show the same session and must not describe it
 * differently — "Tab closed" in one place and "Expired" in another is one bug,
 * not two views, and it is the kind that survives review because each file looks
 * right on its own.
 */

/**
 * State → badge colour.
 *
 * `revoked` is the only destructive one and is the only one in red. `expired`
 * takes amber rather than red deliberately: a closed tab is not a problem, it is
 * the ordinary end of a session, and colouring it as a fault would train people
 * to ignore the colour that matters.
 */
export const STATE_STYLES: Record<LoginSessionState, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  // Amber like `expired`, because it is the same kind of fact one step earlier —
  // the tab has gone quiet. Not green, or the roster would overstate how many
  // people are actually at a screen; not red, because nothing is wrong.
  idle: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  ended: 'bg-muted text-muted-foreground',
  expired: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  revoked: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

/**
 * State → what a person calls it.
 *
 * Named for what actually happened rather than for the flag. Nobody was
 * "expired": they closed the tab without signing out. Nobody was "revoked"
 * either — an admin signed them out, and the label says so, because the person
 * reading this screen may well be the admin who did it.
 */
export const STATE_LABELS: Record<LoginSessionState, string> = {
  active: 'Active',
  // Named for the tab, not the person. The ping is on a timer and fires whether
  // or not anybody is typing, so what has gone quiet is the browser — 'Away'
  // would claim to know something about the human that this cannot.
  idle: 'Idle',
  ended: 'Signed out',
  expired: 'Tab closed',
  revoked: 'Signed out by admin',
};

/**
 * '3h 42m', '18m', '—'.
 *
 * Minutes are dropped once the figure passes a day, because "1d 4h 09m" is
 * precision nobody reads; under a minute is shown in seconds so a mis-click that
 * signed straight back out does not render as a bare '0m'.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const days = Math.floor(totalSeconds / 86400);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

/** 'Skardu, Pakistan' · 'Pakistan' · '—'. */
export function formatLocation(s: Pick<LoginSession, 'city' | 'country'>): string {
  const parts = [s.city, s.country].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

/**
 * 'Chrome 140 · Linux Desktop'.
 *
 * Built from the columns the API parsed, NOT from the raw user agent. The server
 * parses once at insert so every reader agrees and so the browser column can be
 * filtered in SQL; re-reading the raw string here would produce a second
 * opinion that drifts from the stored one the moment either parser changes.
 *
 * The device class is folded into the OS half ('Linux Desktop', 'Android
 * Mobile') because on its own it is too coarse to earn a column, and next to the
 * OS it is exactly the distinction between a phone and a laptop that the OS name
 * alone leaves ambiguous.
 */
export function formatDevice(s: Pick<LoginSession, 'browser' | 'browserVersion' | 'os' | 'deviceType'>): string {
  const browser = [s.browser, s.browserVersion].filter(Boolean).join(' ');
  const kind = s.deviceType && s.deviceType !== 'unknown'
    ? s.deviceType.charAt(0).toUpperCase() + s.deviceType.slice(1)
    : null;
  const os = [s.os, kind].filter(Boolean).join(' ');

  if (browser && os) return `${browser} · ${os}`;
  return browser || os || '—';
}

/** 'Chrome 140', for the narrow column where the OS gets its own cell. */
export function formatBrowser(s: Pick<LoginSession, 'browser' | 'browserVersion'>): string {
  return [s.browser, s.browserVersion].filter(Boolean).join(' ') || '—';
}

/** 'Linux Desktop'. */
export function formatPlatform(s: Pick<LoginSession, 'os' | 'osVersion' | 'deviceType'>): string {
  const kind = s.deviceType && s.deviceType !== 'unknown'
    ? s.deviceType.charAt(0).toUpperCase() + s.deviceType.slice(1)
    : null;
  return [s.os, kind].filter(Boolean).join(' ') || '—';
}

/**
 * Location source → what it actually means, in words a person can act on.
 *
 * SPELLED OUT RATHER THAN ABBREVIATED. 'IP' on its own reads as a technical
 * detail and gets skipped; "IP address (approximate)" is the qualification
 * itself, sitting in the value where it cannot be scrolled past. That distinction
 * is the whole reason `location_source` is stored — an admin about to sign
 * somebody out for being in the wrong country needs to know the country came
 * from a database lookup of a network, not from the device.
 *
 * 'DEVICE_GPS' has no writer today. It is labelled anyway so the day one exists,
 * the two are already distinguishable on screen rather than looking identical
 * until somebody remembers to add the label.
 */
export const LOCATION_SOURCE_LABELS: Record<LocationSource, string> = {
  IP: 'IP address (approximate)',
  DEVICE_GPS: 'Device location (precise)',
  UNKNOWN: 'Not resolved',
};
