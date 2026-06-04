/**
 * lib/crypto.ts
 *
 * AES-256-GCM encryption/decryption for sensitive values stored at rest (e.g., API keys).
 *
 * Stored format: "enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 *
 * Usage:
 *   import { encryptApiKey, decryptApiKey } from '../lib/crypto';
 *
 *   // On save:
 *   const encrypted = encryptApiKey(rawKey);
 *   await prisma.aiProvider.update({ data: { apiKey: encrypted } });
 *
 *   // On use:
 *   const key = decryptApiKey(provider.apiKey);
 */

import crypto from 'crypto';

function deriveKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    console.warn(
      '[Security] API_KEY_ENCRYPTION_SECRET is not set. ' +
      'API keys are stored unencrypted. Set this env var in production.'
    );
    return Buffer.alloc(32); // fallback zero-key (unencrypted mode)
  }
  return crypto.scryptSync(secret, 'chromacraft-salt-v1', 32);
}

/**
 * Encrypt a plaintext API key for storage.
 * Returns the plaintext unchanged if API_KEY_ENCRYPTION_SECRET is not set.
 */
export function encryptApiKey(plaintext: string): string {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) return plaintext; // unencrypted mode

  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a stored API key.
 * Handles both encrypted ("enc:...") and legacy plain-text formats transparently.
 */
export function decryptApiKey(stored: string): string {
  if (!stored.startsWith('enc:')) {
    // Legacy plain-text key — return as-is
    return stored;
  }

  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error('API_KEY_ENCRYPTION_SECRET must be set to decrypt stored API keys');
  }

  const payload = stored.slice(4); // remove "enc:" prefix
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted key format');
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const key = deriveKey();

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return decipher.update(cipherHex, 'hex', 'utf8') + decipher.final('utf8');
  } catch {
    throw new Error('API key decryption failed — possible key rotation or data corruption');
  }
}
