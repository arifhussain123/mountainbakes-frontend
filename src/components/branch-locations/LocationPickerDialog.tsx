'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_GEOFENCE_RADIUS_KM,
  formatDistanceKm,
  type BranchLocationRow,
} from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isMapsConfigured, loadGoogleMaps } from '@/lib/maps/loader';
import { AlertTriangle, Crosshair, MapPin, Save, Search } from 'lucide-react';
import { toast } from 'sonner';

/** The radii offered as presets. Any value is accepted via the schema; these are shortcuts. */
const RADIUS_PRESETS = [5, 10, 25, 50, 100];

/** Karachi. Where the map opens when a branch has no location and no address to geocode. */
const FALLBACK_CENTRE = { lat: 24.8607, lng: 67.0011 };

export interface LocationPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: BranchLocationRow | null;
  onSave: (input: {
    latitude: number;
    longitude: number;
    address: string;
    radiusKm: number;
    googlePlaceId: string | null;
  }) => Promise<unknown>;
  saving: boolean;
}

/**
 * Set a branch's authorised centre and radius on a map.
 *
 * The map is a progressive enhancement, not a requirement: without a Maps key the
 * dialog still edits latitude, longitude, address and radius as plain fields, and
 * saving works identically. That matters because the key is baked in at build time —
 * an admin on a build that predates the key must not be locked out of configuring a
 * location entirely.
 */
