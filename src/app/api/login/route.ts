import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidRole } from '@/utils/roleHome';

/**
 * Establish the first-party `mb_session` cookie that `src/proxy.ts` uses for route
 * guarding.
 *
 * SECURITY: the identity written into this cookie is derived from a Supabase access
 * token that this route verifies server-side — never from the request body. An
 * earlier version accepted `{ uid, role, branchId, ... }` straight from the client
 * and base64-encoded it, so anyone could POST `role: "super_admin"` and receive a
 * cookie the proxy fully trusted. The cookie is still unsigned base64, which is
 * fine now that only this route can mint one: it is httpOnly, so page JS cannot
 * forge it, and every actual data read is separately authorised by the Express API
 * against the real JWT.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Auth is not configured on the server.' }, { status: 500 });
  }

  let body: { accessToken?: string; rememberMe?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const accessToken = body.accessToken;
  if (!accessToken) {
    return NextResponse.json({ error: 'Missing access token.' }, { status: 400 });
  }

  // Verify the token with Supabase. The anon key is sufficient — the token itself
  // identifies the user, and getUser() rejects anything forged or expired.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  const claims = (data.user.app_metadata ?? {}) as {
    role?: string;
    branchId?: string | null;
    branchName?: string | null;
    mustChangePassword?: boolean;
  };

  // Fail closed, mirroring the API's `authenticate` middleware: an account with no
  // recognised role gets no session at all rather than a default one.
  if (!isValidRole(claims.role)) {
    return NextResponse.json(
      { error: 'This account has no role assigned. Contact your administrator.' },
      { status: 403 }
    );
  }

  const sessionData = Buffer.from(
    JSON.stringify({
      uid: data.user.id,
      role: claims.role,
      branchId: claims.branchId ?? null,
      branchName: claims.branchName ?? null,
      mustChangePassword: claims.mustChangePassword === true,
    })
  ).toString('base64');

  const res = NextResponse.json({ success: true, role: claims.role });
  res.cookies.set('mb_session', sessionData, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    // "Remember me" → persistent 7-day cookie. Otherwise omit maxAge entirely so the
    // browser treats it as a session cookie and drops it when the browser closes.
    ...(body.rememberMe ? { maxAge: 60 * 60 * 24 * 7 } : {}),
    path: '/',
  });

  return res;
}
