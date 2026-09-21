import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { products } from '@/db/schema';
import { createId } from '@paralleldrive/cuid2';

import fs from 'fs/promises';
import path from 'path';
import { corsHeaders } from '@/lib/cors';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return NextResponse.json({}, { headers: corsHeaders(req.headers.get('origin')) });
}

const UPLOAD_BASE_DIR =
  process.env.UPLOAD_DIR || '/var/www/aarnexai.com/aarnexai-backend/upload';

const UPLOAD_URL_PREFIX = '/upload';

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

type ParsedId = { value: number | null; error: string | null };

// Optional numeric id.
//   empty / missing  -> { value: null, error: null }
//   valid            -> { value: 12,   error: null }
//   invalid          -> { value: null, error: '<label> must be a valid number' }
function parseOptionalId(raw: FormDataEntryValue | null, label: string): ParsedId {
  const text = typeof raw === 'string' ? raw.trim() : '';

  if (!text) {
    return { value: null, error: null };
  }

  const n = Number(text);

  if (!Number.isInteger(n) || n <= 0) {
    return { value: null, error: `${label} must be a valid number` };
  }

  return { value: n, error: null };
}

const optionalText = (raw: FormDataEntryValue | null): string | null =>
  typeof raw === 'string' ? raw.trim() || null : null;

/*
|--------------------------------------------------------------------------
| POST /api/upload
|
| Step 1 of the flow: only saves the image and creates the product row.
| Category / subcategory / child category / aspect ratio / description are
| optional here — they are sent later to POST /api/products/analyze when
| the user taps "Generate Ad".
|--------------------------------------------------------------------------
*/

