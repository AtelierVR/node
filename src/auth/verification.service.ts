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
  can_send: boolean;
  send_data?: Record<string, unknown>;
  /** Rules for the verification code input. */
  code?: {
    length: number;
    /** Character set: 'numeric' (0-9), 'alphanumeric' (0-9 A-Z), 'hex' (0-9 A-F). Default: 'numeric'. */
    type: 'numeric' | 'alphanumeric' | 'hex';
  };
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

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @Inject(forwardRef(() => EmailVerificationService))
    private readonly email: EmailVerificationService,
    private readonly totp: TotpService,
  ) { }

  getAvailableVerificationMethods(user: any): VerificationMethod[] {
    const methods: VerificationMethod[] = [];
    methods.push({
      type: 'totp',
      name: 'Authenticator App (2FA)',
      description: 'Use an authenticator app like Google Authenticator',
      enabled: !!user.twofaEnabled && !!user.twofaSecret,
      can_send: false,
      code: { length: 6, type: 'numeric' },
    });

    methods.push({
      type: 'email',
      name: 'Email Verification',
      description: 'Receive a verification code via email',
      enabled: !!user.email && !!user.emailVerified,
      can_send: true,
      send_data: { target: user.id },
      code: { length: 6, type: 'numeric' },
    });

    return methods.filter(m => m.enabled);
  }

  isVerificationRequired(user: any): boolean {
    return !!user.twofaEnabled || !!user.emailVerified;
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
    switch (method) {
      case 'totp':
        if (!user) throw new ApiException(ApiErrorCode.UNAUTHORIZED, null, 'Authentication required');
        return this.totp.enable(user.id, body.secret, body.token);
      case 'email': {
        // Link token verification (public — user clicks link in email)
        if (!body.token || body.token.length <= 10)
          throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'token is required');

          const result = await this.email.verifyEmailLink(body.token);
          return { enabled: result.success, message: result.message };
      }
      default:
        throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `Unknown method: ${method}`);
    }
  }

  async disableMethod(user: UserWithMethods, method: string, factor_code?: string): Promise<MethodActionResult> {
    // Require verification
    if (!factor_code) {
      const methods = this.getAvailableVerificationMethods(user);
      if (methods.length > 0)
        throw new ApiException(ApiErrorCode.VERIFICATION_REQUIRED, { verification_required: true, methods }, 'Verification required');
    }

    switch (method) {
      case 'totp':
        return this.totp.disable(user.id);
      case 'email':
        await user.update({ email: null, emailVerified: false });
        return { disabled: true, message: 'Email removed successfully' };
      default:
        throw new ApiException(ApiErrorCode.BAD_REQUEST, null, `Unknown method: ${method}`);
    }
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
    const methods = this.getAvailableVerificationMethods(user);
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
