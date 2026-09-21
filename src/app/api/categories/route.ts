import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { categories } from '@/db/schema';
import { asc } from 'drizzle-orm';

/*
|--------------------------------------------------------------------------
| GET /api/categories
|--------------------------------------------------------------------------
*/

export async function GET() {
  try {
    const allCategories = await db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder));

    return NextResponse.json({ success: true, categories: allCategories });
  } catch (error: any) {
    console.error('LIST CATEGORIES ERROR:', error);

    return NextResponse.json(
      { success: false, message: error?.message || 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}

/*
|--------------------------------------------------------------------------
| POST /api/categories
|--------------------------------------------------------------------------
*/

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { name, icon, sortOrder } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { success: false, message: 'Category name is required' },
        { status: 400 }
      );
    }

    // id is auto-increment now — MySQL assigns it, we don't generate it.
    const [result] = await db.insert(categories).values({
      name: name.trim(),
      icon: icon || null,
      sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
      isActive: true,
    });

    const newId = result.insertId;

    return NextResponse.json({
      success: true,
      id: newId,
      category: {
        id: newId,
        name: name.trim(),
        icon: icon || null,
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
        isActive: true,
      },
    });
  } catch (error: any) {
    console.error('CREATE CATEGORY ERROR:', error);

    return NextResponse.json(
      { success: false, message: error?.message || 'Failed to create category' },
      { status: 500 }
    );
  }
}