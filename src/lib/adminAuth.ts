import crypto from 'crypto';

/*
|--------------------------------------------------------------------------
| Admin session token
|--------------------------------------------------------------------------
|
| Next.js 16's proxy.ts runs on the Node.js runtime, so Node's built-in
| 'crypto' module works here — no Web Crypto workaround needed.
|
| Token shape: base64("<email>.<expiryTimestamp>").<hmacSignatureHex>
|
*/

const SESSION_COOKIE_NAME = 'ai_ads_admin_session';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET is not set');
  }

  return secret;
}

export function createSessionToken(email: string): string {
  const expiry = Date.now() + SESSION_DURATION_MS;

  const payload = Buffer.from(`${email}.${expiry}`).toString('base64');

  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex');

  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) {
    return false;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex');

  const signatureValid =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!signatureValid) {
    return false;
  }

  try {
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');

    const [, expiryStr] = decoded.split('.');

    const expiry = parseInt(expiryStr, 10);

    return Date.now() < expiry;
  } catch {
    return false;
  }
}

export { SESSION_COOKIE_NAME };