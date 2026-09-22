import { NextRequest, NextResponse } from 'next/server';

import { AuthError, getUserIdFromRequest } from '@/lib/auth';
import { createSocialOAuthState } from '@/lib/socialOAuth';

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_ANALYTICS_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { success: false, message: 'Google Analytics OAuth is not configured' },
        { status: 500 }
      );
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: 'openid email profile https://www.googleapis.com/auth/analytics.readonly',
      state: createSocialOAuthState(userId, 'google_analytics'),
    });

    return NextResponse.json({
      success: true,
      redirectUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    console.error('[Google Analytics Connect] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to start Google Analytics connection' },
      { status: 500 }
    );
  }
}
