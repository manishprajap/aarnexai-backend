// src/app/api/whatsapp/session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { getUserIdFromRequest, AuthError } from '@/lib/auth';

interface SessionPayload {
  userId: string;
  exp: number;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function POST(req: NextRequest) {
  try {
    const SESSION_SECRET = process.env.WHATSAPP_SESSION_SECRET;

    if (!SESSION_SECRET) {
      console.error('WHATSAPP_SESSION_SECRET is missing');

      return NextResponse.json(
        {
          success: false,
          message: 'WhatsApp session configuration is missing',
        },
        { status: 500 }
      );
    }

    const userId = getUserIdFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const callbackUrl = String(body?.callbackUrl || '');

    if (callbackUrl !== 'aarnamarket://whatsapp-callback') {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid WhatsApp callback URL',
        },
        { status: 400 }
      );
    }

    const payload: SessionPayload = {
      userId: String(userId),
      exp: Date.now() + 10 * 60 * 1000,
    };

    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = createSignature(encodedPayload, SESSION_SECRET);
    const sessionId = `${encodedPayload}.${signature}`;

    return NextResponse.json({
      success: true,
      sessionId,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 401 }
      );
    }

    console.error('WhatsApp session error:', error);

    return NextResponse.json(
      { success: false, message: 'Could not create WhatsApp session' },
      { status: 500 }
    );
  }
}