/**
 * The API's auth error codes → messages for the password-recovery flows.
 *
 * Used by ForgotPasswordDialog (logged-out self-service). The login screens
 * keep their own maps — their wording is about signing in, not about sending
 * mail.
 */
export const RESET_ERROR_MESSAGES: Record<string, string> = {
  mail_not_configured:
    'Email is not set up on the server, so a reset link cannot be sent. Ask an administrator to reset the password directly.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  auth_not_configured: 'Password recovery is not available right now. Please contact your administrator.',
};

/**
 * Map an unknown thrown/returned auth error to user-facing text.
 *
 * Falls back to the raw message, then to `fallback` — an unmapped failure should
 * still say something rather than render an empty error box.
 */
export function resetErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = err instanceof Error ? err.message : ((err as { message?: string } | null)?.message ?? '');
  // A request that never got an answer carries the browser's wording, not ours.
  if (err instanceof TypeError || (err as Error | null)?.name === 'AbortError') {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return RESET_ERROR_MESSAGES[code] || message || fallback;
}
