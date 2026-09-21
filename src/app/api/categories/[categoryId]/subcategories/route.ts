import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { subcategories } from '@/db/schema';
import { asc, eq } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  try {
    const { categoryId: categoryIdParam } = await params;
    const categoryId = parseInt(categoryIdParam, 10);

    if (Number.isNaN(categoryId)) {
      return NextResponse.json(
        { success: false, message: 'Invalid categoryId' },
        { status: 400 }
      );
    }

    const rows = await db
      .select()
      .from(subcategories)
      .where(eq(subcategories.categoryId, categoryId))
      .orderBy(asc(subcategories.sortOrder));

    return NextResponse.json({ success: true, subcategories: rows });
  } catch (error: any) {
    console.error('LIST SUBCATEGORIES ERROR:', error);
    return NextResponse.json(
      { success: false, message: error?.message || 'Failed to fetch subcategories' },
      { status: 500 }
    );
  }
}