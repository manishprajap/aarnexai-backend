import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { socialAccounts } from '@/db/schema';
import { AuthError, getUserIdFromRequest } from '@/lib/auth';

function validDate(value: string | null, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get('propertyId')?.replace(/^properties\//, '');

    if (!propertyId || !/^\d+$/.test(propertyId)) {
      return NextResponse.json(
        { success: false, message: 'A numeric Google Analytics 4 propertyId is required' },
        { status: 400 }
      );
    }

    const endDate = validDate(searchParams.get('endDate'), 'today');
    const startDate = validDate(searchParams.get('startDate'), '30daysAgo');
    const [account] = await db
      .select({ accessToken: socialAccounts.accessToken })
      .from(socialAccounts)
      .where(
        and(eq(socialAccounts.userId, userId), eq(socialAccounts.provider, 'google_analytics'))
      )
      .limit(1);

    if (!account?.accessToken) {
      return NextResponse.json(
        { success: false, message: 'Google Analytics is not connected' },
        { status: 404 }
      );
    }

    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'date' }],
          metrics: [
            { name: 'activeUsers' },
            { name: 'sessions' },
            { name: 'eventCount' },
            { name: 'screenPageViews' },
          ],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        }),
        cache: 'no-store',
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error('[Google Analytics Report] Provider error:', response.status, data);
      return NextResponse.json(
        { success: false, message: 'Unable to fetch Google Analytics data', details: data },
        { status: response.status === 401 ? 401 : 502 }
      );
    }

    return NextResponse.json({ success: true, propertyId, data });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 401 });
    }

    console.error('[Google Analytics Report] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch Google Analytics data' },
      { status: 500 }
    );
  }
}
