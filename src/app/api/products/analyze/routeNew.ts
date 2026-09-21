// app/api/products/analyze/route.ts

import { NextRequest, NextResponse } from 'next/server';

import OpenAI from 'openai';

import { db } from '@/db';
import { products } from '@/db/schema';

import { eq } from 'drizzle-orm';

import fs from 'fs/promises';
import path from 'path';

/*
|--------------------------------------------------------------------------
| OpenAI
|--------------------------------------------------------------------------
*/

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/*
|--------------------------------------------------------------------------
| POST /api/products/analyze
|--------------------------------------------------------------------------
*/

export async function POST(
  req: NextRequest
) {
  let productId: number | undefined;

  try {
    /*
    |--------------------------------------------------------------------------
    | Check API key
    |--------------------------------------------------------------------------
    */

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          message:
            'OPENAI_API_KEY is not configured',
        },
        {
          status: 500,
        }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Request body
    |--------------------------------------------------------------------------
    */

    const body = await req.json();

    // products.id is int autoincrement -> coerce to number
    const rawProductId = body.productId;
    productId = Number(rawProductId);

    if (!rawProductId || Number.isNaN(productId)) {
      return NextResponse.json(
        {
          success: false,
          message: 'productId is required',
        },
        {
          status: 400,
        }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Get product
    |--------------------------------------------------------------------------
    */

    const result = await db
      .select()
      .from(products)
      .where(
        eq(products.id, productId)
      )
      .limit(1);

    if (!result.length) {
      return NextResponse.json(
        {
          success: false,
          message: 'Product not found',
        },
        {
          status: 404,
        }
      );
    }

    const product = result[0];

    /*
    |--------------------------------------------------------------------------
    | Image check
    |--------------------------------------------------------------------------
    */

    if (!product.originalImageUrl) {
      return NextResponse.json(
        {
          success: false,
          message:
            'Product image not found',
        },
        {
          status: 400,
        }
      );
    }

    console.log(
      'PRODUCT:',
      product
    );

    /*
    |--------------------------------------------------------------------------
    | Convert public URL to local file
    |--------------------------------------------------------------------------
    */

    const relativeImagePath =
      product.originalImageUrl
        .replace(/^\/+/, '');

    const imagePath = path.join(
      process.cwd(),
      'public',
      relativeImagePath
    );

    console.log(
      'LOCAL IMAGE PATH:',
      imagePath
    );

    /*
    |--------------------------------------------------------------------------
    | Check file exists
    |--------------------------------------------------------------------------
    */

    try {
      await fs.access(imagePath);
    } catch {
      return NextResponse.json(
        {
          success: false,
          message:
            'Uploaded image file does not exist',
          imagePath,
        },
        {
          status: 404,
        }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Read image
    |--------------------------------------------------------------------------
    */

    const imageBuffer =
      await fs.readFile(imagePath);

    /*
    |--------------------------------------------------------------------------
    | Detect MIME type
    |--------------------------------------------------------------------------
    */

    let mimeType = 'image/jpeg';

    const extension =
      path.extname(imagePath)
        .toLowerCase();

    if (extension === '.png') {
      mimeType = 'image/png';
    }

    if (extension === '.webp') {
      mimeType = 'image/webp';
    }

    /*
    |--------------------------------------------------------------------------
    | Convert image to Base64
    |--------------------------------------------------------------------------
    */

    const base64Image =
      imageBuffer.toString('base64');

    const dataUrl =
      `data:${mimeType};base64,${base64Image}`;

    console.log(
      'IMAGE MIME:',
      mimeType
    );

    console.log(
      'IMAGE SIZE:',
      imageBuffer.length
    );

    /*
    |--------------------------------------------------------------------------
    | Set processing
    |--------------------------------------------------------------------------
    */

    await db
      .update(products)
      .set({
        status: 'processing',
      })
      .where(
        eq(products.id, productId)
      );

    /*
    |--------------------------------------------------------------------------
    | OpenAI Vision
    |--------------------------------------------------------------------------
    */

    const response =
      await openai.responses.create({
        model: 'gpt-4.1-mini',

        input: [
          {
            role: 'user',

            content: [
              {
                type: 'input_text',

                text: `
You are an expert product identification and marketing assistant.

Analyze the uploaded product image carefully.

Your job is to identify ONLY information that is visible in the image or can be reasonably inferred from the visual appearance.

IMPORTANT RULES:

1. Do NOT invent a brand.
2. If the brand name/logo is not visible, return null.
3. Do NOT invent an exact price.
4. If a price is visible in the image, return it.
5. If price is not visible, return null.
6. Read visible text carefully.
7. Identify product category and subcategory.
8. Identify visible product color.
9. Extract useful product features from the image.
10. Create marketing-friendly content based on the visible product.
11. Do not claim specifications that cannot reasonably be determined from the image.
12. confidence must be a number from 0 to 100.

Return ONLY valid JSON.

Use exactly this structure:

{
  "productName": "",
  "brand": null,
  "companyName": null,
  "price": null,
  "category": "",
  "subcategory": "",
  "color": "",
  "features": [],
  "description": "",
  "marketingTitle": "",
  "metaDescription": "",
  "keywords": [],
  "hashtags": [],
  "visibleText": [],
  "confidence": 0
}
`,
              },

              {
                type: 'input_image',

                image_url: dataUrl,

                detail: 'high',
              },
            ],
          },
        ],
      });

    /*
    |--------------------------------------------------------------------------
    | Get AI response
    |--------------------------------------------------------------------------
    */

    const rawText =
      response.output_text?.trim() || '';

    console.log(
      'OPENAI RESPONSE:',
      rawText
    );

    if (!rawText) {
      throw new Error(
        'OpenAI returned an empty response'
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Parse JSON
    |--------------------------------------------------------------------------
    */

    let aiData: any;

    try {
      aiData = JSON.parse(rawText);
    } catch (parseError) {
      console.error(
        'JSON PARSE ERROR:',
        parseError
      );

      /*
      |--------------------------------------------------------------------------
      | Try removing markdown JSON block
      |--------------------------------------------------------------------------
      */

      const cleanedText =
        rawText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();

      try {
        aiData =
          JSON.parse(cleanedText);
      } catch {
        await db
          .update(products)
          .set({
            status: 'failed',
          })
          .where(
            eq(products.id, productId)
          );

        return NextResponse.json(
          {
            success: false,
            message:
              'AI returned invalid JSON',
            rawResponse: rawText,
          },
          {
            status: 500,
          }
        );
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Normalize AI data
    |--------------------------------------------------------------------------
    */

    const productName =
      aiData.productName ||
      null;

    const brand =
      aiData.brand || null;

    const companyName =
      aiData.companyName ||
      null;

    const price =
      aiData.price || null;

    const category =
      aiData.category ||
      null;

    const subcategory =
      aiData.subcategory ||
      null;

    const color =
      aiData.color ||
      null;

    const features =
      Array.isArray(aiData.features)
        ? aiData.features
        : [];

    const description =
      aiData.description ||
      null;

    const marketingTitle =
      aiData.marketingTitle ||
      null;

    const metaDescription =
      aiData.metaDescription ||
      null;

    const keywords =
      Array.isArray(aiData.keywords)
        ? aiData.keywords
        : [];

    const hashtags =
      Array.isArray(aiData.hashtags)
        ? aiData.hashtags
        : [];

    const visibleText =
      Array.isArray(aiData.visibleText)
        ? aiData.visibleText
        : [];

    let confidence =
      Number(aiData.confidence);

    if (
      Number.isNaN(confidence)
    ) {
      confidence = 0;
    }

    confidence = Math.max(
      0,
      Math.min(
        100,
        Math.round(confidence)
      )
    );

    /*
    |--------------------------------------------------------------------------
    | Save AI result into MySQL
    |--------------------------------------------------------------------------
    */

    await db
      .update(products)
      .set({
        title: productName,

        brand,

        companyName,

        price,

        category,

        subcategory,

        color,

        description,

        features:
          JSON.stringify(features),

        keywords:
          JSON.stringify(keywords),

        hashtags:
          JSON.stringify(hashtags),

        visibleText:
          JSON.stringify(visibleText),

        metaDescription,

        confidence,

        status: 'done',
      })
      .where(
        eq(products.id, productId)
      );

    /*
    |--------------------------------------------------------------------------
    | Final response
    |--------------------------------------------------------------------------
    */

    return NextResponse.json({
      success: true,

      message:
        'Product analyzed successfully',

      productId,

      status: 'done',

      product: {
        productName,

        brand,

        companyName,

        price,

        category,

        subcategory,

        color,

        features,

        description,

        marketingTitle,

        metaDescription,

        keywords,

        hashtags,

        visibleText,

        confidence,
      },
    });
  } catch (error: any) {
    console.error(
      'PRODUCT ANALYSIS ERROR:',
      error
    );

    /*
    |--------------------------------------------------------------------------
    | Mark failed
    |--------------------------------------------------------------------------
    */

    if (productId) {
      try {
        await db
          .update(products)
          .set({
            status: 'failed',
          })
          .where(
            eq(products.id, productId)
          );
      } catch (dbError) {
        console.error(
          'FAILED STATUS UPDATE:',
          dbError
        );
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Error response
    |--------------------------------------------------------------------------
    */

    return NextResponse.json(
      {
        success: false,

        message:
          error?.message ||
          'Product analysis failed',
      },
      {
        status: 500,
      }
    );
  }
}