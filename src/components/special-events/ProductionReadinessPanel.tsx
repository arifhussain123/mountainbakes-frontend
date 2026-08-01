'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useEventProductionStatus, useUpdateEventStage } from '@/lib/queries';
import { formatDateTime } from '@/utils/date';
import { EVENT_STAGE_LABELS, type EventProductionStatusRow } from '@mb/shared';
import { ProgressBar } from './EventBits';

/**
 * The four manual preparation stages.
 *
 * Manual because nothing in this schema can derive them: there is no
 * raw_materials table and no bill of materials, so "Raw Materials 70%" is a
 * production user's judgement, recorded rather than computed. Overall readiness
 * is the mean of the four, computed server-side on read.
 *
 * There is no slider primitive in this project and adding a dependency for one
 * control would be the wrong trade — a number input plus five preset buttons is
 * faster on a phone anyway.
 */

const PRESETS = [0, 25, 50, 75, 100];

export function ProductionReadinessPanel({
  eventId,
  editable,
}: {
  eventId: string;
  /** false for admin-viewing-only and for branch managers. */
  editable: boolean;
}) {
  const { token } = useAuth();
  const statusQ = useEventProductionStatus(token, eventId);
  const updateStage = useUpdateEventStage(token);

  const stages = statusQ.data?.stages ?? [];
  const readiness = statusQ.data?.readinessPercentage ?? 0;

  if (statusQ.isLoading) {
    return (
      <div className="space-y-3">
        {PRESETS.slice(0, 4).map((n) => (
          <Skeleton key={n} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between">
            <h3 className="font-heading text-sm font-semibold">Overall Readiness</h3>
            <span className="text-2xl font-bold tabular-nums">{readiness}%</span>
          </div>
          <ProgressBar value={readiness} className="mt-2" />
          <p className="mt-2 text-xs text-muted-foreground">
            The average of the four stages below.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {stages.map((stage) => (
          <StageCard
            // Keyed on the server values, not just the id: a change from another
            // production user remounts the card so its inputs re-seed from the
            // new truth. Cheaper and less surprising than syncing in an effect,
            // and the server value is the one that should win.
            key={`${stage.id}:${stage.completionPercentage}:${stage.remarks ?? ''}`}
            stage={stage}
            editable={editable}
            saving={updateStage.isPending}
            onSave={async (completionPercentage, remarks) => {
              try {
                await updateStage.mutateAsync({
                  eventId,
                  stage: stage.stage,
                  completionPercentage,
                  remarks,
                });
                toast.success(`${EVENT_STAGE_LABELS[stage.stage]} updated`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Failed to update stage');
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function StageCard({
  stage,
  editable,
  saving,
  onSave,
}: {
  stage: EventProductionStatusRow;
  editable: boolean;
  saving: boolean;
  onSave: (completionPercentage: number, remarks: string) => Promise<void>;
}) {
  // Seeded once per mount; the parent's key includes the server values, so a
  // change from elsewhere remounts this card rather than being synced in.
  const [percentage, setPercentage] = useState(stage.completionPercentage);
  const [remarks, setRemarks] = useState(stage.remarks ?? '');

  const dirty = percentage !== stage.completionPercentage || remarks !== (stage.remarks ?? '');

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <h4 className="font-medium">{EVENT_STAGE_LABELS[stage.stage]}</h4>
          <span className="text-sm font-semibold tabular-nums">{stage.completionPercentage}%</span>
        </div>

        <ProgressBar value={stage.completionPercentage} />

        {stage.completedAt ? (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            Completed {formatDateTime(stage.completedAt)}
            {stage.updatedByName ? ` by ${stage.updatedByName}` : ''}
          </p>
        ) : stage.startedAt ? (
          <p className="text-xs text-muted-foreground">Started {formatDateTime(stage.startedAt)}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Not started</p>
        )}

        {!editable && stage.remarks && (
          <p className="text-sm text-muted-foreground">{stage.remarks}</p>
        )}

        {editable && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={percentage === preset ? 'default' : 'outline'}
                  className="min-h-11 flex-1 md:min-h-8"
                  onClick={() => setPercentage(preset)}
                >
                  {preset}%
                </Button>
              ))}
            </div>

            <div className="space-y-1">
              <Label htmlFor={`pct-${stage.id}`}>Completion %</Label>
              <Input
                id={`pct-${stage.id}`}
                type="number"
                min={0}
                max={100}
                value={percentage}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setPercentage(Number.isFinite(next) ? Math.max(0, Math.min(100, next)) : 0);
                }}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`remarks-${stage.id}`}>Remarks</Label>
              <Input
                id={`remarks-${stage.id}`}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional note…"
              />
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={!dirty || saving}
              onClick={() => onSave(percentage, remarks)}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
