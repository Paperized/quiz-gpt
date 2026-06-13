/**
 * AES-256-GCM encryption for model API keys.
 * Encryption key comes from SETTINGS_ENCRYPTION_KEY env var.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function deriveKey(passphrase: string): Buffer {
  return createHash('sha256').update(passphrase).digest();
}

export function encryptValue(plaintext: string, passphrase: string): string {
  const key = deriveKey(passphrase);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptValue(stored: string, passphrase: string): string {
  if (!stored.startsWith('enc:')) return stored;
  const parts = stored.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted value format');
  const [, ivHex, tagHex, ciphertextHex] = parts;
  const key = deriveKey(passphrase);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function maskSecret(value: string): string {
  if (!value) return '';
  const show = Math.min(6, Math.floor(value.length / 3));
  return value.slice(0, show) + '****';
}
