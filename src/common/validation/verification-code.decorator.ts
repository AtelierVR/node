import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Verification-code character sets.
 *
 * Mirrors `VerificationMethod['details']['code']['type']` declared in
 * `auth/verification.service.ts`:
 *   - `numeric`      → "0-9"       (TOTP, email MFA, passkey factor)
 *   - `alphanumeric` → "0-9 A-Z"
 *   - `hex`          → "0-9 A-F"
 */
export type VerificationCodeType = 'numeric' | 'alphanumeric' | 'hex';

/**
 * Default verification-code length.
 * All methods registered in `VerificationService` currently use 6 characters
 * (`totp`, `email` and the passkey factor code are all 6-digit numeric).
 */
export const VERIFICATION_CODE_LENGTH = 6;

/**
 * Allowed characters per type. Uppercase is required by the contract for
 * alphanumeric/hex, but lowercase input is tolerated (users type codes by hand).
 */
const CHARSET: Record<VerificationCodeType, string> = {
  numeric: '0-9',
  alphanumeric: '0-9A-Za-z',
  hex: '0-9A-Fa-f',
};

/** Union of every supported charset — used when no explicit type is given. */
const ANY_CHARSET = '0-9A-Za-z';

export interface IsVerificationCodeOptions {
  /** Expected code length. Defaults to {@link VERIFICATION_CODE_LENGTH} (6). */
  length?: number;
  /** Restrict to a single charset. When omitted, any declared type is accepted. */
  type?: VerificationCodeType;
}

/**
 * Validates a multi-factor verification code against the real contract used by
 * `VerificationService.verifyFactorCode()`: a fixed-length code made of the
 * characters declared by the verification method (`numeric`, `alphanumeric` or `hex`).
 *
 * This replaces the previous hardcoded `/^[0-9]{6}$/` which only covered the
 * `numeric` type and rejected valid alphanumeric/hex codes.
 *
 * @example
 *   @IsVerificationCode() factor_code?: string;                       // any type, length 6
 *   @IsVerificationCode({ type: 'numeric' }) factor_code?: string;    // numeric only
 */
export function IsVerificationCode(
  options: IsVerificationCodeOptions & ValidationOptions = {},
): PropertyDecorator {
  const length = options.length ?? VERIFICATION_CODE_LENGTH;
  const charset = options.type ? CHARSET[options.type] : ANY_CHARSET;
  const pattern = new RegExp(`^[${charset}]{${length}}$`);

  return function (object: object, propertyName: string | symbol): void {
    registerDecorator({
      name: 'isVerificationCode',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && pattern.test(value);
        },
        defaultMessage(args: ValidationArguments): string {
          const what = options.type ?? 'numeric, alphanumeric or hex';
          return `${args.property} must be a ${length}-character verification code (${what})`;
        },
      },
    });
  };
}
