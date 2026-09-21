import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';

import { db } from '@/db';
import { socialAccounts } from '@/db/schema';
import { AuthError, getUserIdFromRequest } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const userId = getUserIdFromRequest(req);
    const [connection] = await db
      .select({
        accountName: socialAccounts.accountName,
        providerAccountId: socialAccounts.providerAccountId,
      })
      .from(socialAccounts)
      .where(
        and(eq(socialAccounts.userId, userId), eq(socialAccounts.provider, 'google_business'))
      )
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

    console.error('[Google Business Status] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to check Google Business connection' },
      { status: 500 }
    );
  }
}