'use client';

import { useMemo, useState } from 'react';
import {
  formatDistanceKm,
  type BranchLocationRow,
  type BranchLocationStats,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import {
  useBranchLocations,
  useDeleteBranchLocation,
  useSetBranchLocationStatus,
  useUpsertBranchLocation,
} from '@/lib/queries';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LocationPickerDialog } from './LocationPickerDialog';
import { isMapsConfigured } from '@/lib/maps/loader';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ExternalLink,
  MapPin,
  MapPinOff,
  Radius,
  Store,
  Trash2,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/** One tile in the header strip. */
function Stat({
  label,
  value,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  tone?: 'default' | 'warn' | 'good';
}) {
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            'h-4 w-4 shrink-0',
            tone === 'warn' && 'text-amber-600',
            tone === 'good' && 'text-emerald-600',
            tone === 'default' && 'text-muted-foreground',
          )}
        />
        <p className="text-[11px] font-medium uppercase leading-none tracking-wide text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

const EMPTY_STATS: BranchLocationStats = {
  totalBranches: 0,
  activeBranches: 0,
  gpsConfigured: 0,
  missingGps: 0,
  onlineUsers: 0,
  usersOutsideRadius: 0,
};

/**
 * Admin → Branch Locations.
 *
 * Lists every branch — not just the geofenced ones — because a branch WITHOUT a
 * location is the actionable row here. Under the fail-open rule an unconfigured
 * branch is unrestricted, so "Missing GPS" is the work queue, not an error state.
 */
