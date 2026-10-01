import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { EmailVerificationService } from '../email/email-verification.service';
import { TotpService } from './totp.service';
import { PasskeyService } from './passkey.service';
import { PrismaService } from '../database/prisma.service';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { UserWithMethods } from 'src/users/user.model';

export type VerificationCodeCharset = 'numeric' | 'alphanumeric' | 'hex';

/**
 * What the client must collect to answer the challenge. Discriminated on `type`
 * so a client can render the right UI without knowing the method.
 */
export type VerificationInput =
  | {
    /** Show a code field; it is posted back as `factor_code`. */
    type: 'code';
    length: number;
    /** Character set: 'numeric' (0-9), 'alphanumeric' (0-9 A-Z), 'hex' (0-9 A-F). */
    charset: VerificationCodeCharset;
  }
  | {
    /** Run a WebAuthn ceremony instead of typing anything. */
    type: 'passkey';
    /** Ceremony endpoints: `${base}/options` then `${base}/verify`. */
    base: string;
  };

export interface VerificationMethod {
  type: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Sending capabilities (null when the method cannot send codes). */
  details: {
    sendable: boolean;
    data: Record<string, unknown>;
    /** What the client must collect to complete the challenge. */
    input: VerificationInput;
  } | null;
}

export interface VerificationFactorResult {
  success: boolean;
  message: string;
  verified_method?: string;
}

export interface MethodSetupResult {
  secret?: string;
  qr_code_url?: string;
  backup_codes?: string[];
}

export interface MethodActionResult {
  enabled?: boolean;
  disabled?: boolean;
  message: string;
}

// ── Method registry ────────────────────────────────────────────────────

interface MethodDefinition {
  type: string;
  name: string;
  description: string;
  details: {
    sendable: boolean;
    data: (user: any) => Record<string, unknown>;
    input: (user: any, ctx: MethodContext) => VerificationInput;
  } | null;
  /** Whether this method is available (enabled) for the given user. */
  available: (user: any, ctx: MethodContext) => boolean | Promise<boolean>;
}

/**
 * Per-request facts collected once before evaluating the registry, so individual
 * definitions do not each have to hit the database.
 */
export interface MethodContext {
  /** The user has at least one passkey registered. */
  hasPasskey: boolean;
}

/** Challenge shape shared by every 6-digit code method. */
const CODE_6_DIGITS: VerificationInput = { type: 'code', length: 6, charset: 'numeric' };

/** Ceremony endpoint prefix advertised to clients for the passkey method. */
const PASSKEY_CEREMONY_BASE = '/auth/passkey/login';

/**
 * Verification row type of the short-lived code minted after a passkey assertion.
 * Mirrors the email MFA codes (`email_code`) but with a TOTP-like lifetime.
 */
const PASSKEY_CODE_TYPE = 'passkey_code';
/** Lifetime of a passkey-issued code — same order as a TOTP step (30 s). */
const PASSKEY_CODE_TTL_SECONDS = 30;
/** Length of the numeric passkey code (same as email/TOTP). */
const PASSKEY_CODE_LENGTH = 6;

