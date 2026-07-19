'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  clearInstallDismissal,
  isInstallDismissed,
  isIOS,
  isStandalone,
  snoozeInstallPrompt,
  type BeforeInstallPromptEvent,
} from '@/utils/pwa';

const SHOW_DELAY_MS = 4000; // "after 3–5 seconds"

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    // Never prompt an already-installed app, or one snoozed within 7 days.
    if (isStandalone() || isInstallDismissed()) return;

    const onIOS = isIOS();
    setIos(onIOS);

    let timer: ReturnType<typeof setTimeout>;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stash the native mini-infobar; we drive the UI
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    const onInstalled = () => {
      clearInstallDismissal();
      setVisible(false);
      setDeferred(null);
    };
    window.addEventListener('appinstalled', onInstalled);

    // Reveal the banner after a short delay. On iOS there is no
    // `beforeinstallprompt`, so we show the "Add to Home Screen" guidance.
    timer = setTimeout(() => {
      if (isStandalone() || isInstallDismissed()) return;
      setVisible(true);
    }, SHOW_DELAY_MS);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    snoozeInstallPrompt();
    setVisible(false);
  }, []);

  const install = useCallback(async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setDeferred(null);
      if (outcome === 'accepted') setVisible(false);
      else snoozeInstallPrompt(); // treat a declined native prompt as a snooze
      return;
    }
    if (ios) {
      setShowIosSteps((s) => !s); // no programmatic prompt on iOS — show steps
    }
  }, [deferred, ios]);

  // On iOS we can only guide; on other browsers only show once installable.
  if (!visible || (!deferred && !ios)) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Mountain Bakes ERP"
      className="fixed inset-x-0 bottom-0 z-[100] px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:px-0"
    >
      <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-2xl shadow-black/10 ring-1 ring-black/5 sm:w-96">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt="Mountain Bakes"
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-xl border border-border"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Install Mountain Bakes ERP</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Install Mountain Bakes ERP for faster access.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {ios && showIosSteps && (
          <div className="mt-3 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-1.5">
              Tap the <Share className="inline size-3.5 text-primary" /> <b>Share</b> button,
            </p>
            <p className="mt-1 flex items-center gap-1.5">
              then choose <SquarePlus className="inline size-3.5 text-primary" />{' '}
              <b>Add to Home Screen</b>.
            </p>
          </div>
        )}

        <div className="mt-3 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Not now
          </Button>
          <Button size="sm" onClick={install}>
            <Download className="size-3.5" />
            {ios ? 'How to install' : 'Install'}
          </Button>
        </div>
      </div>
    </div>
  );
}