export function BranchLocationsPage() {
  const { token } = useAuth();
  const { data, isLoading, isError } = useBranchLocations(token);
  const upsert = useUpsertBranchLocation(token);
  const setStatus = useSetBranchLocationStatus(token);
  const remove = useDeleteBranchLocation(token);

  const [picking, setPicking] = useState<BranchLocationRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BranchLocationRow | null>(null);

  const rows = useMemo(() => data?.branches ?? [], [data?.branches]);
  const stats = data?.stats ?? EMPTY_STATS;

  async function handleToggle(row: BranchLocationRow) {
    if (!row.location) return;
    try {
      await setStatus.mutateAsync({ branchId: row.branchId, isActive: !row.location.isActive });
      toast.success(
        row.location.isActive
          ? `Geofence disabled for ${row.branchName}`
          : `Geofence enabled for ${row.branchName}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the status');
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await remove.mutateAsync(confirmDelete.branchId);
      toast.success(`Location removed for ${confirmDelete.branchName}`);
      setConfirmDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the location');
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Geofencing off globally is the single most important thing to say on this
          screen: every location below is configured but inert until it is on. */}
      {data && !data.geofencingEnabled && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Geofencing is switched off</p>
            <p className="mt-1 text-xs leading-relaxed">
              Locations configured here are saved but not enforced — sales are allowed from
              anywhere. Turn it on in Settings → Geofencing once these locations look right.
            </p>
          </div>
        </div>
      )}

      {!isMapsConfigured() && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Google Maps is not configured</p>
            <p className="mt-1 text-xs leading-relaxed">
              NEXT_PUBLIC_GOOGLE_MAPS_API_KEY was not set when this app was built, so the map
              picker cannot load. Coordinates can still be entered by hand. Setting the key
              requires a rebuild — it is inlined at build time.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Total Branches" value={stats.totalBranches} icon={Store} />
        <Stat label="Active" value={stats.activeBranches} icon={CheckCircle2} tone="good" />
        <Stat label="GPS Configured" value={stats.gpsConfigured} icon={MapPin} tone="good" />
        <Stat
          label="Missing GPS"
          value={stats.missingGps}
          icon={MapPinOff}
          tone={stats.missingGps > 0 ? 'warn' : 'default'}
        />
        <Stat label="Online Users" value={stats.onlineUsers} icon={Users} />
        <Stat
          label="Outside Radius"
          value={stats.usersOutsideRadius}
          icon={Ban}
          tone={stats.usersOutsideRadius > 0 ? 'warn' : 'default'}
        />
      </div>

      {isError ? (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          Could not load branch locations. Please refresh.
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="text-xs uppercase tracking-wide">Branch</TableHead>
                  <TableHead className="text-xs uppercase tracking-wide">Address</TableHead>
                  <TableHead className="text-xs uppercase tracking-wide">Latitude</TableHead>
                  <TableHead className="text-xs uppercase tracking-wide">Longitude</TableHead>
                  <TableHead className="text-xs uppercase tracking-wide">Radius</TableHead>
                  <TableHead className="text-xs uppercase tracking-wide">Status</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wide">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.branchId}>
                    <TableCell className="font-medium">{row.branchName}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">
                      {row.location?.address || row.branchAddress || '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.location ? row.location.latitude.toFixed(5) : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.location ? row.location.longitude.toFixed(5) : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {row.location ? formatDistanceKm(row.location.radiusKm) : '—'}
                    </TableCell>
                    <TableCell>
                      {!row.location ? (
                        <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300">
                          Missing GPS
                        </Badge>
                      ) : row.location.isActive ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Enforced</Badge>
                      ) : (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setPicking(row)}>
                          <MapPin className="mr-1 h-3.5 w-3.5" />
                          {row.location ? 'Edit' : 'Set Location'}
                        </Button>
                        {row.location && (
                          <>
                            {/* A plain anchor carrying the button styles rather than
                                a Button: this is @base-ui/react, which has no
                                `asChild`. A maps.google.com URL, not the JS SDK — it
                                works without an API key and opens the user's own
                                map app on a phone. */}
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${row.location.latitude},${row.location.longitude}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              aria-label={`View ${row.branchName} on Google Maps`}
                              className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleToggle(row)}
                              disabled={setStatus.isPending}
                            >
                              {row.location.isActive ? 'Disable' : 'Enable'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setConfirmDelete(row)}
                              aria-label={`Remove location for ${row.branchName}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <div key={row.branchId} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{row.branchName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.location?.address || row.branchAddress || 'No address'}
                    </p>
                  </div>
                  {!row.location ? (
                    <Badge variant="outline" className="shrink-0 border-amber-400 text-amber-700 dark:text-amber-300">
                      Missing GPS
                    </Badge>
                  ) : row.location.isActive ? (
                    <Badge className="shrink-0 bg-emerald-600 hover:bg-emerald-600">Enforced</Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0">Disabled</Badge>
                  )}
                </div>

                {row.location && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Latitude</p>
                      <p className="tabular-nums">{row.location.latitude.toFixed(5)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Longitude</p>
                      <p className="tabular-nums">{row.location.longitude.toFixed(5)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Radius</p>
                      <p className="tabular-nums">{formatDistanceKm(row.location.radiusKm)}</p>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setPicking(row)}>
                    <MapPin className="mr-1 h-3.5 w-3.5" />
                    {row.location ? 'Edit' : 'Set Location'}
                  </Button>
                  {row.location && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => handleToggle(row)} disabled={setStatus.isPending}>
                        {row.location.isActive ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmDelete(row)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {rows.length === 0 && (
            <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
              No branches yet. Add one under Admin → Branches first.
            </div>
          )}
        </>
      )}

      <LocationPickerDialog
        open={picking !== null}
        onOpenChange={(o) => !o && setPicking(null)}
        row={picking}
        saving={upsert.isPending}
        onSave={(input) =>
          upsert.mutateAsync({ branchId: picking!.branchId, input })
        }
      />

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radius className="h-5 w-5 text-destructive" /> Remove location?
            </DialogTitle>
            <DialogDescription>
              {confirmDelete?.branchName} will no longer be geofenced — sales from that
              branch will be allowed from anywhere. Use Disable instead if you want to keep
              the coordinates.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={remove.isPending}>
              {remove.isPending ? 'Removing…' : 'Remove Location'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
