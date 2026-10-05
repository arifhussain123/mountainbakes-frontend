'use client';

import { useEffect, useState } from 'react';

/**
 * What a crashed screen shows instead of the framework's "This page couldn't
 * load".
 *
 * That default says nothing about WHAT failed, which makes a crash that only
 * happens on one person's device impossible to diagnose from a description of
 * it. This shows the same plain message and a Reload button, plus the error
 * itself behind "Show details" — the text someone can read out or screenshot.
 *
 * Deliberately dependency-free (no UI kit, no providers, inline styles): it is
 * rendered when something in the tree has already thrown, possibly the theme or
 * a provider, so it must not rely on any of them.
 */
export function ErrorDetails({ error, onRetry }: { error: Error & { digest?: string }; onRetry?: () => void }) {
  const [open, setOpen] = useState(false);
  // Captured once, when the boundary first renders: the page and the moment.
  const [where] = useState(() =>
    typeof window === 'undefined' ? '' : `${window.location.pathname} · ${new Date().toLocaleString()}`,
  );

  useEffect(() => {
    console.error(error);
  }, [error]);

  const details = [
    `${error.name || 'Error'}: ${error.message || '(no message)'}`,
    error.digest ? `digest: ${error.digest}` : '',
    where,
    (error.stack || '').split('\n').slice(0, 8).join('\n'),
  ].filter(Boolean).join('\n');

  const button: React.CSSProperties = {
    padding: '10px 16px', borderRadius: 8, border: '1px solid #c9b8a6', background: '#fff',
    font: 'inherit', fontWeight: 600, cursor: 'pointer',
  };

  return (
    <div style={{ maxWidth: 640, margin: '48px auto', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#2b1a10' }}>
      <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>This page couldn&rsquo;t load</h1>
      <p style={{ margin: '0 0 16px', color: '#6b5a4c' }}>
        Reload to try again. If it keeps happening, open the details below and send a screenshot of them.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={{ ...button, background: '#f26b2a', borderColor: '#f26b2a', color: '#fff' }} onClick={() => window.location.reload()}>
          Reload
        </button>
        {onRetry && (
          <button type="button" style={button} onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" style={button} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide details' : 'Show details'}
        </button>
      </div>
      {open && (
        <pre
          style={{
            marginTop: 16, padding: 12, borderRadius: 8, background: '#f6efe6', border: '1px solid #e3d5c3',
            fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto',
          }}
        >
          {details}
        </pre>
      )}
    </div>
  );
}
