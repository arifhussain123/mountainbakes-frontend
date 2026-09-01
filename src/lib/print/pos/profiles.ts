/**
 * What differs between one thermal printer and the next.
 *
 * Almost nothing does at this end of the market — they all speak the same Epson
 * command set, which is why `escpos.ts` carries no model-specific bytes. What a
 * receipt genuinely has to know is **how many characters fit across the roll**,
 * because that is what every column of every total is padded against. Get it
 * wrong by four and the amounts wrap onto their own lines.
 *
 * So this file is about paper, not models. A profile is chosen by roll width in
 * Printer Settings, and the printer itself is chosen separately from whatever the
 * local print agent reports the machine has installed. Nothing here names a
 * printer: hardcoding "BlackCopper 80mm Series" as the one true device is exactly
 * the assumption that breaks the first time a shop replaces a unit.
 */

export type PaperWidth = '58mm' | '80mm';

export interface PrinterProfile {
  /** Stable key. Stored with the device's printer choice, so renaming one is a migration. */
  id: PaperWidth;
  /** What Printer Settings calls it. */
  label: string;
  /** Roll width, for the screen to show and for the agent's logs to make sense. */
  paperWidthMm: number;
  /**
   * How much of that width the head actually prints on.
   *
   * A roll is wider than its print area — 80mm of paper, 72mm of dots — and the
   * gap is the margin the mechanism needs on each side. Nothing that composes
   * ESC/POS cares (the printer applies its own margin), but a transport that has
   * to lay out a *page* for a driver does: a page box set to the roll width puts
   * the text 4mm off centre, and one set to the print area lands it correctly.
   * That is the whole reason this figure is here rather than derived.
   */
  printableWidthMm: number;
  /**
   * Characters across one line in the printer's default font (Font A).
   *
   * 48 is the standard figure for an 80mm roll: a 72mm print area at 12 dots per
   * character on a 576-dot head. 32 is the 58mm equivalent. Font B would give 64
   * and 42, but nothing here selects it — a receipt read at arm's length across a
   * counter wants the larger face.
   *
   * A printer that disagrees is why the test page prints a ruler: 48 characters
   * ending exactly at the edge of the roll prove the count, and 48 that wrap prove
   * it wrong. Printer Settings lets the number be overridden for that case rather
   * than requiring a code change.
   */
  charactersPerLine: number;
}

export const PROFILE_80MM: PrinterProfile = {
  id: '80mm',
  label: '80mm roll',
  paperWidthMm: 80,
  printableWidthMm: 72,
  charactersPerLine: 48,
};

export const PROFILE_58MM: PrinterProfile = {
  id: '58mm',
  label: '58mm roll',
  paperWidthMm: 58,
  printableWidthMm: 48,
  charactersPerLine: 32,
};

export const PRINTER_PROFILES: readonly PrinterProfile[] = [PROFILE_80MM, PROFILE_58MM];

/** 80mm is the shop's paper, and the safe default: too-wide is a ragged column, too-narrow is a lost amount. */
export const DEFAULT_PROFILE: PrinterProfile = PROFILE_80MM;

export function profileFor(width: PaperWidth | undefined): PrinterProfile {
  return PRINTER_PROFILES.find((p) => p.id === width) ?? DEFAULT_PROFILE;
}

/**
 * The profile a stored config resolves to, honouring a hand-set column override.
 *
 * The override is not a second source of truth — it edits the one field a shop
 * can legitimately discover is wrong from the test page, and leaves the paper
 * width (which the app reports and the agent logs) saying what it always said.
 * Clamped, because a zero or a negative would divide the wrap maths by nothing
 * and a value in the thousands would build a receipt line no roll can hold.
 */
export function resolveProfile(width: PaperWidth | undefined, override?: number | null): PrinterProfile {
  const base = profileFor(width);
  if (!override || !Number.isFinite(override)) return base;
  const columns = Math.max(24, Math.min(96, Math.trunc(override)));
  return columns === base.charactersPerLine ? base : { ...base, charactersPerLine: columns };
}
