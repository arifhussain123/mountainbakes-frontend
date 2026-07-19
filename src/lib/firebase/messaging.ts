'use client';

import { getApp } from 'firebase/app';
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported,
  type Messaging,
  type MessagePayload,
} from 'firebase/messaging';
import '@/utils/firebase'; // side-effect: initialise the Firebase app (browser only)

let cached: Messaging | null = null;

/** True when this browser can receive web push at all. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

async function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return null;
  if (cached) return cached;
  try {
    if (!(await isSupported())) return null;
    cached = getMessaging(getApp());
    return cached;
  } catch {
    return null;
  }
}

/**
 * Register the FCM background worker at its own scope so it never collides
 * with the offline/caching worker that controls the app at "/".
 */
async function registerFcmServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/firebase-cloud-messaging-push-scope',
    });
  } catch (err) {
    console.error('[fcm] worker registration failed', err);
    return null;
  }
}

/**
 * Get (or refresh) this device's FCM registration token. Requires that
 * notification permission has already been granted and that
 * NEXT_PUBLIC_FIREBASE_VAPID_KEY is configured.
 */
export async function requestFcmToken(): Promise<string | null> {
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.warn('[fcm] NEXT_PUBLIC_FIREBASE_VAPID_KEY is not set — push disabled');
    return null;
  }
  const messaging = await getMessagingInstance();
  if (!messaging) return null;
  const swReg = await registerFcmServiceWorker();
  if (!swReg) return null;
  try {
    return await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
  } catch (err) {
    console.error('[fcm] getToken failed', err);
    return null;
  }
}

/** Subscribe to messages received while the app is in the foreground. */
export async function onForegroundMessage(
  cb: (payload: MessagePayload) => void,
): Promise<() => void> {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};
  return onMessage(messaging, cb);
}
