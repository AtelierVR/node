import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { EmailVerificationService } from '../email/email-verification.service';
import { TotpService } from './totp.service';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { UserWithMethods } from 'src/users/user.model';

export interface VerificationMethod {
  type: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Sending capabilities (null when the method cannot send codes). */
  details: {
    sendable: boolean;
    data: Record<string, unknown>;
    /** Rules for the verification code input. */
    code: {
      length: number;
      /** Character set: 'numeric' (0-9), 'alphanumeric' (0-9 A-Z), 'hex' (0-9 A-F). Default: 'numeric'. */
      type: 'numeric' | 'alphanumeric' | 'hex';
    } | null;
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
    code: { length: number; type: 'numeric' | 'alphanumeric' | 'hex' } | null;
  } | null;
  /** Whether this method is available (enabled) for the given user. */
  available: (user: any) => boolean | Promise<boolean>;
}

const VERIFICATION_METHODS: Record<string, MethodDefinition> = {
  totp: {
    type: 'totp',
    name: 'Authenticator App',
    description: 'Use an authenticator app like Google Authenticator',
    details: { sendable: false, data: () => ({}), code: { length: 6, type: 'numeric' } },
    available: (user) => !!(user.twofaEnabled && user.twofaSecret),
  },
  email: {
    type: 'email',
    name: 'Email Verification',
    description: 'Receive a verification code via email',
    details: {
      sendable: true,
      data: (user) => ({ target: user.id }),
      code: { length: 6, type: 'numeric' },
    },
    available: (user) => !!(user.email && user.emailVerified),
  },
};

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @Inject(forwardRef(() => EmailVerificationService))
    private readonly email: EmailVerificationService,
    private readonly totp: TotpService,
  ) { }

  private methodDisplayName(method: string): string {
    return VERIFICATION_METHODS[method]?.name ?? method;
  }

  async getAvailableVerificationMethods(user: any): Promise<VerificationMethod[]> {
    const results = await Promise.all(
      Object.values(VERIFICATION_METHODS).map(async (m) => {
        if (!(await m.available(user))) return null;
        const method: VerificationMethod = {
          type: m.type,
          name: m.name,
          description: m.description,
          enabled: true,
          details: m.details ? {
            sendable: m.details.sendable,
            data: m.details.data(user),
            code: m.details.code,
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

  async verifyFactorCode(user: UserWithMethods, code: string): Promise<VerificationFactorResult> {
    const methods = await this.getAvailableVerificationMethods(user);
    if (!methods.length) return { success: false, message: 'No verification methods available' };

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
