/**
 * Supabase Auth error codes → messages for the password-recovery flows.
 *
 * Shared by ForgotPasswordDialog (logged-out self-service) and
 * ResetPasswordDialog (admin resetting someone else), so the two can't drift.
 * The login screen keeps its own map — its wording is about signing in, not
 * about sending mail.
 *
 * `email_address_invalid` is the one that most needs translating. Supabase
 * returns it when the recipient DOMAIN cannot receive mail (no MX record), NOT
 * when the address is malformed. Its raw text reads
 * 'Email address "admin@example.com" is invalid', which sends people hunting for
 * a typo in an address that is perfectly well-formed. Both callers have already
 * validated the format before they get here.
 */
export const RESET_ERROR_MESSAGES: Record<string, string> = {
  email_address_invalid:
    'That email address can’t receive mail, so a reset link cannot be sent. Check the address, or ask an administrator to reset the password directly.',
  over_email_send_rate_limit:
    'Too many reset emails have been requested. Please wait a few minutes and try again.',
  over_request_rate_limit: 'Too many attempts. Please wait a moment and try again.',
  validation_failed: 'Please enter a valid email address.',
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
  return RESET_ERROR_MESSAGES[code] || message || fallback;
}
