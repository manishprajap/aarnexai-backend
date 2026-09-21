import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/adminAuth';

/*
|--------------------------------------------------------------------------
| POST /api/admin/logout
|--------------------------------------------------------------------------
*/

export async function POST() {
  const response = NextResponse.json({ success: true });

  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });

  return response;
}