// src/app/api/whatsapp/contacts/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';

import { db } from '@/db';
import { whatsappContacts } from '@/db/schema';
import {
  getUserIdFromRequest,
  AuthError,
} from '@/lib/auth';

// Keep only digits — WhatsApp Cloud API expects E.164
// without a leading '+', e.g. 91XXXXXXXXXX
function normalizePhone(raw: string): string {
  return String(raw).replace(/\D/g, '');
}

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);

    const contacts = await db
      .select()
      .from(whatsappContacts)
      .where(eq(whatsappContacts.userId, userId));

    return NextResponse.json({
      success: true,
      contacts,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 401 }
      );
    }

    console.error('WhatsApp contacts GET error:', error);

    return NextResponse.json(
      { success: false, message: 'Failed to load contacts' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);

    const body = await req.json().catch(() => ({}));

    // Accept either a single contact or a bulk array:
    // { name, phoneNumber } OR { contacts: [{ name, phoneNumber }, ...] }
    const incoming: { name?: string; phoneNumber: string }[] =
      Array.isArray(body?.contacts)
        ? body.contacts
        : body?.phoneNumber
        ? [{ name: body.name, phoneNumber: body.phoneNumber }]
        : [];

    if (incoming.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'phoneNumber (or contacts[]) is required',
        },
        { status: 400 }
      );
    }

    const rows = incoming
      .map((c) => ({
        userId,
        name: c.name?.trim() || null,
        phoneNumber: normalizePhone(c.phoneNumber),
      }))
      .filter((c) => c.phoneNumber.length >= 8);

    if (rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'No valid phone numbers provided',
        },
        { status: 400 }
      );
    }

    // Insert, ignoring duplicates (userId + phoneNumber is unique).
    for (const row of rows) {
      try {
        await db.insert(whatsappContacts).values(row);
      } catch (err) {
        console.log(
          'Skipping duplicate/invalid contact:',
          row.phoneNumber
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: `${rows.length} contact(s) processed`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 401 }
      );
    }

    console.error('WhatsApp contacts POST error:', error);

    return NextResponse.json(
      { success: false, message: 'Failed to save contacts' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);

    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));

    if (!id) {
      return NextResponse.json(
        { success: false, message: 'id is required' },
        { status: 400 }
      );
    }

    await db
      .delete(whatsappContacts)
      .where(
        and(
          eq(whatsappContacts.id, id),
          eq(whatsappContacts.userId, userId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 401 }
      );
    }

    console.error('WhatsApp contacts DELETE error:', error);

    return NextResponse.json(
      { success: false, message: 'Failed to delete contact' },
      { status: 500 }
    );
  }
}