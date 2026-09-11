import { cn } from '@/lib/utils';

/**
 * The profile picture for a staff account.
 *
 * THERE IS NO UPLOADED AVATAR IN THIS APP, and this component is where that fact
 * is handled rather than worked around at four call sites. `users` has no
 * `avatar_url`, there is no avatars bucket and there is no upload screen; what a
 * person recognises in these lists is the name and the staff code, and initials
 * on a stable colour give the same at-a-glance scanning without inventing a
 * whole feature inside a security change.
 *
 * WHEN A REAL AVATAR ARRIVES, it goes here and nowhere else: give this component
 * an optional `src`, render `Avatar`/`AvatarImage` from `@/components/ui/avatar`
 * with this block as the `AvatarFallback`, and every screen picks it up. That is
 * the whole reason the initials are a component and not two lines of JSX inline.
 *
 * THE COLOUR IS DERIVED, NEVER RANDOM. It is a hash of the identity, so the same
 * person is the same colour on every screen and across reloads — which is what
 * makes it scannable at all. A random or index-based colour would reshuffle on
 * every render and be actively worse than one flat grey.
 */

/**
 * The palette.
 *
 * Every entry is a background/foreground pair that clears contrast in BOTH
 * themes, which is why each one names an explicit dark variant instead of
 * leaning on opacity. Ten is enough that two people in a list rarely collide and
 * few enough that each stays distinguishable — a wider palette produces
 * near-identical neighbours and loses the distinction it was widened for.
 *
 * Red is deliberately absent. It is the revoked/suspicious colour on these
 * screens, and a person whose initials happened to hash red would read as a
 * warning.
 */
const PALETTE = [
  'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300',
  'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
];

/**
 * djb2 over the identity string.
 *
 * Any stable hash would do; this one is four lines and has no dependencies. The
 * `>>> 0` is load-bearing — without it the accumulator goes negative on longer
 * strings and `% PALETTE.length` returns a negative index, which is `undefined`
 * and renders an unstyled badge.
 */
function paletteIndex(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
  return hash % PALETTE.length;
}

/**
 * 'Arif Hussain' → 'AH'. 'arif@example.com' → 'AR'.
 *
 * Two letters from two words where there are two, and the first two characters
 * otherwise — including for an email address, where the local part is the only
 * thing resembling a name. Falls back to '?' rather than an empty badge, so a
 * row for a deleted account still lines up with the rows around it.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const single = words[0] ?? '';
  // Everything before the '@' — 'arif.hussain@…' should not initialise as 'AR@'.
  const local = single.split('@')[0] ?? '';
  return (local.slice(0, 2) || '?').toUpperCase();
}

export function StaffAvatar({
  name,
  /**
   * What the colour is derived from. Pass the staff code where there is one: it
   * is stable for the life of the account, where a display name changes when
   * somebody's name is corrected and would silently repaint them a new colour.
   */
  seed,
  size = 'default',
  className,
}: {
  name: string;
  seed?: string | null;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  const label = name?.trim() || 'Unknown';
  const colour = PALETTE[paletteIndex(seed || label)]!;

  const sizing =
    size === 'sm' ? 'size-7 text-[11px]' : size === 'lg' ? 'size-12 text-base' : 'size-9 text-xs';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
        sizing,
        colour,
        className,
      )}
      // The initials are decoration over a name that is already in the row, so
      // the badge is hidden from assistive technology rather than read out as a
      // second, cryptic version of it.
      aria-hidden="true"
      title={label}
    >
      {initials(label)}
    </span>
  );
}
