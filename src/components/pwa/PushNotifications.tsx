'use client';

import { useEffect, useRef } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/utils/firebase';
import { useAuth } from '@/hooks/useAuth';
import { isPushSupported, onForegroundMessage, requestFcmToken } from '@/lib/firebase/messaging';

const PROMPT_KEY = 'mb-push-prompt-dismissed-until';
const PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function platform(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/macintosh/i.test(ua)) return 'macos';
  if (/windows/i.test(ua)) return 'windows';
  return 'web';
}

/**
 * Registers the signed-in user's device for Firebase Cloud Messaging and
 * shows foreground pushes as toasts. Permission is only ever requested behind
 * an explicit user click (never on page load) to respect browser best practices.
 * Mounted inside the authenticated dashboard layout.
 */
export function PushNotifications() {
  const { user } = useAuth();
  const enabledRef = useRef(false);

  useEffect(() => {
    if (!user || !isPushSupported()) return;
    let unsubscribe: (() => void) | undefined;

    const saveToken = async () => {
      const token = await requestFcmToken();
      if (!token) return false;
      await setDoc(
        doc(db, 'fcmTokens', token),
        {
          token,
          uid: user.uid,
          role: user.role,
          branchId: user.branchId ?? null,
          platform: platform(),
          userAgent: navigator.userAgent,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      return true;
    };

    const enable = async () => {
      if (enabledRef.current) return;
      const ok = await saveToken();
      if (!ok) return;
      enabledRef.current = true;
      unsubscribe = await onForegroundMessage((payload) => {
        const d = payload.data || {};
        const title = d.title || payload.notification?.title || 'Mountain Bakes';
        toast(title, { description: d.body || payload.notification?.body });
      });
    };

    const askPermission = async () => {
      const result = await Notification.requestPermission();
      if (result === 'granted') await enable();
      else snoozePrompt();
    };

    const snoozePrompt = () => {
      try {
        localStorage.setItem(PROMPT_KEY, String(Date.now() + PROMPT_SNOOZE_MS));
      } catch {
        /* ignore */
      }
    };

    const promptSnoozed = () => {
      try {
        return Date.now() < Number(localStorage.getItem(PROMPT_KEY) || 0);
      } catch {
        return false;
      }
    };

    if (Notification.permission === 'granted') {
      // Already allowed — register/refresh the token silently.
      void enable();
    } else if (Notification.permission === 'default' && !promptSnoozed()) {
      // Offer to enable via a toast; the click is the required user gesture.
      const timer = setTimeout(() => {
        toast('Enable notifications', {
          description: 'Get alerts for new orders, production updates and more.',
          duration: 12000,
          action: { label: 'Turn on', onClick: () => void askPermission() },
          onDismiss: snoozePrompt,
        });
      }, 8000);
      return () => {
        clearTimeout(timer);
        unsubscribe?.();
      };
    }

    return () => unsubscribe?.();
  }, [user]);

  return null;
}
