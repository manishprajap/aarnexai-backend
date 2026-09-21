//src/app/api/whatsApp/connect/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { whatsappConnections } from '@/db/schema';
import { getUserIdFromRequest, AuthError } from '@/lib/auth';
import {verifyWhatsAppSession,} from '@/lib/whatsappSession';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

type GraphError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  fbtrace_id?: string;
};

type ConnectBody = {
  code?: unknown;
  wabaId?: unknown;
  phoneNumberId?: unknown;
};

function fail(
  step: string,
  message: string,
  status = 400,
  detail?: GraphError
) {
  return NextResponse.json(
    {
      success: false,
      step,
      message:
        detail?.error_user_msg || detail?.message || message,
      detail: detail
        ? {
            code: detail.code,
            subcode: detail.error_subcode,
            type: detail.type,
            fbtrace_id: detail.fbtrace_id,
          }
        : undefined,
    },
    { status }
  );
}

async function graph<T>(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; data: T & { error?: GraphError } }> {
  const res = await fetch(url, { ...init, cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: GraphError;
  };
  return { ok: res.ok && !data.error, data };
}

export async function POST(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);

    const body = (await req.json().catch(() => ({}))) as ConnectBody;

    const code =
      typeof body.code === 'string' ? body.code.trim() : '';
    const wabaId =
      typeof body.wabaId === 'string' ? body.wabaId.trim() : '';
    const phoneNumberId =
      typeof body.phoneNumberId === 'string'
        ? body.phoneNumberId.trim()
        : '';

    console.log('[WhatsApp] Connect request:', {
      userId,
      codeLength: code.length,
      wabaId,
      phoneNumberId,
      graphVersion: GRAPH_VERSION,
    });

    const missing = [
      !code && 'code',
      !wabaId && 'wabaId',
      !phoneNumberId && 'phoneNumberId',
    ].filter(Boolean);

    if (missing.length) {
      return fail(
        'validation',
        `Missing required field(s): ${missing.join(', ')}`
      );
    }

    const appId = process.env.META_FACEBOOK_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!appId || !appSecret) {
      console.error('[WhatsApp] META_FACEBOOK_APP_ID / META_APP_SECRET not set');
      return fail(
        'config',
        'Server is missing Meta credentials',
        500
      );
    }

    // STEP 1 — exchange the Embedded Signup code for a business token.
    // No redirect_uri here: the code came from FB.login, not a redirect.
    const tokenParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      code,
    });

    const token = await graph<{ access_token?: string }>(
      `${GRAPH}/oauth/access_token?${tokenParams}`,
      { method: 'GET' }
    );

    if (!token.ok || !token.data.access_token) {
      console.error('[WhatsApp] Token exchange failed:', token.data);
      return fail(
        'token_exchange',
        'Unable to exchange WhatsApp signup code. Codes expire in ~30s and are single-use.',
        400,
        token.data.error
      );
    }

    const accessToken = token.data.access_token;

    // STEP 2 — confirm the token really grants access to this WABA and phone,
    // and pull the display details in one call.
    const phone = await graph<{
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
    }>(
      `${GRAPH}/${encodeURIComponent(
        phoneNumberId
      )}?fields=id,display_phone_number,verified_name,quality_rating`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!phone.ok) {
      console.error('[WhatsApp] Phone lookup failed:', phone.data);
      return fail(
        'phone_lookup',
        'Unable to retrieve WhatsApp phone information',
        400,
        phone.data.error
      );
    }

    // STEP 3 — subscribe your app to the WABA so webhooks fire.
    // No body, and no Content-Type header.
    const subscribe = await graph<{ success?: boolean }>(
      `${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!subscribe.ok) {
      console.error('[WhatsApp] WABA subscription failed:', subscribe.data);
      return fail(
        'subscribe',
        'Failed to subscribe app to WhatsApp Business Account',
        400,
        subscribe.data.error
      );
    }

    // STEP 4 — register the number on Cloud API. Required before you can send.
    // Already-registered numbers return an error we can safely ignore.
    const pin =
      process.env.WHATSAPP_REGISTER_PIN &&
      /^\d{6}$/.test(process.env.WHATSAPP_REGISTER_PIN)
        ? process.env.WHATSAPP_REGISTER_PIN
        : '000000';

    const register = await graph<{ success?: boolean }>(
      `${GRAPH}/${encodeURIComponent(phoneNumberId)}/register`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      }
    );

    if (!register.ok) {
      // 133005 = wrong PIN on an already-registered number, 133010 = already registered.
      const c = register.data.error?.code;
      const sub = register.data.error?.error_subcode;
      const benign = c === 133010 || sub === 2388008 || sub === 2388009;
      if (!benign) {
        console.warn('[WhatsApp] Register warning:', register.data);
      }
    }

    // STEP 5 — persist.
    const record = {
      wabaId,
      phoneNumberId,
      businessPhoneNumber: phone.data.display_phone_number ?? null,
      businessName: phone.data.verified_name ?? null,
      accessToken,
      status: 'active' as const,
    };

    const existing = await db
      .select({ id: whatsappConnections.id })
      .from(whatsappConnections)
      .where(eq(whatsappConnections.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(whatsappConnections)
        .set({ ...record, updatedAt: new Date() })
        .where(eq(whatsappConnections.userId, userId));
    } else {
      await db
        .insert(whatsappConnections)
        .values({ userId, ...record });
    }

    console.log('[WhatsApp] Connection saved:', {
      userId,
      wabaId,
      phoneNumberId,
      businessPhoneNumber: record.businessPhoneNumber,
    });

    return NextResponse.json({
      success: true,
      message: 'WhatsApp connected successfully',
      data: {
        wabaId,
        phoneNumberId,
        businessPhoneNumber: record.businessPhoneNumber,
        businessName: record.businessName,
        status: 'active',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, step: 'auth', message: error.message },
        { status: 401 }
      );
    }

    console.error('[WhatsApp] Connect error:', error);

    return NextResponse.json(
      {
        success: false,
        step: 'unknown',
        message: 'Failed to connect WhatsApp',
      },
      { status: 500 }
    );
  }
}
