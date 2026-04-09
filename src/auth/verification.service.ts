import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface VerificationMethod {
  type: string;
  name: string;
  description: string;
  enabled: boolean;
  can_send: boolean;
  send_data?: Record<string, unknown>;
}

export interface VerificationFactorResult {
  success: boolean;
  message: string;
  verified_method?: string;
}

@Injectable()
export class VerificationService {
  private static readonly FACTOR_CODE_EXPIRY_MINUTES = 10;
  private static readonly FACTOR_CODE_LENGTH = 6;

  constructor(private readonly prisma: PrismaService) {}

  getAvailableVerificationMethods(user: any): VerificationMethod[] {
    const methods: VerificationMethod[] = [];
    methods.push({
      type: 'totp',
      name: 'Authenticator App (2FA)',
      description: 'Use an authenticator app like Google Authenticator',
      enabled: !!user.twofaEnabled && !!user.twofaSecret,
      can_send: false,
    });

    methods.push({
      type: 'email',
      name: 'Email Verification',
      description: 'Receive a verification code via email',
      enabled: !!user.email && !!user.emailVerified,
      can_send: true,
      send_data: { target: user.id },
    });

    return methods.filter(m => m.enabled);
  }

  isVerificationRequired(user: any): boolean {
    return !!user.twofaEnabled || !!user.emailVerified;
  }

  private generateFactorCode(): string {
    const digits = '0123456789';
    let code = '';
    for (let i = 0; i < VerificationService.FACTOR_CODE_LENGTH; i++) {
      const idx = Math.floor(Math.random() * digits.length);
      code += digits[idx];
    }
    return code;
  }

  async createFactorCode(user: any, method: 'email'): Promise<string | null> {
    try {
      const code = this.generateFactorCode();
      const expiresAt = new Date(Date.now() + VerificationService.FACTOR_CODE_EXPIRY_MINUTES * 60 * 1000);

      await this.prisma.verificationFactors.deleteMany({
        where: { userId: user.id, method },
      });

      await this.prisma.verificationFactors.create({
        data: {
          userId: user.id,
          method,
          code,
          expiresAt,
        },
      });

      return code;
    } catch (err) {
      return null;
    }
  }

  async sendVerificationCode(user: any, method: string): Promise<boolean> {
    if (method !== 'email') return false;
    const code = await this.createFactorCode(user, 'email');
    if (!code) return false;
    // TODO: integrate with Email service to actually send the code. For now we persist the code.
    return true;
  }

  async verifyFactorCode(user: any, code: string): Promise<VerificationFactorResult> {
    const methods = this.getAvailableVerificationMethods(user);
    if (!methods.length) return { success: false, message: 'No verification methods available' };

    // Try email first if available
    if (methods.find(m => m.type === 'email')) {
      const factor = await this.prisma.verificationFactors.findFirst({
        where: {
          userId: user.id,
          method: 'email',
          code: code,
          expiresAt: { gt: new Date() },
        },
      });
      if (factor) {
        await this.prisma.verificationFactors.delete({ where: { id: factor.id } });
        return { success: true, message: 'Verified', verified_method: 'email' };
      }
    }

    // TOTP not implemented here
    if (methods.find(m => m.type === 'totp')) {
      return { success: false, message: 'TOTP verification not implemented', verified_method: 'totp' };
    }

    return { success: false, message: 'Invalid verification code' };
  }
}
