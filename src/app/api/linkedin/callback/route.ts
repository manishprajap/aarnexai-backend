import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { socialAccounts } from '@/db/schema';
import {
  getSocialOAuthFrontendUrl,
  verifySocialOAuthState,
} from '@/lib/socialOAuth';

function redirectToFrontend(status: 'connected' | 'error', message?: string) {
  const url = new URL(`${getSocialOAuthFrontendUrl()}/dashboard`);
  url.searchParams.set('linkedin', status);

  if (message) url.searchParams.set('message', message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) return redirectToFrontend('error', error);
  if (!code || !state) return redirectToFrontend('error', 'missing_code_or_state');

  const stateData = verifySocialOAuthState(state, 'linkedin');
  if (!stateData) return redirectToFrontend('error', 'invalid_or_expired_state');

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return redirectToFrontend('error', 'linkedin_oauth_not_configured');
  }

  try {
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
      cache: 'no-store',
    });

    if (!tokenResponse.ok) return redirectToFrontend('error', 'token_exchange_failed');

    const tokenData = await tokenResponse.json() as {
      access_token?: string;
      expires_in?: number;
    };

    if (!tokenData.access_token) return redirectToFrontend('error', 'missing_access_token');

    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      cache: 'no-store',
    });
    const profile = profileResponse.ok
      ? await profileResponse.json() as { sub?: string; name?: string; email?: string }
      : {};

    const provider = 'linkedin';
    const [existing] = await db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.userId, stateData.userId), eq(socialAccounts.provider, provider)))
      .limit(1);

    const values = {
      userId: stateData.userId,
      provider,
      providerAccountId: profile.sub || null,
      accountName: profile.name || profile.email || null,
      accessToken: tokenData.access_token,
      refreshToken: null,
      expiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : null,
    };

    if (existing) {
      await db.update(socialAccounts).set(values).where(eq(socialAccounts.id, existing.id));
    } else {
      await db.insert(socialAccounts).values(values);
    }

    return redirectToFrontend('connected');
  } catch (callbackError) {
    console.error('[LinkedIn Callback] Error:', callbackError);
    return redirectToFrontend('error', 'connection_failed');
  }
}
