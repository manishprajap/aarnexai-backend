// app/api/products/[productId]/suggestions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { adSuggestions } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId: rawProductId } = await params;

    // adSuggestions.productId is int -> coerce the route param
    const productId = Number(rawProductId);

    if (!rawProductId || Number.isNaN(productId)) {
      return NextResponse.json(
        { success: false, message: 'productId is required' },
        { status: 400 }
      );
    }

    const rows = await db
      .select()
      .from(adSuggestions)
      .where(eq(adSuggestions.productId, productId))
      .orderBy(desc(adSuggestions.createdAt));

    return NextResponse.json({ success: true, suggestions: rows });
  } catch (error) {
    console.error('LIST SUGGESTIONS ERROR:', error);

    return NextResponse.json(
      { success: false, message: 'Failed to load suggestions' },
      { status: 500 }
    );
  }
}