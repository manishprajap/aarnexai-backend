import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { adPresets } from '@/db/schema';
import { asc, eq } from 'drizzle-orm';

/*
|--------------------------------------------------------------------------
| GET /api/presets?group=style&categoryId=xxx
|--------------------------------------------------------------------------
*/

export async function GET(req: NextRequest) {
  try {
    const group = req.nextUrl.searchParams.get('group');
    const categoryIdParam = req.nextUrl.searchParams.get('categoryId');
    const categoryId = categoryIdParam ? parseInt(categoryIdParam, 10) : null;

    let rows = await db.select().from(adPresets).orderBy(asc(adPresets.sortOrder));

    if (group) {
      rows = rows.filter((p) => p.group === group);
    }

    if (categoryId !== null) {
      rows = rows.filter((p) => p.categoryId === categoryId || p.categoryId === null);
    }

    return NextResponse.json({ success: true, presets: rows });
  } catch (error: any) {
    console.error('LIST PRESETS ERROR:', error);

    return NextResponse.json(
      { success: false, message: error?.message || 'Failed to fetch presets' },
      { status: 500 }
    );
  }
}

/*
|--------------------------------------------------------------------------
| POST /api/presets
|--------------------------------------------------------------------------
*/

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      presetKey,
      name,
      group,
      categoryId,
      aspectRatio,
      promptModifier,
      requiresOffer,
      icon,
      sortOrder,
    } = body;

    if (!presetKey || !name || !group || !promptModifier) {
      return NextResponse.json(
        {
          success: false,
          message: 'presetKey, name, group and promptModifier are required',
        },
        { status: 400 }
      );
    }

    if (!['style', 'creative_type'].includes(group)) {
      return NextResponse.json(
        { success: false, message: "group must be 'style' or 'creative_type'" },
        { status: 400 }
      );
    }

    // categoryId comes in as a number (or is omitted/undefined for universal presets).
    const resolvedCategoryId =
      typeof categoryId === 'number'
        ? categoryId
        : categoryId
        ? parseInt(categoryId, 10)
        : null;

    // id is auto-increment now — MySQL assigns it, we don't generate it.
    const [result] = await db.insert(adPresets).values({
      presetKey,
      name,
      group,
      categoryId: resolvedCategoryId,
      aspectRatio: aspectRatio || '1:1',
      promptModifier,
      requiresOffer: !!requiresOffer,
      icon: icon || null,
      sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
      isActive: true,
    });

    const newId = result.insertId;

    return NextResponse.json({ success: true, id: newId });
  } catch (error: any) {
    console.error('CREATE PRESET ERROR:', error);

    return NextResponse.json(
      { success: false, message: error?.message || 'Failed to create preset' },
      { status: 500 }
    );
  }
}