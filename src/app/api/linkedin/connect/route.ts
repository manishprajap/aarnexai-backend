import { NextRequest, NextResponse } from 'next/server';

import { AuthError, getUserIdFromRequest } from '@/lib/auth';
import { createSocialOAuthState } from '@/lib/socialOAuth';

export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return NextResponse.json(
        { success: false, message: 'LinkedIn OAuth is not configured' },
        { status: 500 }
      );
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: createSocialOAuthState(userId, 'linkedin'),
      scope: 'openid profile email w_member_social',
    });

    return NextResponse.json({
      success: true,
      redirectUrl: `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    console.error('[LinkedIn Connect] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to start LinkedIn connection' },
      { status: 500 }
    );
  }
}
