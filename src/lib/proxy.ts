
import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/adminAuth';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '/aarnexai-backend';

export function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  const isValid = verifySessionToken(token);

  if (!isValid) {
    const loginUrl = new URL(`${BASE_PATH}/login`, req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};

