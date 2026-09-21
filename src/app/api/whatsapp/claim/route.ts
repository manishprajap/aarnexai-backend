//src/app/api/whatsapp/claim/route.ts
//
// Call this from your app right after the user returns from the
// Meta-hosted onboarding page ("Your account was successfully shared
// with AarnaTech Xperts"). It finds the client's newly-shared WABA,
// subscribes your app to it, saves it against the logged-in user,
// and returns the details.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { whatsappConnections } from '@/db/schema';
import { getUserIdFromRequest, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

type GraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  fbtrace_id?: string;
};

function fail(step: string, message: string, status = 400, detail?: GraphError) {
  return NextResponse.json(
    {
      success: false,
      step,
      message: detail?.error_user_msg || detail?.message || message,
      detail: detail
        ? { code: detail.code, subcode: detail.error_subcode, fbtrace_id: detail.fbtrace_id }
        : undefined,
    },
    { status }
  );
}

async function graph<T>(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as T & { error?: GraphError };
  return { ok: res.ok && !data.error, data };
}

export async function POST(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);

    const businessId = process.env.META_BUSINESS_ID;
    const systemToken = process.env.META_SYSTEM_USER_TOKEN;
    const appId = process.env.META_FACEBOOK_APP_ID;

    if (!businessId || !systemToken || !appId) {
      console.error(
        '[WhatsApp Claim] Missing META_BUSINESS_ID / META_SYSTEM_USER_TOKEN / META_FACEBOOK_APP_ID'
      );
      return fail('config', 'Server is missing Meta business credentials', 500);
    }

    // STEP 1 — get all WABAs that have been shared with your business.
    const clientWabas = await graph<{
      data?: Array<{ id: string; name?: string }>;
    }>(
      `${GRAPH}/${encodeURIComponent(businessId)}/client_whatsapp_business_accounts?fields=id,name`,
      { method: 'GET', headers: { Authorization: `Bearer ${systemToken}` } }
    );

    if (!clientWabas.ok || !clientWabas.data.data) {
      console.error('[WhatsApp Claim] Failed to list client WABAs:', clientWabas.data);
      return fail(
        'list_client_wabas',
        'Unable to list WhatsApp accounts shared with your business',
        400,
        clientWabas.data.error
      );
    }

    // STEP 2 — exclude WABAs already saved against some user.
    const alreadySaved = await db
      .select({ wabaId: whatsappConnections.wabaId })
      .from(whatsappConnections);

    const savedIds = new Set(alreadySaved.map((r) => r.wabaId));
    const unclaimed = clientWabas.data.data.filter((w) => !savedIds.has(w.id));

    if (unclaimed.length === 0) {
      return fail(
        'no_new_account',
        'No newly shared WhatsApp account was found. Please complete the "Get started" flow first.',
        404
      );
    }

    // Most recently shared one is assumed to be the one this user just
    // completed. If multiple people can be onboarding at once, add a
    // pending-connection record before redirecting instead of relying on this.
    const waba = unclaimed[unclaimed.length - 1];

    // STEP 3 — fetch the phone number(s) under this WABA.
    const phones = await graph<{
      data?: Array<{
        id: string;
        display_phone_number?: string;
        verified_name?: string;
      }>;
    }>(`${GRAPH}/${encodeURIComponent(waba.id)}/phone_numbers`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${systemToken}` },
    });

    if (!phones.ok || !phones.data.data?.length) {
      console.error('[WhatsApp Claim] Failed to fetch phone numbers:', phones.data);
      return fail(
        'phone_lookup',
        'Shared WhatsApp account has no phone number yet',
        400,
        phones.data.error
      );
    }

    const phone = phones.data.data[0];

    // STEP 4 — subscribe your app to this WABA so future webhooks fire.
    const subscribe = await graph<{ success?: boolean }>(
      `${GRAPH}/${encodeURIComponent(waba.id)}/subscribed_apps`,
      { method: 'POST', headers: { Authorization: `Bearer ${systemToken}` } }
    );

    if (!subscribe.ok) {
      console.error('[WhatsApp Claim] Subscribe failed:', subscribe.data);
      return fail(
        'subscribe',
        'Failed to subscribe app to WhatsApp Business Account',
        400,
        subscribe.data.error
      );
    }

    // STEP 5 — persist against the logged-in user.
    const record = {
      wabaId: waba.id,
      phoneNumberId: phone.id,
      businessPhoneNumber: phone.display_phone_number ?? null,
      businessName: phone.verified_name ?? waba.name ?? null,
      accessToken: systemToken,
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
      await db.insert(whatsappConnections).values({ userId, ...record });
    }

    console.log('[WhatsApp Claim] Connection saved:', {
      userId,
      wabaId: waba.id,
      phoneNumberId: phone.id,
    });

    return NextResponse.json({
      success: true,
      message: 'WhatsApp account linked successfully',
      data: {
        wabaId: waba.id,
        phoneNumberId: phone.id,
        businessPhoneNumber: record.businessPhoneNumber,
        businessName: record.businessName,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, step: 'auth', message: error.message },
        { status: 401 }
      );
    }

    console.error('[WhatsApp Claim] Error:', error);

    return NextResponse.json(
      { success: false, step: 'unknown', message: 'Failed to link WhatsApp account' },
      { status: 500 }
    );
  }
}