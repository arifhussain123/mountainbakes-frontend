'use client';

import { useEffect, useState, useRef } from 'react';
import { doc, setDoc, onSnapshot, query, collection, where, serverTimestamp } from 'firebase/firestore';
import { db } from '@/utils/firebase';
import { useAuth } from './useAuth';
import type { UserPresence, PresenceStatus } from '@mb/shared';
import { logger } from '@/utils/logger';

function toPresence(id: string, data: Record<string, unknown>): UserPresence {
  const toISO = (v: unknown) => {
    if (!v) return new Date().toISOString();
    if (typeof v === 'object' && 'toDate' in (v as object)) return (v as { toDate: () => Date }).toDate().toISOString();
    return String(v);
  };
  return {
    uid: id,
    displayName: (data.displayName as string) ?? '',
    status: (data.status as PresenceStatus) ?? 'offline',
    lastSeen: toISO(data.lastSeen),
    updatedAt: toISO(data.updatedAt),
  };
}

async function writePresence(uid: string, displayName: string, status: PresenceStatus) {
  // NOTE: presence lives in Firestore, whose security rules require a Firebase Auth
  // session. Since auth moved to Supabase, these writes only succeed once realtime
  // is migrated to Supabase (Phase 3). Kept wired so the feature returns
  // automatically once that lands; failures are swallowed below.
  if (!uid) return;
  try {
    await setDoc(doc(db, 'userPresence', uid), {
      uid,
      displayName,
      status,
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    logger.error('writePresence error', err);
  }
}

// Own presence management — call once at app root
export function useOwnPresence() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    writePresence(user.uid, user.displayName, 'online');

    function handleVisibility() {
      if (!user) return;
      writePresence(user.uid, user.displayName, document.hidden ? 'away' : 'online');
    }

    function handleUnload() {
      // Best-effort sync write on unload
      if (!user) return;
      const payload = JSON.stringify({ uid: user.uid, displayName: user.displayName, status: 'offline' });
      navigator.sendBeacon?.('/api/presence-offline', payload);
      // Also try direct write (may not complete)
      writePresence(user.uid, user.displayName, 'offline');
    }

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      writePresence(user.uid, user.displayName, 'offline');
    };
  }, [user]);
}

// Read presence for a set of UIDs
export function usePresence(uids: string[]): Record<string, UserPresence> {
  const [presence, setPresence] = useState<Record<string, UserPresence>>({});
  const prevUidsRef = useRef<string>('');

  useEffect(() => {
    const key = [...uids].sort().join(',');
    // Reset the guard when there are no uids (e.g. the chat panel closed) so that
    // reopening with the same members re-subscribes instead of short-circuiting.
    if (!uids.length) { prevUidsRef.current = ''; return; }
    if (key === prevUidsRef.current) return;
    prevUidsRef.current = key;

    // Firestore `in` queries support up to 30 values; split if needed
    const batches: string[][] = [];
    for (let i = 0; i < uids.length; i += 30) {
      batches.push(uids.slice(i, i + 30));
    }

    const unsubs = batches.map((batch) => {
      const q = query(collection(db, 'userPresence'), where('uid', 'in', batch));
      return onSnapshot(q, (snap) => {
        setPresence((prev) => {
          const next = { ...prev };
          snap.docs.forEach((d) => {
            next[d.id] = toPresence(d.id, d.data() as Record<string, unknown>);
          });
          return next;
        });
      }, (err) => {
        logger.error('usePresence snapshot error', err);
      });
    });

    return () => unsubs.forEach((u) => u());
  }, [uids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return presence;
}
