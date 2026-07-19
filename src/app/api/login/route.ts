import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { uid, role, branchId, branchName, mustChangePassword } = await req.json() as {
    uid: string;
    role: string;
    branchId: string | null;
    branchName: string | null;
    mustChangePassword?: boolean;
  };

  const sessionData = Buffer.from(
    JSON.stringify({ uid, role, branchId, branchName, mustChangePassword: !!mustChangePassword })
  ).toString('base64');

  const res = NextResponse.json({ success: true });
  res.cookies.set('mb_session', sessionData, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  return res;
}
