// Static image exports — all app images flow through this file
// Place actual image files in src/assets/images/<category>/
// and uncomment the imports below as assets are added.

// Default/fallback images (public folder, always available)
export const PUBLIC_IMAGES = {
  logo:       '/assets/images/logo/logo.png',
  logoFull:   '/assets/images/logo/logo.png',
  logoWhite:  '/assets/images/logo/logo-white.png',
  favicon:    '/favicon.ico',
  placeholder: '/assets/images/empty/placeholder.svg',
  avatar:     '/assets/images/avatars/default.svg',
  loginBg:    '/assets/images/backgrounds/login-bg.jpg',
  banner:     '/assets/images/banners/hero-banner.jpg',
} as const;

// When you add real Next.js static imports, pattern:
//
// import Logo        from '@/assets/images/logo/logo.png';
// import LogoFull    from '@/assets/images/logo/logo-full.png';
// import LoginBg     from '@/assets/images/backgrounds/login-bg.jpg';
//
// export const IMAGES = { Logo, LogoFull, LoginBg } as const;

export const IMAGES = PUBLIC_IMAGES;

export type ImageKey = keyof typeof IMAGES;
