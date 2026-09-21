import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';

export function middleware(req: NextRequest) {
  const headers = corsHeaders(req.headers.get('origin'));

  // Preflight
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();

  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

export const config = {
  matcher: '/api/:path*',
};