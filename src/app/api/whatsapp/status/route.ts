// src/app/api/whatsapp/status/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { whatsappConnections } from '@/db/schema';
import {
  getUserIdFromRequest,
  AuthError,
} from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);

    const connection = await db
      .select({
        id: whatsappConnections.id,
        wabaId: whatsappConnections.wabaId,
        phoneNumberId: whatsappConnections.phoneNumberId,
        businessPhoneNumber:
          whatsappConnections.businessPhoneNumber,
        businessName: whatsappConnections.businessName,
        tokenExpiresAt: whatsappConnections.tokenExpiresAt,
        status: whatsappConnections.status,
      })
      .from(whatsappConnections)
      .where(eq(whatsappConnections.userId, userId))
      .limit(1);

    if (!connection.length) {
      return NextResponse.json({
        success: true,
        connected: false,
        profile: null,
      });
    }

    const whatsapp = connection[0];

    if (
      whatsapp.tokenExpiresAt &&
      new Date(whatsapp.tokenExpiresAt).getTime() <= Date.now()
    ) {
      return NextResponse.json({
        success: true,
        connected: false,
        expired: true,
        profile: null,
      });
    }

    if (whatsapp.status !== 'active') {
      return NextResponse.json({
        success: true,
        connected: false,
        expired: whatsapp.status === 'expired',
        profile: null,
      });
    }

    return NextResponse.json({
      success: true,
      connected: true,
      profile: {
        wabaId: whatsapp.wabaId,
        phoneNumberId: whatsapp.phoneNumberId,
        phoneNumber: whatsapp.businessPhoneNumber,
        businessName: whatsapp.businessName,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 401 }
      );
    }

    console.error('WhatsApp status error:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to check WhatsApp connection',
      },
      { status: 500 }
    );
  }
}