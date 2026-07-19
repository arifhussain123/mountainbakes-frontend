'use client';

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

// Authentication has moved to Supabase (see @/lib/supabase/client). Firebase is
// retained only for Firestore realtime, Storage, and Cloud Messaging until those
// phases are migrated.
const firebaseConfig = {
  apiKey: "AIzaSyD3ZVvbqrYQJd7XPNWG6WJWvlYRcHX8960",
  authDomain: "mountain-bakes.firebaseapp.com",
  projectId: "mountain-bakes",
  storageBucket: "mountain-bakes.firebasestorage.app",
  messagingSenderId: "1080689856918",
  appId: "1:1080689856918:web:764653944d99f4f8298db7",
  measurementId: "G-GRKTKHRT54"
};

// Only initialize Firebase in the browser — SSR has no Firebase credentials
let app: FirebaseApp | undefined;
let _db: Firestore | undefined;
let _storage: FirebaseStorage | undefined;

if (typeof window !== 'undefined') {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  _db = getFirestore(app);
  _storage = getStorage(app);
}

export const db = _db as Firestore;
export const storage = _storage as FirebaseStorage;
