/**
 * Generate PWA icons + Apple splash screens from the master logo.
 *
 *   node scripts/generate-pwa-assets.mjs
 *
 * Source : public/assets/images/logo/logo.png  (1024x1024)
 * Output : public/icons/*      (app icons, favicons, shortcut icons)
 *          public/splash/*     (iOS startup images)
 *          src/utils/pwa-splash.ts  (startupImage <link> metadata)
 *
 * Requires `sharp`, which is NOT currently a dependency — install it first:
 *   pnpm add -D sharp
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Resolve `sharp` from wherever pnpm hoisted it.
function resolveSharp() {
  const req = createRequire(import.meta.url);
  const candidates = [
    join(root, 'node_modules'),
  ];
  const pnpm = join(root, 'node_modules', '.pnpm');
  if (existsSync(pnpm)) {
    for (const d of readdirSync(pnpm)) {
      if (d.startsWith('sharp@')) candidates.push(join(pnpm, d, 'node_modules'));
    }
  }
  for (const base of candidates) {
    try {
      return req(req.resolve('sharp', { paths: [base] }));
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not resolve `sharp`. Run `pnpm install` first.');
}
const sharp = resolveSharp();
void pathToFileURL;
const web = root;

const SRC_LOGO = join(web, 'public', 'assets', 'images', 'logo', 'logo.png');
const ICONS_DIR = join(web, 'public', 'icons');
const SPLASH_DIR = join(web, 'public', 'splash');

// The master logo is a red badge on an opaque WHITE square, so every filled
// surface (splash, maskable, apple icon) uses white to blend seamlessly. This
// also matches the manifest background_color (#ffffff).
const WHITE = '#FFFFFF';

mkdirSync(ICONS_DIR, { recursive: true });
mkdirSync(SPLASH_DIR, { recursive: true });

const bg = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b, alpha: 1 };
};

/** A transparent, resized copy of the logo at the given edge length. */
async function logoBuffer(size) {
  return sharp(SRC_LOGO)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/**
 * Full-bleed square icon flattened onto white (used for maskable / apple).
 * The badge already sits within the source's ~80% safe zone, so a straight
 * resize keeps it clear of any adaptive-icon mask crop.
 */
async function flatIcon(out, canvas) {
  await sharp(SRC_LOGO)
    .resize(canvas, canvas, { fit: 'cover' })
    .flatten({ background: bg(WHITE) })
    .png()
    .toFile(join(ICONS_DIR, out));
  console.log('icon  ', out);
}

/** Square icon that simply resizes the transparent logo (Android "any" purpose). */
async function transparentIcon(out, size) {
  await sharp(SRC_LOGO)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(ICONS_DIR, out));
  console.log('icon  ', out);
}

// ── App icons ────────────────────────────────────────────────────────────
await transparentIcon('icon-192.png', 192);
await transparentIcon('icon-512.png', 512);
await transparentIcon('icon-96.png', 96);        // shortcuts
// Maskable icons — full-bleed white so adaptive masks never clip content.
await flatIcon('maskable-192.png', 192);
await flatIcon('maskable-512.png', 512);
// Apple touch icon — no transparency (iOS renders alpha as black).
await flatIcon('apple-touch-icon.png', 180);
// Favicons
await transparentIcon('favicon-16.png', 16);
await transparentIcon('favicon-32.png', 32);
await transparentIcon('favicon-48.png', 48);

// ── Apple splash screens ─────────────────────────────────────────────────
// [logical width, logical height, devicePixelRatio, label]
const DEVICES = [
  [375, 667, 2, 'iphone-se'],
  [414, 736, 3, 'iphone-8plus'],
  [375, 812, 3, 'iphone-x'],
  [414, 896, 2, 'iphone-xr'],
  [414, 896, 3, 'iphone-xsmax'],
  [390, 844, 3, 'iphone-12'],
  [393, 852, 3, 'iphone-14pro'],
  [428, 926, 3, 'iphone-14plus'],
  [430, 932, 3, 'iphone-15promax'],
  [768, 1024, 2, 'ipad-97'],
  [810, 1080, 2, 'ipad-102'],
  [834, 1194, 2, 'ipadpro-11'],
  [1024, 1366, 2, 'ipadpro-129'],
];

async function splash(pxW, pxH, file) {
  // Logo occupies ~38% of the shorter edge, centred on white.
  const logoSize = Math.round(Math.min(pxW, pxH) * 0.38);
  const logo = await logoBuffer(logoSize);
  await sharp({
    create: { width: pxW, height: pxH, channels: 4, background: bg(WHITE) },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(join(SPLASH_DIR, file));
}

const startupImages = [];
for (const [w, h, dpr, label] of DEVICES) {
  for (const orientation of ['portrait', 'landscape']) {
    const isPortrait = orientation === 'portrait';
    const pxW = (isPortrait ? w : h) * dpr;
    const pxH = (isPortrait ? h : w) * dpr;
    const file = `apple-splash-${label}-${orientation}.png`;
    await splash(pxW, pxH, file);
    startupImages.push({
      url: `/splash/${file}`,
      media:
        `(device-width: ${w}px) and (device-height: ${h}px) ` +
        `and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation})`,
    });
    console.log('splash', file);
  }
}

// ── Emit startupImage metadata for the Next.js layout ────────────────────
const tsHeader = `// AUTO-GENERATED by scripts/generate-pwa-assets.mjs — do not edit by hand.
// Apple touch startup images (splash screens) keyed by device media query.
export const appleStartupImages = `;
writeFileSync(
  join(web, 'src', 'utils', 'pwa-splash.ts'),
  tsHeader + JSON.stringify(startupImages, null, 2) + ';\n',
  'utf-8',
);

console.log(`\nDone: ${DEVICES.length * 2} splash images, icons written.`);
