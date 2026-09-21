// src/app/api/instagram/connect/route.ts
import { NextRequest, NextResponse } from 'next/server';

import {
  getUserIdFromRequest,
  AuthError,
} from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    // --------------------------------------------------
    // 1. GET LOGGED-IN BIZMYNTRA USER
    // --------------------------------------------------

    const userId = getUserIdFromRequest(req);

    console.log('Starting Instagram connection:', {
      userId,
    });

    // --------------------------------------------------
    // 2. READ REQUEST BODY (optional — frontend may send {})
    // --------------------------------------------------

    const body = await req.json().catch(() => ({}));

    const bannerId =
      body?.bannerId !== undefined &&
      body?.bannerId !== null &&
      body?.bannerId !== ''
        ? Number(body.bannerId)
        : null;

    console.log('Instagram connection request:', {
      userId,
      bannerId,
    });

    // --------------------------------------------------
    // 3. VALIDATE BANNER ID IF PROVIDED
    // --------------------------------------------------

    if (
      bannerId !== null &&
      (!Number.isFinite(bannerId) || bannerId <= 0)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid bannerId',
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 4. ENVIRONMENT
    // --------------------------------------------------

    const clientId = process.env.META_APP_ID;

    const redirectUri =
      process.env.META_REDIRECT_URI ||
      'https://aarnexai.com/aarnexai-backend/api/meta/callback';

    // TEMP DIAGNOSTICS — remove once redirect_uri mismatch is confirmed fixed.
    console.log('Instagram OAuth configuration:', {
      hasMetaAppId: !!clientId,
      clientId,
      redirectUri,
      redirectUriJSON: JSON.stringify(redirectUri),
      redirectUriLength: redirectUri.length,
    });

    if (!clientId) {
      console.error('META_APP_ID is missing');

      return NextResponse.json(
        {
          success: false,
          message: 'META_APP_ID is not configured',
        },
        { status: 500 }
      );
    }

    if (!redirectUri) {
      console.error('META_REDIRECT_URI is missing');

      return NextResponse.json(
        {
          success: false,
          message: 'META_REDIRECT_URI is not configured',
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // 5. CREATE OAUTH STATE
    // --------------------------------------------------

    const statePayload = {
      userId: Number(userId),
      bannerId,
      timestamp: Date.now(),
    };

    const state = Buffer.from(
      JSON.stringify(statePayload),
      'utf8'
    ).toString('base64url');

    console.log('Instagram OAuth state created:', {
      userId,
      bannerId,
    });

    // --------------------------------------------------
    // 6. INSTAGRAM LOGIN URL
    // --------------------------------------------------

    const params = new URLSearchParams();

    params.set('client_id', clientId);
    params.set('redirect_uri', redirectUri);

    params.set(
      'scope',
      [
        'instagram_business_basic',
        'instagram_business_content_publish',
      ].join(',')
    );

    params.set('response_type', 'code');
    params.set('state', state);

    // IMPORTANT: Instagram Login, not Facebook Login.
    params.set('enable_fb_login', '0');

    const instagramUrl =
      `https://www.instagram.com/oauth/authorize?${params.toString()}`;

    console.log('Instagram OAuth URL generated successfully:', instagramUrl);

    // --------------------------------------------------
    // 7. RETURN URL TO FRONTEND
    // --------------------------------------------------

    return NextResponse.json({
      success: true,
      redirectUrl: instagramUrl,
      userId: Number(userId),
      bannerId,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      console.error(
        'Instagram connect authentication error:',
        error.message
      );

      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        { status: 401 }
      );
    }

    console.error('Instagram connect error:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to start Instagram connection',
      },
      { status: 500 }
    );
  }
}