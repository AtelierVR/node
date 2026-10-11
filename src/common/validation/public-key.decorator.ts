import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/** Supported public-key algorithms. */
export type PublicKeyType = 'ed25519';

export interface IsPublicKeyOptions {
  /** Key algorithm to validate. Defaults to `'ed25519'`. */
  type?: PublicKeyType;
  /** Also accept a raw (unwrapped) public key of the algorithm's native size. Defaults to `true`. */
  allowRaw?: boolean;
}

/**
 * Ed25519 SubjectPublicKeyInfo prefix (RFC 8410 §4):
 *   SEQUENCE (0x2A) { SEQUENCE { OID 1.3.101.112 } BIT STRING (0x21 0x00) } + 32-byte key
 * → total 44 bytes.
 */
const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

/** Native raw key size (bytes) per algorithm. */
const RAW_KEY_SIZE: Record<PublicKeyType, number> = {
  ed25519: 32,
};

const ED25519_SPKI_SIZE = ED25519_SPKI_PREFIX.length + RAW_KEY_SIZE.ed25519; // 44

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

/**
 * Validates a base64-encoded public key against the real key format used by the
 * server (`users.service.ts` → `base64(SPKI DER)`, stored in `sessions.publicKey`).
 *
 * By default both the wrapped SPKI DER form and the raw key form are accepted,
 * because the previous validation only checked the base64 alphabet and some
 * clients send the unwrapped key.
 *
 * @example
 *   @IsPublicKey({ type: 'ed25519' }) public_key?: string;
 */
export function IsPublicKey(
  options: IsPublicKeyOptions & ValidationOptions = {},
): PropertyDecorator {
  const type = options.type ?? 'ed25519';
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

          if (type === 'ed25519') {
            if (allowRaw && buf.length === RAW_KEY_SIZE.ed25519) return true;
            return (
              buf.length === ED25519_SPKI_SIZE &&
              buf
                .subarray(0, ED25519_SPKI_PREFIX.length)
                .equals(ED25519_SPKI_PREFIX)
            );
          }

          return false;
        },
        defaultMessage(args: ValidationArguments): string {
          const raw = allowRaw
            ? ` or a raw ${RAW_KEY_SIZE[type]}-byte key`
            : '';
          return `${args.property} must be a base64-encoded ${type} public key (SPKI DER${raw})`;
        },
      },
    });
  };
}