export async function POST(req: NextRequest) {
  let savedFilePath: string | null = null;
  const origin = req.headers.get('origin');

  const fail = (message: string, status = 400) =>
    NextResponse.json({ success: false, message }, { status, headers: corsHeaders(origin) });

  try {
    const formData = await req.formData();

    /*
    |--------------------------------------------------------------------------
    | Read FormData
    |--------------------------------------------------------------------------
    */

    const file = formData.get('image');
    const userIdRaw = formData.get('userId');

    /*
    |--------------------------------------------------------------------------
    | Validate image
    |--------------------------------------------------------------------------
    */

    if (!(file instanceof File)) {
      return fail('Product image is required');
    }

    /*
    |--------------------------------------------------------------------------
    | Validate user
    |--------------------------------------------------------------------------
    */

    const userIdString = String(userIdRaw || '').trim();

    if (!userIdString) {
      return fail('User ID is required');
    }

    const userId = Number(userIdString);

    if (!Number.isInteger(userId) || userId <= 0) {
      return fail('User ID must be a valid number');
    }

    /*
    |--------------------------------------------------------------------------
    | Optional fields (category ids, prompt, prompt type, banner color)
    |--------------------------------------------------------------------------
    */

    const category = parseOptionalId(formData.get('categoryId'), 'Category ID');
    if (category.error) return fail(category.error);

    const subcategory = parseOptionalId(formData.get('subcategoryId'), 'Subcategory ID');
    if (subcategory.error) return fail(subcategory.error);

    const childCategory = parseOptionalId(formData.get('childCategoryId'), 'Child Category ID');
    if (childCategory.error) return fail(childCategory.error);

    const categoryId = category.value;
    const subcategoryId = subcategory.value;
    const childCategoryId = childCategory.value;

    const prompt = optionalText(formData.get('promptDescription'));
    const promptType = optionalText(formData.get('promptType'));
    const bannerColor = optionalText(formData.get('bannerColor'));

    /*
    |--------------------------------------------------------------------------
    | Validate image MIME type
    |--------------------------------------------------------------------------
    */

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.type)) {
      return fail('Only JPG, PNG and WEBP images are allowed');
    }

    /*
    |--------------------------------------------------------------------------
    | Validate image size
    |--------------------------------------------------------------------------
    */

    const MAX_FILE_SIZE = 10 * 1024 * 1024;

    if (file.size > MAX_FILE_SIZE) {
      return fail('Image size must be less than 10MB');
    }

    /*
    |--------------------------------------------------------------------------
    | Upload directory — shared disk location, outside Next's "public"
    | folder, so files survive rebuilds/redeploys and are served
    | directly by Nginx.
    |--------------------------------------------------------------------------
    */

    const uploadDir = path.join(
      /*turbopackIgnore: true*/ UPLOAD_BASE_DIR,
      'products'
    );

    await fs.mkdir(uploadDir, { recursive: true });

    /*
    |--------------------------------------------------------------------------
    | Unique filename
    |--------------------------------------------------------------------------
    */

    const fileToken = createId();

    let extension = 'jpg';

    switch (file.type) {
      case 'image/png':
        extension = 'png';
        break;

      case 'image/webp':
        extension = 'webp';
        break;

      case 'image/jpeg':
        extension = 'jpg';
        break;
    }

    const fileName = `${fileToken}.${extension}`;

    const filePath = path.join(/*turbopackIgnore: true*/ uploadDir, fileName);

    /*
    |--------------------------------------------------------------------------
    | Save image
    |--------------------------------------------------------------------------
    */

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await fs.writeFile(filePath, buffer);

    savedFilePath = filePath;

    const imageUrl = `${UPLOAD_URL_PREFIX}/products/${fileName}`;

    /*
    |--------------------------------------------------------------------------
    | Database insert
    |--------------------------------------------------------------------------
    */

    const insertValues = {
      userId,
      categoryId,
      subcategoryId,
      childCategoryId,
      prompt,
      promptType,
      bannerColor,
      originalImageUrl: imageUrl,
      status: 'processing' as const,
    };

    console.log('PRODUCT INSERT:', insertValues);

    const result = await db.insert(products).values(insertValues);

    /*
    |--------------------------------------------------------------------------
    | Get inserted ID
    |--------------------------------------------------------------------------
    */

    const productId = result[0]?.insertId;

    if (!productId) {
      throw new Error('Product was inserted but insertId was not returned');
    }

    /*
    |--------------------------------------------------------------------------
    | Success
    |--------------------------------------------------------------------------
    */

    return NextResponse.json(
      {
        success: true,
        message: 'Product image uploaded successfully',

        productId: String(productId),

        imageUrl,

        userId,
        categoryId,
        subcategoryId,
        childCategoryId,

        promptType,
        promptDescription: prompt,
        bannerColor,

        status: 'processing',
      },
      { status: 201, headers: corsHeaders(origin) }
    );
  } catch (error: any) {
    console.error('========================================');
    console.error('UPLOAD API ERROR');
    console.error('========================================');
    console.error('Error message:', error?.message);
    console.error('Error code:', error?.code);
    console.error('Error errno:', error?.errno);
    console.error('Error sqlMessage:', error?.sqlMessage);
    console.error('Error sqlState:', error?.sqlState);
    console.error('Full error:', error);

    /*
    |--------------------------------------------------------------------------
    | Remove uploaded file if DB insert failed
    |--------------------------------------------------------------------------
    */

    if (savedFilePath) {
      try {
        await fs.unlink(savedFilePath);
        console.log('Removed uploaded file after failed DB insert:', savedFilePath);
      } catch (cleanupError) {
        console.error('FILE CLEANUP ERROR:', cleanupError);
      }
    }

    const isDevelopment = process.env.NODE_ENV !== 'production';

    return NextResponse.json(
      {
        success: false,

        message: isDevelopment
          ? error?.sqlMessage || error?.message || 'Failed to upload product image'
          : 'Failed to upload product image',

        ...(isDevelopment && {
          errorCode: error?.code || null,
          errno: error?.errno || null,
          sqlState: error?.sqlState || null,
        }),
      },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}