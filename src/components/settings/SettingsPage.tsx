'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { apiCall } from '@/utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Image from 'next/image';
import { useTheme, ACCENTS } from '@/providers/ThemeProvider';
import type { AppSettings } from '@mb/shared';
import { toast } from 'sonner';

export function SettingsPage() {
  const { token } = useAuth();
  const { settings: globalSettings, refreshSettings } = useSettings();
  const { theme, setTheme, accent, setAccent } = useTheme();
  const [settings, setSettings] = useState<Partial<AppSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  useEffect(() => {
    if (globalSettings) {
      setSettings(globalSettings);
      setLoading(false);
    }
  }, [globalSettings]);

  async function handleSave() {
    setSaving(true);
    let logoErr = false;
    try {
      if (logoFile) {
        try {
          const fd = new FormData();
          fd.append('logo', logoFile);
          const r = await apiCall<{ logoUrl: string }>('/api/settings/logo', { method: 'POST', body: fd }, token);
          setSettings((prev) => ({ ...prev, logoUrl: r.logoUrl }));
          setLogoFile(null);
        } catch (err) {
          logoErr = true;
          toast.error(err instanceof Error ? `Logo upload failed: ${err.message}` : 'Logo upload failed');
        }
      }

      const { logoUrl: _lu, logoPath: _lp, updatedAt: _ua, updatedBy: _ub, ...updatable } = settings as AppSettings;
      await apiCall('/api/settings', { method: 'PUT', body: JSON.stringify(updatable) }, token);
      await refreshSettings();
      toast.success(logoErr ? 'Settings saved (logo upload failed)' : 'Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="h-48 flex items-center justify-center text-muted-foreground">Loading settings…</div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Company */}
      <Card>
        <CardHeader><CardTitle className="text-base">Company</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Company Name</Label>
            <Input
              value={settings.companyName || ''}
              onChange={(e) => setSettings((p) => ({ ...p, companyName: e.target.value }))}
              placeholder="Mountain Bakes"
            />
          </div>

          <div className="space-y-1">
            <Label>Logo</Label>
            {settings.logoUrl && (
              <Image src={settings.logoUrl!} alt="Logo" className="h-12 w-auto rounded mb-2" width={120} height={48} unoptimized />
            )}
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="space-y-1">
            <Label>Receipt Footer</Label>
            <Input
              value={settings.receiptFooter || ''}
              onChange={(e) => setSettings((p) => ({ ...p, receiptFooter: e.target.value }))}
              placeholder="Thank you for choosing Mountain Bakes!"
            />
          </div>
        </CardContent>
      </Card>

      {/* Finance */}
      <Card>
        <CardHeader><CardTitle className="text-base">Finance & Tax</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Currency</Label>
              <Input
                value={settings.currency ?? ''}
                onChange={(e) => setSettings((p) => ({ ...p, currency: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Symbol</Label>
              <Input
                value={settings.currencySymbol ?? ''}
                onChange={(e) => setSettings((p) => ({ ...p, currencySymbol: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Enable GST</p>
              <p className="text-xs text-muted-foreground">Apply GST to all orders</p>
            </div>
            <Switch
              checked={settings.gstEnabled || false}
              onCheckedChange={(v) => setSettings((p) => ({ ...p, gstEnabled: v }))}
            />
          </div>

          {settings.gstEnabled && (
            <div className="space-y-1">
              <Label>GST Rate (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={settings.gstRate ?? 0}
                // parseFloat('') is NaN, and JSON.stringify turns NaN into null —
                // which the server's z.number() rejects with a 400. Clearing the
                // field must fall back to 0, not poison the payload.
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setSettings((p) => ({ ...p, gstRate: Number.isFinite(n) ? n : 0 }));
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Business Hours */}
      <Card>
        <CardHeader><CardTitle className="text-base">Business Hours</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            The bakery day runs 8:00 AM → 2:00 AM (next day). Production orders can be submitted only
            inside the order window, and the business day is archived automatically at 2:00 AM. Times are
            24-hour, Asia/Karachi.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Business Start Time</Label>
              <Input
                type="time"
                value={settings.businessStartTime ?? ''}
                onChange={(e) => setSettings((p) => ({ ...p, businessStartTime: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Business Closing Time</Label>
              <Input
                type="time"
                value={settings.businessClosingTime ?? ''}
                onChange={(e) => setSettings((p) => ({ ...p, businessClosingTime: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Order Start Time</Label>
              <Input
                type="time"
                value={settings.orderStartTime ?? ''}
                onChange={(e) => setSettings((p) => ({ ...p, orderStartTime: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Order End Time</Label>
              <Input
                type="time"
                value={settings.orderEndTime ?? ''}
                onChange={(e) => setSettings((p) => ({ ...p, orderEndTime: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Auto Close Business Day</p>
              <p className="text-xs text-muted-foreground">Archive sales, expenses &amp; production at 2:00 AM.</p>
            </div>
            <Switch
              checked={settings.autoCloseBusiness ?? true}
              onCheckedChange={(v) => setSettings((p) => ({ ...p, autoCloseBusiness: v }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Auto Stock Closing</p>
              <p className="text-xs text-muted-foreground">Snapshot each branch&apos;s balance stock and carry it forward.</p>
            </div>
            <Switch
              checked={settings.autoStockClosing ?? true}
              onCheckedChange={(v) => setSettings((p) => ({ ...p, autoStockClosing: v }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Closing Summary Notifications</p>
              <p className="text-xs text-muted-foreground">
                WhatsApp/SMS each branch, Production &amp; Admin their summary after the 2:00 AM close.
                Manage numbers under Recipients.
              </p>
            </div>
            <Switch
              checked={settings.closingNotificationsEnabled ?? false}
              onCheckedChange={(v) => setSettings((p) => ({ ...p, closingNotificationsEnabled: v }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Order Confirmation SMS</p>
              <p className="text-xs text-muted-foreground">
                Text the customer their order number and total when an order is placed.
                Sends only when a phone number is on the order.
              </p>
            </div>
            <Switch
              checked={settings.orderConfirmationsEnabled ?? false}
              onCheckedChange={(v) => setSettings((p) => ({ ...p, orderConfirmationsEnabled: v }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader><CardTitle className="text-base">Appearance</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Dark Mode</p>
              <p className="text-xs text-muted-foreground">Switch between light and dark theme</p>
            </div>
            <Switch
              checked={theme === 'dark'}
              onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')}
            />
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <p className="font-medium text-sm">Accent Color</p>
              <p className="text-xs text-muted-foreground">Recolor buttons, highlights and charts</p>
            </div>
            <div className="flex items-center gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  title={a.label}
                  aria-label={a.label}
                  aria-pressed={accent === a.value}
                  onClick={() => setAccent(a.value)}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    accent === a.value ? 'border-foreground' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: a.swatch }}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} size="lg" className="w-full">
        {saving ? 'Saving…' : 'Save Settings'}
      </Button>
    </div>
  );
}
