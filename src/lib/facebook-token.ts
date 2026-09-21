import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const value =
    process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY;

  if (!value) {
    throw new Error(
      'FACEBOOK_TOKEN_ENCRYPTION_KEY is missing'
    );
  }

  const key = Buffer.from(value, 'base64');

  if (key.length !== 32) {
    throw new Error(
      'FACEBOOK_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes'
    );
  }

  return key;
}

export function encryptFacebookToken(
  token: string
): string {
  const key = getEncryptionKey();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    ALGORITHM,
    key,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);

  const authTag =
    cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptFacebookToken(
  value: string
): string {
  const key = getEncryptionKey();

  const parts = value.split('.');

  if (parts.length !== 3) {
    throw new Error(
      'Invalid encrypted Facebook token'
    );
  }

  const [
    ivEncoded,
    authTagEncoded,
    encryptedEncoded,
  ] = parts;

  const iv = Buffer.from(
    ivEncoded,
    'base64url'
  );

  const authTag = Buffer.from(
    authTagEncoded,
    'base64url'
  );

  const encrypted = Buffer.from(
    encryptedEncoded,
    'base64url'
  );

  const decipher =
    crypto.createDecipheriv(
      ALGORITHM,
      key,
      iv
    );

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}