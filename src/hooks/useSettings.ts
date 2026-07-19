'use client';

import { useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useAppStore } from '@/stores/useAppStore';
import { apiCall } from '@/utils/api';
import type { AppSettings } from '@mb/shared';

export function useSettings() {
  const { token } = useAuth();
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);

  const fetchSettings = useCallback(async () => {
    if (!token) return;
    const r = await apiCall<{ settings: AppSettings }>('/api/settings', {}, token);
    setSettings(r.settings);
  }, [token, setSettings]);

  useEffect(() => {
    if (token && !settings) {
      fetchSettings();
    }
  }, [token, settings, fetchSettings]);

  return { settings, refreshSettings: fetchSettings };
}
