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
| POST /api/upload
|--------------------------------------------------------------------------
*/

export async function POST(req: NextRequest) {
  let savedFilePath: string | null = null;
  const origin = req.headers.get('origin');

  try {
    const formData = await req.formData();

    /*
    |--------------------------------------------------------------------------
    | Read FormData
    |--------------------------------------------------------------------------
    */

    const file = formData.get('image');

    const userIdRaw = formData.get('userId');
    const categoryIdRaw = formData.get('categoryId');
    const subcategoryIdRaw = formData.get('subcategoryId');
    const childCategoryIdRaw = formData.get('childCategoryId');

    const promptRaw = formData.get('promptDescription');
    const promptTypeRaw = formData.get('promptType');
    const bannerColorRaw = formData.get('bannerColor');

    /*
    |--------------------------------------------------------------------------
    | Validate image
    |--------------------------------------------------------------------------
    */

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Product image is required',
        },
        { status: 400 ,headers: corsHeaders(origin) }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Validate user
    |--------------------------------------------------------------------------
    */

    const userIdString = String(userIdRaw || '').trim();

    if (!userIdString) {
      return NextResponse.json(
        {
          success: false,
          message: 'User ID is required',
        },
        { status: 400 ,headers: corsHeaders(origin) }
      );
    }

    const userId = Number(userIdString);

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'User ID must be a valid number',
        },
        { status: 400 , headers: corsHeaders(origin)}
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Validate category
    |--------------------------------------------------------------------------
    */

    const categoryIdString = String(categoryIdRaw || '').trim();

    if (!categoryIdString) {
      return NextResponse.json(
        {
          success: false,
          message: 'Category ID is required',
        },
        { status: 400 ,headers: corsHeaders(origin)}
      );
    }

    const categoryId = Number(categoryIdString);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'Category ID must be a valid number',
        },
        { status: 400 , headers: corsHeaders(origin) }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Subcategory - optional
    |--------------------------------------------------------------------------
    */

    let subcategoryId: number | null = null;

    const subcategoryIdString = String(subcategoryIdRaw || '').trim();

    if (subcategoryIdString) {
      const parsedSubcategoryId = Number(subcategoryIdString);

      if (!Number.isInteger(parsedSubcategoryId) || parsedSubcategoryId <= 0) {
        return NextResponse.json(
          {
            success: false,
            message: 'Subcategory ID must be a valid number',
          },
          { status: 400 , headers: corsHeaders(origin) }
        );
      }

      subcategoryId = parsedSubcategoryId;
    }

    /*
    |--------------------------------------------------------------------------
    | Child Category - optional
    |--------------------------------------------------------------------------
    */

    let childCategoryId: number | null = null;

    const childCategoryIdString = String(childCategoryIdRaw || '').trim();

    if (childCategoryIdString) {
      const parsedChildCategoryId = Number(childCategoryIdString);

      if (!Number.isInteger(parsedChildCategoryId) || parsedChildCategoryId <= 0) {
        return NextResponse.json(
          {
            success: false,
            message: 'Child Category ID must be a valid number',
          },
          { status: 400, headers: corsHeaders(origin)}
        );
      }

      childCategoryId = parsedChildCategoryId;
    }

    /*
    |--------------------------------------------------------------------------
    | Prompt / Prompt type / Banner color
    |--------------------------------------------------------------------------
    */

    const prompt =
      typeof promptRaw === 'string' ? promptRaw.trim() || null : null;

    const promptType =
      typeof promptTypeRaw === 'string' ? promptTypeRaw.trim() || null : null;

    const bannerColor =
      typeof bannerColorRaw === 'string' ? bannerColorRaw.trim() || null : null;

    /*
    |--------------------------------------------------------------------------
    | Validate image MIME type
    |--------------------------------------------------------------------------
    */

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Only JPG, PNG and WEBP images are allowed',
        },
        { status: 400,headers: corsHeaders(origin) }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Validate image size
    |--------------------------------------------------------------------------
    */

    const MAX_FILE_SIZE = 10 * 1024 * 1024;

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          message: 'Image size must be less than 10MB',
        },
        { status: 400,headers: corsHeaders(origin) }
      );
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
      { status: 201,headers: corsHeaders(origin) }
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
      { status: 500,headers: corsHeaders(origin) }
    );
  }
}