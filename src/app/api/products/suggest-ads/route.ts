// app/api/products/suggest-ads/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

import { db } from '@/db';
import { products, adSuggestions } from '@/db/schema';
import { eq } from 'drizzle-orm';

const GEMINI_TEXT_MODEL = 'gemini-3.7-flash';
const SUGGESTION_COUNT = 6;

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

function safeParseArray(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { success: false, message: 'GEMINI_API_KEY is not configured' },
        { status: 500 }
      );
    }

    const body = await req.json();

    // products.id / adSuggestions.productId are int -> coerce to number
    const rawProductId = body?.productId;
    const productId = Number(rawProductId);

    if (!rawProductId || Number.isNaN(productId)) {
      return NextResponse.json({ success: false, message: 'productId is required' }, { status: 400 });
    }

    const rows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!rows.length) {
      return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    }
    const product = rows[0];

    const features = safeParseArray(product.features);
    const keywords = safeParseArray(product.keywords);

    /*
    |------------------------------------------------------------------
    | Ask Gemini for creative concepts specific to this product
    |------------------------------------------------------------------
    */

    const prompt = `
You are an advertising creative director.

Based on this product/business, propose ${SUGGESTION_COUNT} distinct ad creative concepts a small business owner could pick from.

PRODUCT DATA:
Name: ${product.title || 'unknown'}
Brand: ${product.brand || 'none visible'}
Category: ${product.category || 'unknown'}
Subcategory: ${product.subcategory || 'unknown'}
Color: ${product.color || 'unknown'}
Description: ${product.description || 'none'}
Features: ${features.join(', ') || 'none'}
Keywords: ${keywords.join(', ') || 'none'}

RULES:
1. Each concept must be genuinely different in style/purpose (mix of: premium/luxury, festival/seasonal, discount/offer, social-media-first, lifestyle, vertical story/reel).
2. "title" is a short label (max 6 words) SPECIFIC to this product/business — not a generic category name.
3. "promptModifier" is a detailed image-generation instruction (background, lighting, mood, layout) an image model will use directly. Do not mention price/discount/logo — those are added separately later.
4. "aspectRatio" is one of "1:1", "9:16", "16:9" — use "9:16" for story/reel concepts, "16:9" for YouTube-style, else "1:1".
5. "requiresOffer" is true only if the concept is fundamentally about a discount/sale.
6. Return ONLY a JSON array, no markdown, no prose.

Format:
[
  { "title": "", "category": "", "promptModifier": "", "aspectRatio": "1:1", "requiresOffer": false }
]
`.trim();

    const response = await ai.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });

    const rawText = response.text?.trim() || '';
    if (!rawText) {
      throw new Error('Gemini returned an empty suggestions response');
    }

    let suggestions: any[];
    try {
      suggestions = JSON.parse(rawText);
    } catch {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      suggestions = JSON.parse(cleaned);
    }

    if (!Array.isArray(suggestions) || !suggestions.length) {
      throw new Error('Gemini returned no usable suggestions');
    }

    /*
    |------------------------------------------------------------------
    | Save each concept, scoped to this product
    | (id is autoincrement -> don't pass it, read it back from insertId)
    |------------------------------------------------------------------
    */

    const saved = [];

    for (const s of suggestions) {
      const insertResult: any = await db.insert(adSuggestions).values({
        productId,
        title: s.title || 'Untitled concept',
        category: s.category || 'general',
        aspectRatio: s.aspectRatio || '1:1',
        promptModifier: s.promptModifier || '',
        requiresOffer: !!s.requiresOffer,
      });

      // mysql2 driver returns insertId on the result header
      const insertedId =
        insertResult?.[0]?.insertId ?? insertResult?.insertId;

      saved.push({
        id: insertedId,
        title: s.title || 'Untitled concept',
        category: s.category || 'general',
        aspectRatio: s.aspectRatio || '1:1',
        requiresOffer: !!s.requiresOffer,
      });
    }

    return NextResponse.json({ success: true, suggestions: saved });
  } catch (error: any) {
    console.error('SUGGEST ADS ERROR:', error);

    return NextResponse.json(
      { success: false, message: error?.message || 'Failed to generate ad suggestions' },
      { status: 500 }
    );
  }
}