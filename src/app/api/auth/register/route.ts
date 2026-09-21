import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { hashPassword, signToken } from '@/lib/auth';
import { corsHeaders } from '@/lib/cors';

export const runtime = 'nodejs';
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email')
    .optional()
    .or(z.literal('')),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 ,headers: corsHeaders()}
      );
    }

    const { name, mobile, password } = parsed.data;
    const email = parsed.data.email ? parsed.data.email : null;

    const duplicateCheck = email
      ? or(eq(users.mobile, mobile), eq(users.email, email))
      : eq(users.mobile, mobile);

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(duplicateCheck)
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'An account with this mobile number or email already exists.' },
        { status: 409 , headers: corsHeaders()}
      );
    }

    const passwordHash = await hashPassword(password);

    const [result] = await db.insert(users).values({
      name,
      mobile,
      email,
      password: passwordHash,
    });

    const insertId = (result as { insertId: number }).insertId;

    const token = signToken({ userId: insertId });

    const response = NextResponse.json(
      {
        user: {
          id: insertId,
          name,
          mobile,
          email,
          plan: 'free',
          credits: 2,
        },
        
        token,
      },
      { status: 201 , headers: corsHeaders()}
    );

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (err) {
    console.error('Register error:', err);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500, headers: corsHeaders() }
    );
  }
}