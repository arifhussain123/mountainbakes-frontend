'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
export type Accent = 'orange' | 'blue' | 'green' | 'purple' | 'rose';

const STORAGE_KEY = 'theme';
const ACCENT_KEY = 'accent';

/**
 * Selectable brand-accent colors. `value` is written to the <html data-accent>
 * attribute and matched by the `[data-accent="…"]` blocks in globals.css; `swatch`
 * is the oklch shown in the picker and MUST equal that block's --primary so the dot
 * matches the applied color. "orange" is the base :root palette, so it has no CSS
 * override block — selecting it simply removes any other accent's overrides.
 */
export const ACCENTS: { value: Accent; label: string; swatch: string }[] = [
  { value: 'orange', label: 'Orange', swatch: 'oklch(0.702 0.187 41.5)' },
  { value: 'blue', label: 'Blue', swatch: 'oklch(0.62 0.16 250)' },
  { value: 'green', label: 'Green', swatch: 'oklch(0.66 0.16 150)' },
  { value: 'purple', label: 'Purple', swatch: 'oklch(0.58 0.19 300)' },
  { value: 'rose', label: 'Rose', swatch: 'oklch(0.64 0.21 15)' },
];

const ACCENT_VALUES = ACCENTS.map((a) => a.value);

const ThemeContext = createContext<
  {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    accent: Accent;
    setAccent: (accent: Accent) => void;
    mounted: boolean;
  } | undefined
>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialize with SSR-safe defaults so the server HTML and the first client
  // render agree (avoids hydration mismatch). The real persisted values are read
  // from localStorage after mount; the inline script below applies them to <html>
  // before paint, so there is no visual flash of the wrong theme.
  const [theme, setTheme] = useState<Theme>('light');
  const [accent, setAccent] = useState<Accent>('orange');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const storedTheme: Theme = localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    const savedAccent = localStorage.getItem(ACCENT_KEY) as Accent | null;
    setTheme(storedTheme);
    setAccent(savedAccent && ACCENT_VALUES.includes(savedAccent) ? savedAccent : 'orange');
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, mounted]);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute('data-accent', accent);
    localStorage.setItem(ACCENT_KEY, accent);
  }, [accent, mounted]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, accent, setAccent, mounted }}>
      <script
        type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="dark")document.documentElement.classList.add("dark");document.documentElement.style.colorScheme=t==="dark"?"dark":"light";var a=localStorage.getItem("${ACCENT_KEY}");document.documentElement.setAttribute("data-accent",a||"orange")}catch(e){}})()`,
        }}
      />
      {children}
    </ThemeContext.Provider>
  );
}
