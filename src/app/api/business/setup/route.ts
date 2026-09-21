import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { db } from '@/db';
import { users, categories } from '@/db/schema';
import { verifyToken } from '@/lib/auth';
import { corsHeaders } from '@/lib/cors';

export const runtime = 'nodejs';

// Root-level "upload" folder (project_root/upload), not under public/.
const UPLOAD_DIR = path.join(process.cwd(), 'upload');

const MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024; // keep in sync with frontend's MAX_LOGO_SIZE_MB

// mime type -> safe file extension (we don't trust the uploaded file name)
const ALLOWED_LOGO_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export async function OPTIONS(req: NextRequest) {
  return NextResponse.json({}, { headers: corsHeaders(req.headers.get('origin')) });
}

function getAuthPayload(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.replace('Bearer ', '');
  const token = bearer || req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

// "12" | 12 -> 12, anything else (null, "", "abc", 0, -1, 1.5) -> null
function toId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(req: NextRequest) {
  try {
    const payload = getAuthPayload(req);
    if (!payload) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // --------------------------------------------------
    // Read body: supports BOTH multipart/form-data and JSON
    // --------------------------------------------------
    const contentType = req.headers.get('content-type') || '';

    let name = '';
    let category = ''; // category NAME (kept for older code that reads users.category)
    let categoryId: number | null = null; // main business category id
    let city = '';
    let website = '';
    let language = '';
    let logo: FormDataEntryValue | null = null;

    if (contentType.includes('application/json')) {
      const body = await req.json();
      name = String(body?.name || '').trim();
      category = String(body?.category || '').trim();
      categoryId = toId(body?.categoryId);
      city = String(body?.city || '').trim();
      website = String(body?.website || '').trim();
      language = String(body?.language || '').trim();
      // JSON can't carry a file, so logo stays null
    } else {
      const formData = await req.formData();
      name = String(formData.get('name') || '').trim();
      category = String(formData.get('category') || '').trim();
      categoryId = toId(formData.get('categoryId'));
      city = String(formData.get('city') || '').trim();
      website = String(formData.get('website') || '').trim();
      language = String(formData.get('language') || '').trim();
      logo = formData.get('logo');
    }

    // Subcategory / child category are NOT saved here anymore —
    // the user picks them per product on the Upload page.
    if (!name || !categoryId || !city) {
      return NextResponse.json(
        { error: 'Business name, category and city are required' },
        { status: 400 }
      );
    }

    // Make sure the category really exists and take the NAME from the DB
    // instead of trusting whatever the client sent.
    const [cat] = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);

    if (!cat) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }

    category = cat.name;

    const updateData: Partial<typeof users.$inferInsert> = {
      name,
      category,
      categoryId: cat.id,
      city,
      website,
      language,
    };

    // --------------------------------------------------
    // Logo is OPTIONAL — only processed when a real file is sent
    // --------------------------------------------------
    if (logo instanceof File && logo.size > 0) {
      const extension = ALLOWED_LOGO_TYPES[logo.type];

      if (!extension) {
        return NextResponse.json(
          { error: 'Logo must be a JPG, PNG, WEBP or GIF image' },
          { status: 400 }
        );
      }

      if (logo.size > MAX_LOGO_SIZE_BYTES) {
        return NextResponse.json(
          { error: 'Logo must be under 5MB' },
          { status: 400 }
        );
      }

      const filename = `${payload.userId}-${randomUUID()}${extension}`;

      await mkdir(UPLOAD_DIR, { recursive: true });

      const buffer = Buffer.from(await logo.arrayBuffer());
      await writeFile(path.join(UPLOAD_DIR, filename), buffer);

      // Save the filename in DB (requires a `logo` column in users table)
      updateData.logo = filename;
    }

    await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, payload.userId));

    const [updatedUser] = await db
      .select({
        id: users.id,
        name: users.name,
        mobile: users.mobile,
        email: users.email,
        plan: users.plan,
        credits: users.credits,
        category: users.category,
        categoryId: users.categoryId,
        city: users.city,
        website: users.website,
        language: users.language,
        logo: users.logo,
      })
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);

    return NextResponse.json({ user: updatedUser });
  } catch (err) {
    console.error('Business setup error:', err);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}