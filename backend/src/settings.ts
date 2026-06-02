/**
 * Runtime settings: DB values override env defaults.
 * Secret fields (API keys) are stored AES-256-GCM encrypted.
 * Encryption key comes from SETTINGS_ENCRYPTION_KEY env var.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { pool } from './db.js';
import { config, configSchema } from './config.js';
import { z } from 'zod';

// Fields that must be encrypted at rest
export const SECRET_FIELDS = ['LLM_API_KEY', 'EMBEDDING_API_KEY'] as const;
type SecretField = (typeof SECRET_FIELDS)[number];

function deriveKey(passphrase: string): Buffer {
  return createHash('sha256').update(passphrase).digest();
}

function encryptValue(plaintext: string, passphrase: string): string {
  const key = deriveKey(passphrase);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decryptValue(stored: string, passphrase: string): string {
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

export function isEncrypted(value: string): boolean {
  return value.startsWith('enc:');
}

/** Returns "sk-12****" style mask for display */
export function maskSecret(value: string): string {
  if (!value) return '';
  const show = Math.min(6, Math.floor(value.length / 3));
  return value.slice(0, show) + '****';
}

export type EffectiveSettings = z.infer<typeof configSchema>;

/**
 * Returns merged config: DB settings override env defaults.
 * Secrets are decrypted if SETTINGS_ENCRYPTION_KEY is set.
 */
export async function getEffectiveSettings(): Promise<EffectiveSettings> {
  const { rows } = await pool.query('SELECT key, value FROM app_settings');
  const dbOverrides: Record<string, string> = {};
  const encKey = config.SETTINGS_ENCRYPTION_KEY;

  for (const { key, value } of rows as { key: string; value: string }[]) {
    if (!value) continue;
    if (isEncrypted(value)) {
      if (!encKey) continue; // can't decrypt without key
      try {
        dbOverrides[key] = decryptValue(value, encKey);
      } catch {
        continue; // corrupt or wrong key — skip
      }
    } else {
      dbOverrides[key] = value;
    }
  }

  return configSchema.parse({ ...process.env, ...dbOverrides });
}

const settingsSaveSchema = z.object({
  LLM_API_STYLE: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
  LLM_BASE_URL: z.string().url('LLM_BASE_URL must be a valid URL').optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().min(1, 'LLM_MODEL must not be empty').optional(),
  LLM_MAX_TOKENS: z.coerce.number().int().positive('LLM_MAX_TOKENS must be positive').optional(),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  EMBEDDING_API_STYLE: z.enum(['same_as_llm', 'openai', 'anthropic', 'openai_compatible']).optional(),
  EMBEDDING_BASE_URL: z.string().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  MAX_EMBEDDING_CANDIDATES: z.coerce.number().int().min(20).max(500).optional(),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(4).max(256).optional(),
  MAX_RETRIEVED_CHUNKS: z.coerce.number().int().min(4).max(40).optional(),
  MAX_RETRIEVED_CHARS: z.coerce.number().int().min(4000).max(120000).optional(),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
  GENERATE_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().optional()
});

export type SettingsSaveInput = z.infer<typeof settingsSaveSchema>;

export { settingsSaveSchema };

/**
 * Persists settings to DB. Secret fields are encrypted if SETTINGS_ENCRYPTION_KEY is configured.
 * Pass encryptionKey in the request to verify the caller knows the key before we trust them with secrets.
 * If the provided key doesn't match SETTINGS_ENCRYPTION_KEY, throws an error.
 */
export async function saveSettings(
  input: SettingsSaveInput,
  encryptionKey?: string
): Promise<void> {
  const masterKey = config.SETTINGS_ENCRYPTION_KEY;

  // If caller provided a key, it must match master key
  if (encryptionKey && masterKey && encryptionKey !== masterKey) {
    throw new Error('Encryption key does not match server configuration');
  }

  const keyToUse = encryptionKey ?? masterKey;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === null) continue;
      const strValue = String(value);

      // Empty string on a secret field means "don't update it"
      if (SECRET_FIELDS.includes(key as SecretField) && strValue === '') continue;

      let stored = strValue;
      if (SECRET_FIELDS.includes(key as SecretField) && strValue && keyToUse) {
        stored = encryptValue(strValue, keyToUse);
      }

      await client.query(
        `INSERT INTO app_settings(key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, stored]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Returns settings for API response: secrets masked, non-secret values in clear */
export async function getSettingsForDisplay(): Promise<{
  LLM_API_STYLE: string;
  LLM_BASE_URL: string;
  LLM_API_KEY_MASKED: string;
  LLM_MODEL: string;
  LLM_MAX_TOKENS: number;
  LLM_TEMPERATURE: number;
  EMBEDDING_API_STYLE: string;
  EMBEDDING_BASE_URL: string;
  EMBEDDING_API_KEY_MASKED: string;
  EMBEDDING_MODEL: string;
  MAX_EMBEDDING_CANDIDATES: number;
  EMBEDDING_BATCH_SIZE: number;
  MAX_RETRIEVED_CHUNKS: number;
  MAX_RETRIEVED_CHARS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  GENERATE_RATE_LIMIT_MAX_REQUESTS: number;
  ENCRYPTION_CONFIGURED: boolean;
}> {
  const eff = await getEffectiveSettings();
  return {
    LLM_API_STYLE: eff.LLM_API_STYLE,
    LLM_BASE_URL: eff.LLM_BASE_URL,
    LLM_API_KEY_MASKED: maskSecret(eff.LLM_API_KEY),
    LLM_MODEL: eff.LLM_MODEL,
    LLM_MAX_TOKENS: eff.LLM_MAX_TOKENS,
    LLM_TEMPERATURE: eff.LLM_TEMPERATURE,
    EMBEDDING_API_STYLE: eff.EMBEDDING_API_STYLE,
    EMBEDDING_BASE_URL: eff.EMBEDDING_BASE_URL ?? '',
    EMBEDDING_API_KEY_MASKED: maskSecret(eff.EMBEDDING_API_KEY ?? ''),
    EMBEDDING_MODEL: eff.EMBEDDING_MODEL ?? '',
    MAX_EMBEDDING_CANDIDATES: eff.MAX_EMBEDDING_CANDIDATES,
    EMBEDDING_BATCH_SIZE: eff.EMBEDDING_BATCH_SIZE,
    MAX_RETRIEVED_CHUNKS: eff.MAX_RETRIEVED_CHUNKS,
    MAX_RETRIEVED_CHARS: eff.MAX_RETRIEVED_CHARS,
    RATE_LIMIT_MAX_REQUESTS: eff.RATE_LIMIT_MAX_REQUESTS,
    GENERATE_RATE_LIMIT_MAX_REQUESTS: eff.GENERATE_RATE_LIMIT_MAX_REQUESTS,
    ENCRYPTION_CONFIGURED: Boolean(config.SETTINGS_ENCRYPTION_KEY)
  };
}
