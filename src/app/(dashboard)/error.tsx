'use client';

import { ErrorDetails } from '@/components/shared/ErrorDetails';

/**
 * A screen inside the signed-in app threw while rendering. The sidebar and top
 * bar stay up — only the page area is replaced — so the user can still move to
 * another screen.
 */
export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorDetails error={error} onRetry={unstable_retry} />;
}
