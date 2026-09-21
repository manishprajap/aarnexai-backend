import crypto from 'crypto';

const SESSION_SECRET = process.env.WHATSAPP_SESSION_SECRET;

if (!SESSION_SECRET) {
  throw new Error('WHATSAPP_SESSION_SECRET is missing');
}

interface SessionPayload {
  userId: string;
  bannerId: number;
  exp: number;
}

function base64UrlDecode(value: string): string {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const padding =
    normalized.length % 4 === 0
      ? ''
      : '='.repeat(4 - (normalized.length % 4));

  return Buffer.from(
    normalized + padding,
    'base64'
  ).toString('utf8');
}

function createSignature(payload: string): string {
  return crypto
    .createHmac(
      'sha256',
      SESSION_SECRET as string
    )
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function verifyWhatsAppSession(
  sessionId: string
): SessionPayload {
  const parts = sessionId.split('.');

  if (parts.length !== 2) {
    throw new Error('Invalid WhatsApp session');
  }

  const [
    encodedPayload,
    providedSignature,
  ] = parts;

  const expectedSignature =
    createSignature(encodedPayload);

  const providedBuffer =
    Buffer.from(providedSignature);

  const expectedBuffer =
    Buffer.from(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(
      providedBuffer,
      expectedBuffer
    )
  ) {
    throw new Error('Invalid WhatsApp session signature');
  }

  const payload = JSON.parse(
    base64UrlDecode(encodedPayload)
  ) as SessionPayload;

  if (
    !payload.userId ||
    !payload.bannerId ||
    !payload.exp
  ) {
    throw new Error('Invalid WhatsApp session payload');
  }

  if (Date.now() > payload.exp) {
    throw new Error(
      'WhatsApp connection session expired'
    );
  }

  return payload;
}