import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { createPublicKey } from 'node:crypto';

/** Supported public-key algorithms. */
export type PublicKeyType = 'ed25519' | 'rsa';

export interface IsPublicKeyOptions {
  /**
   * Accepted key algorithm(s). Defaults to `'ed25519'`.
   * `'rsa'` matches any RSA SubjectPublicKeyInfo (2048-8192 bits and beyond).
   */
  type?: PublicKeyType | PublicKeyType[];
  /** Also accept a raw (unwrapped) public key of the algorithm's native size. Defaults to `true`. */
  allowRaw?: boolean;
}

/** Raw (unwrapped) Ed25519 key size, in bytes. */
const ED25519_RAW_SIZE = 32;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Strictly decodes a base64 string (whitespace tolerated, non-canonical encodings rejected).
 * Returns `null` when the value is not valid base64.
 */
function decodeBase64Strict(value: string): Buffer | null {
  const compact = value.replace(/\s+/g, '');
  if (compact.length === 0 || !BASE64_RE.test(compact)) return null;

  const padded =
    compact.length % 4 === 0
      ? compact
      : compact + '='.repeat(4 - (compact.length % 4));
  if (padded.length % 4 !== 0) return null;

  const buf = Buffer.from(padded, 'base64');
  // Round-trip check — rejects truncatable / mis-padded encodings.
  if (buf.toString('base64') !== padded) return null;
  return buf;
}

/** Node's `KeyObject.asymmetricKeyType` → {@link PublicKeyType}. */
const ASYMMETRIC_KEY_TYPE: Record<string, PublicKeyType> = {
  ed25519: 'ed25519',
  rsa: 'rsa',
  'rsa-pss': 'rsa',
};

/** Reads the algorithm of a SPKI DER public key, or `null` when it cannot be parsed. */
function detectSpkiType(der: Buffer): PublicKeyType | null {
  try {
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return ASYMMETRIC_KEY_TYPE[key.asymmetricKeyType ?? ''] ?? null;
  } catch {
    return null;
  }
}

/**
 * Validates a base64-encoded public key.
 *
 * By default only Ed25519 is accepted — either the wrapped SPKI DER form
 * (`base64(SPKI DER)`, 44 bytes, as produced by `users.service.ts`) or the raw
 * 32-byte key. RSA clients (Unity `nox.cck`, 4096-bit by default, up to 8192) are
 * supported through `type: ['ed25519', 'rsa']`, which matches any parsable SPKI DER.
 *
 * The key is opaque to the server (stored on the session and reduced to a SHA-256
 * fingerprint), so every accepted algorithm is equivalent for the fingerprint.
 *
 * @example
 *   @IsPublicKey({ type: ['ed25519', 'rsa'] }) public_key?: string;
 */
export function IsPublicKey(
  options: IsPublicKeyOptions & ValidationOptions = {},
): PropertyDecorator {
  const types: PublicKeyType[] = Array.isArray(options.type)
    ? options.type
    : [options.type ?? 'ed25519'];
  const allowRaw = options.allowRaw ?? true;

  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isPublicKey',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;

          const buf = decodeBase64Strict(value);
          if (!buf) return false;

          // Raw (unwrapped) Ed25519 key.
          if (
            allowRaw &&
            types.includes('ed25519') &&
            buf.length === ED25519_RAW_SIZE
          )
            return true;

          // Wrapped SPKI DER form — detect the algorithm from the DER itself.
          const detected = detectSpkiType(buf);
          return detected !== null && types.includes(detected);
        },
        defaultMessage(args: ValidationArguments): string {
          const raw =
            allowRaw && types.includes('ed25519')
              ? ` or a raw ${ED25519_RAW_SIZE}-byte key`
              : '';
          return `${args.property} must be a base64-encoded ${types.join(
            ' or ',
          )} public key (SPKI DER${raw})`;
        },
      },
    });
  };
}
