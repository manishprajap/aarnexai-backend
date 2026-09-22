import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { socialAccounts } from '@/db/schema';
import { AuthError, getUserIdFromRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    const [connection] = await db
      .select({
        accountName: socialAccounts.accountName,
        providerAccountId: socialAccounts.providerAccountId,
        expiresAt: socialAccounts.expiresAt,
      })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.userId, userId), eq(socialAccounts.provider, 'youtube')))
      .limit(1);

    return NextResponse.json({
      success: true,
      connected: Boolean(connection),
      connection: connection || null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    console.error('[YouTube Status] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to check YouTube connection' },
      { status: 500 }
    );
  }
}