export function LocationPickerDialog({
  open,
  onOpenChange,
  row,
  onSave,
  saving,
}: LocationPickerDialogProps) {
  const existing = row?.location ?? null;

  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [address, setAddress] = useState('');
  const [radiusKm, setRadiusKm] = useState(String(DEFAULT_GEOFENCE_RADIUS_KM));
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const searchNodeRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const radiusNum = Number(radiusKm);
  const hasPoint = Number.isFinite(latNum) && Number.isFinite(lngNum) && lat !== '' && lng !== '';
  const canSave =
    hasPoint &&
    Math.abs(latNum) <= 90 &&
    Math.abs(lngNum) <= 180 &&
    address.trim().length >= 3 &&
    Number.isFinite(radiusNum) &&
    radiusNum > 0 &&
    radiusNum <= 500 &&
    !saving;

  // Seed the form whenever the dialog opens for a (possibly different) branch.
  useEffect(() => {
    if (!open) return;
    setLat(existing ? String(existing.latitude) : '');
    setLng(existing ? String(existing.longitude) : '');
    setAddress(existing?.address ?? row?.branchAddress ?? '');
    setRadiusKm(String(existing?.radiusKm ?? DEFAULT_GEOFENCE_RADIUS_KM));
    setPlaceId(existing?.googlePlaceId ?? null);
    setMapError(null);
    setMapReady(false);
  }, [open, existing, row?.branchAddress]);

  /** Move the pin and re-centre. The one place that writes lat/lng from the map. */
  const placePin = useCallback((position: google.maps.LatLngLiteral, panTo = true) => {
    setLat(position.lat.toFixed(7));
    setLng(position.lng.toFixed(7));
    markerRef.current?.setPosition(position);
    circleRef.current?.setCenter(position);
    if (panTo) mapRef.current?.panTo(position);
  }, []);

  // Build the map once the dialog is actually on screen. Deferred until `open`
  // because Google measures the container on construction — built while the dialog
  // is unmounted it renders as a grey box with the pin in the wrong corner.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        const maps = await loadGoogleMaps();
        if (cancelled || !mapNodeRef.current) return;

        const centre =
          existing && Number.isFinite(existing.latitude)
            ? { lat: existing.latitude, lng: existing.longitude }
            : FALLBACK_CENTRE;

        const map = new maps.Map(mapNodeRef.current, {
          center: centre,
          zoom: existing ? 14 : 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          // Touch devices need one finger for the page and two for the map, or the
          // dialog becomes impossible to scroll on a phone.
          gestureHandling: 'cooperative',
        });
        mapRef.current = map;

        markerRef.current = new maps.Marker({
          map,
          position: centre,
          draggable: true,
          title: row?.branchName ?? 'Branch location',
        });

        circleRef.current = new maps.Circle({
          map,
          center: centre,
          radius: (Number(existing?.radiusKm ?? DEFAULT_GEOFENCE_RADIUS_KM) || 0) * 1000,
          strokeColor: '#2563eb',
          strokeOpacity: 0.8,
          strokeWeight: 1.5,
          fillColor: '#3b82f6',
          fillOpacity: 0.12,
          clickable: false,
        });

        markerRef.current.addListener('dragend', () => {
          const p = markerRef.current?.getPosition();
          if (p) placePin({ lat: p.lat(), lng: p.lng() }, false);
        });

        map.addListener('click', (e: google.maps.MapMouseEvent) => {
          if (e.latLng) placePin({ lat: e.latLng.lat(), lng: e.latLng.lng() }, false);
        });

        // Places search. Autocomplete is bound to the map's viewport so results
        // near the current view rank first.
        if (searchNodeRef.current && maps.places) {
          const autocomplete = new maps.places.Autocomplete(searchNodeRef.current, {
            fields: ['geometry', 'formatted_address', 'name', 'place_id'],
          });
          autocomplete.bindTo('bounds', map);
          autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            const loc = place.geometry?.location;
            if (!loc) {
              toast.error('No location found for that search. Try picking from the list.');
              return;
            }
            placePin({ lat: loc.lat(), lng: loc.lng() });
            map.setZoom(15);
            setAddress(place.formatted_address ?? place.name ?? '');
            setPlaceId(place.place_id ?? null);
          });
        }

        if (!cancelled) setMapReady(true);
      } catch (err) {
        if (!cancelled) {
          setMapError(err instanceof Error ? err.message : 'The map could not be loaded.');
        }
      }
    })();

    return () => {
      cancelled = true;
      // Google keeps listeners alive on detached nodes; drop our references so the
      // next open builds cleanly rather than reusing a map bound to a dead element.
      markerRef.current = null;
      circleRef.current = null;
      mapRef.current = null;
    };
  }, [open, existing, row?.branchName, placePin]);

  // Keep the drawn circle in step with the radius field.
  useEffect(() => {
    if (!circleRef.current) return;
    const km = Number(radiusKm);
    if (Number.isFinite(km) && km > 0) circleRef.current.setRadius(km * 1000);
  }, [radiusKm, mapReady]);

  // Typed coordinates should move the pin too — the fields are a first-class way to
  // set the location, not a read-only mirror of the map.
  useEffect(() => {
    if (!markerRef.current || !hasPoint) return;
    if (Math.abs(latNum) > 90 || Math.abs(lngNum) > 180) return;
    const position = { lat: latNum, lng: lngNum };
    markerRef.current.setPosition(position);
    circleRef.current?.setCenter(position);
  }, [latNum, lngNum, hasPoint, mapReady]);

  /** Drop the pin on the admin's own device, for configuring a branch while standing in it. */
  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error('This device cannot report a location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        placePin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        mapRef.current?.setZoom(16);
        toast.success('Pin moved to your current location.');
      },
      () => toast.error('Could not read your location. Check the browser’s location permission.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function handleSave() {
    if (!canSave) return;
    try {
      await onSave({
        latitude: latNum,
        longitude: lngNum,
        address: address.trim(),
        radiusKm: radiusNum,
        googlePlaceId: placeId,
      });
      toast.success(`Location saved for ${row?.branchName ?? 'branch'}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the location');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent
        showCloseButton
        mobile="fullscreen"
        className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 md:w-[80vw] md:max-w-[900px]"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Set Location — {row?.branchName ?? 'Branch'}
          </DialogTitle>
          <DialogDescription>
            Search for the branch, click the map, or drag the pin. The shaded circle is the
            area sales will be allowed from.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Search — hidden without a map, since it is a Places feature. */}
          {isMapsConfigured() && (
            <div className="space-y-1">
              <label htmlFor="place-search" className="text-xs text-muted-foreground">
                Search address or place
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="place-search"
                  ref={searchNodeRef}
                  placeholder="e.g. Mountain Bakes, Gulshan-e-Iqbal"
                  className="h-11 pl-9 text-base sm:h-10 sm:text-sm"
                  // Enter would submit the surrounding dialog before Places has a
                  // chance to resolve the highlighted suggestion.
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                />
              </div>
            </div>
          )}

          {/* Map, or the reason there isn't one. */}
          {mapError ? (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">The map is unavailable</p>
                <p className="mt-1 text-xs leading-relaxed">{mapError}</p>
                <p className="mt-1 text-xs leading-relaxed">
                  You can still set the location by entering coordinates below.
                </p>
              </div>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-lg border">
              <div ref={mapNodeRef} className="h-[280px] w-full sm:h-[360px]" />
              {!mapReady && <Skeleton className="absolute inset-0" />}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="lat" className="text-xs text-muted-foreground">Latitude</label>
              <Input
                id="lat"
                inputMode="decimal"
                placeholder="24.8607000"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="h-11 text-base tabular-nums sm:h-10 sm:text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="lng" className="text-xs text-muted-foreground">Longitude</label>
              <Input
                id="lng"
                inputMode="decimal"
                placeholder="67.0011000"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className="h-11 text-base tabular-nums sm:h-10 sm:text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="addr" className="text-xs text-muted-foreground">Address</label>
            <Input
              id="addr"
              placeholder="Formatted address for this branch"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="h-11 text-base sm:h-10 sm:text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Allowed Radius</label>
              <Select
                value={RADIUS_PRESETS.includes(radiusNum) ? String(radiusNum) : 'custom'}
                onValueChange={(v) => { if (v && v !== 'custom') setRadiusKm(v); }}
              >
                <SelectTrigger className="h-11 w-full sm:h-10">
                  <SelectValue placeholder="Choose a radius" />
                </SelectTrigger>
                <SelectContent>
                  {RADIUS_PRESETS.map((km) => (
                    <SelectItem key={km} value={String(km)}>{km} KM</SelectItem>
                  ))}
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label htmlFor="radius" className="text-xs text-muted-foreground">Radius (KM)</label>
              <Input
                id="radius"
                inputMode="decimal"
                value={radiusKm}
                onChange={(e) => setRadiusKm(e.target.value.replace(/[^\d.]/g, ''))}
                className="h-11 text-base tabular-nums sm:h-10 sm:text-sm"
              />
            </div>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={useMyLocation}>
            <Crosshair className="mr-1.5 h-4 w-4" /> Use my current location
          </Button>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t bg-muted/40 px-5 py-3">
          <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
            {hasPoint
              ? `Sales allowed within ${formatDistanceKm(radiusNum)} of this point.`
              : 'No location selected yet.'}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            <Save className="mr-1.5 h-4 w-4" /> {saving ? 'Saving…' : 'Save Location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