const VERIFICATION_METHODS: Record<string, MethodDefinition> = {
  totp: {
    type: 'totp',
    name: 'Authenticator App',
    description: 'Use an authenticator app',
    details: { 
      sendable: false, 
      data: () => ({}), 
      input: () => CODE_6_DIGITS
    },
    available: (user) => !!(user.twofaEnabled && user.twofaSecret),
  },
  email: {
    type: 'email',
    name: 'Email Verification',
    description: 'Receive a verification code via email',
    details: {
      sendable: true,
      data: (user) => ({ target: user.id }),
      input: () => CODE_6_DIGITS,
    },
    available: (user) => !!(user.email && user.emailVerified),
  },
  passkey: {
    type: 'passkey',
    name: 'Passkey',
    description: 'Approve with a passkey',
    details: {
      // Nothing to send and no code to type — the client runs a WebAuthn ceremony.
      sendable: false,
      data: () => ({}),
      input: (_user, ctx) => ({ 
        type: 'passkey', 
        base: PASSKEY_CEREMONY_BASE
      }),
    },
    available: (_user, ctx) => ctx.hasPasskey,
  },
};

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @Inject(forwardRef(() => EmailVerificationService))
    private readonly email: EmailVerificationService,
    private readonly totp: TotpService,
    private readonly passkeys: PasskeyService,
    private readonly prisma: PrismaService,
  ) { }

  private methodDisplayName(method: string): string {
    return VERIFICATION_METHODS[method]?.name ?? method;
  }

  async getAvailableVerificationMethods(user: any): Promise<VerificationMethod[]> {
    const ctx: MethodContext = {
      hasPasskey: user?.id 
        ? await this.passkeys.hasPasskeys(user.id).catch(() => false) 
        : false,
    };

    const results = await Promise.all(
      Object.values(VERIFICATION_METHODS).map(async (m) => {
        if (!(await m.available(user, ctx))) return null;
        const method: VerificationMethod = {
          type: m.type,
          name: m.name,
          description: m.description,
          enabled: true,
          details: m.details ? {
            sendable: m.details.sendable,
            data: m.details.data(user),
            input: m.details.input(user, ctx),
          } : null,
        };
        return method;
      }),
    );
    return results.filter((m): m is VerificationMethod => m !== null);
  }

  async isVerificationRequired(user: any): Promise<boolean> {
    const methods = await this.getAvailableVerificationMethods(user);
    return methods.length > 0;
  }

  // ── Generic method actions ─────────────────────────────────────────────

  async setupMethod(user: UserWithMethods, method: string, body: Record<string, any>): Promise<MethodSetupResult> {
    switch (method) {
      case 'totp':
        return this.totp.setup(user.id);
      case 'email':
        // Setup email: just store the email and send verification
        if (!body.email) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'email is required');
        await user.update({ email: body.email, emailVerified: false });
        try {
          await this.email.sendEmailLink(user.id, body.email, user.display, user.username);
        } catch (err) {
          this.logger.warn(`Failed to send email verification link: ${(err as Error).message}`);
        }
        return {};
      default:
        throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `Unknown method: ${method}`);
    }
  }

  async enableMethod(user: UserWithMethods | null, method: string, body: Record<string, any>): Promise<MethodActionResult> {
    let result: MethodActionResult;
    switch (method) {
      case 'totp':
        if (!user) throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'Authentication required');
        result = await this.totp.enable(user.id, body.secret, body.token);
        break;
      case 'email': {
        // Link token verification (public — user clicks link in email)
        if (!body.token || body.token.length <= 10)
          throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'token is required');

        const emailResult = await this.email.verifyEmailLink(body.token);
        result = { enabled: emailResult.success, message: emailResult.message };
        break;
      }
      default:
        throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `Unknown method: ${method}`);
    }

    // Security notification: method enabled (only when email is verified)
    if (result.enabled && user?.email && (user as any).emailVerified) {
      this.email.sendSecurityNotification(
        user.email, user.display, 'method_added',
        { methodName: this.methodDisplayName(method) },
      );
    }

    return result;
  }

  async disableMethod(user: UserWithMethods, method: string, factor_code?: string): Promise<MethodActionResult> {
    // Require verification
    if (!factor_code) {
      const methods = await this.getAvailableVerificationMethods(user);
      if (methods.length > 0)
        throw new ApiException(ApiErrorCode.VERIFICATION_REQUIRED, { verification_required: true, methods }, 'Verification required');
    }

    let result: MethodActionResult;
    switch (method) {
      case 'totp':
        result = await this.totp.disable(user.id);
        break;
      case 'email':
        await user.update({ email: null, emailVerified: false });
        result = { disabled: true, message: 'Email removed successfully' };
        break;
      default:
        throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `Unknown method: ${method}`);
    }

    // Security notification: method disabled (only when email is verified)
    if (result.disabled && user.email && (user as any).emailVerified) {
      this.email.sendSecurityNotification(
        user.email, user.display, 'method_removed',
        { methodName: this.methodDisplayName(method) },
      );
    }

    return result;
  }

  async sendFactorCode(user: UserWithMethods, method: string): Promise<boolean> {
    switch (method) {
      case 'email':
        if (!user.email) return false;
        try {
          return await this.email.sendEmailCode(user.id, user.email, user.display);
        } catch (err) {
          this.logger.error(`Failed to send email code: ${(err as Error).message}`);
          return false;
        }
      default:
        return false;
    }
  }

  // ── Passkey factor ─────────────────────────────────────────────────────

  /**
   * Mints a single-use 6-digit code proving a passkey assertion just happened.
   *
   * It follows the exact same storage/validation path as the email MFA codes
   * (`verifications` table), only with a TOTP-like lifetime, and is accepted
   * wherever a `factor_code` is expected — which lets a passkey satisfy the same
   * `VERIFICATION_REQUIRED` handshake as a typed code (e.g. for sensitive profile
   * updates) without the server having to replay the ceremony.
   */
  async issuePasskeyCode(userId: number): Promise<string> {
    const code = this.generateNumericCode();
    const expires = new Date(Date.now() + PASSKEY_CODE_TTL_SECONDS * 1000);

    // A user only ever has one outstanding passkey code.
    await this.prisma.verifications.deleteMany({
      where: { userId, type: PASSKEY_CODE_TYPE },
    });

    await this.prisma.verifications.create({
      data: { userId, type: PASSKEY_CODE_TYPE, code, expires },
    });

    return code;
  }

  /** Consumes a passkey code; false when unknown, expired or already used. */
  private async consumePasskeyCode(
    userId: number,
    code: string,
  ): Promise<boolean> {
    if (!code) return false;

    const record = await this.prisma.verifications.findFirst({
      where: {
        userId,
        type: PASSKEY_CODE_TYPE,
        code,
        validated: false,
        expires: { gt: new Date() },
      },
    });
    if (!record) return false;

    await this.prisma.verifications.update({
      where: { id: record.id },
      data: { validated: true },
    });
    return true;
  }

  /** Random numeric code, zero-padded to the method length. */
  private generateNumericCode(): string {
    const max = 10 ** PASSKEY_CODE_LENGTH;
    return String(randomInt(0, max)).padStart(PASSKEY_CODE_LENGTH, '0');
  }

  async verifyFactorCode(user: UserWithMethods, code: string): Promise<VerificationFactorResult> {
    const methods = await this.getAvailableVerificationMethods(user);
    if (!methods.length) return { success: false, message: 'No verification methods available' };

    // Passkey — the ceremony already proved the factor, `code` is its one-time code.
    if (methods.find(m => m.type === 'passkey') && await this.consumePasskeyCode(user.id, code))
      return { 
        success: true, 
        message: 'Verified', 
        verified_method: 'passkey'
      };

    // Try email first if available
    if (methods.find(m => m.type === 'email')) {
      const ok = await this.email.verifyEmailCode(user.id, code);
      if (ok) return { success: true, message: 'Verified', verified_method: 'email' };
    }

    // Try TOTP
    if (methods.find(m => m.type === 'totp') && user.twofaSecret) {
      const valid = this.totp.verify(user.twofaSecret, code);
      if (valid) return { success: true, message: 'Verified', verified_method: 'totp' };
    }

    return { success: false, message: 'Invalid verification code' };
  }
}
