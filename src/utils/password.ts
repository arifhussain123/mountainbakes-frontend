// Client-side password policy helpers. Mirror StrongPasswordSchema in @mb/shared.

export interface PasswordCheck {
  label: string;
  passed: boolean;
}

export function passwordChecks(pw: string): PasswordCheck[] {
  return [
    { label: 'At least 8 characters', passed: pw.length >= 8 },
    { label: 'One uppercase letter', passed: /[A-Z]/.test(pw) },
    { label: 'One lowercase letter', passed: /[a-z]/.test(pw) },
    { label: 'One number', passed: /[0-9]/.test(pw) },
    { label: 'One special character', passed: /[^A-Za-z0-9]/.test(pw) },
  ];
}

/** Number of satisfied rules, 0–5. */
export function passwordScore(pw: string): number {
  return passwordChecks(pw).filter((c) => c.passed).length;
}

export function isStrongPassword(pw: string): boolean {
  return pw.length > 0 && passwordScore(pw) === 5;
}
