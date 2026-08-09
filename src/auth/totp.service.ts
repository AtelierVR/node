import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { UsersService } from '../users/users.service';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';

@Injectable()
export class TotpService {
    private readonly logger = new Logger(TotpService.name);

    constructor(
        @Inject(forwardRef(() => UsersService))
        private readonly users: UsersService,
    ) { }

    /** Generate a new base32-encoded secret for TOTP setup. */
    generateSecret(): string {
        return generateSecret();
    }

    /** Generate an otpauth:// URL for QR code generation. */
    generateQrCodeUrl(secret: string, username: string, issuer: string): string {
        return generateURI({ secret, label: username, issuer });
    }

    /** Verify a TOTP token against a secret. Returns true if valid. */
    verify(secret: string, token: string): boolean {
        try {
            const result = verifySync({ secret, token });
            return result !== null;
        } catch {
            return false;
        }
    }

    // ── Business methods ─────────────────────────────────────────────────

    async setup(userId: number): Promise<{ secret: string; qr_code_url: string; backup_codes: string[] }> {
        const user = await this.users.findById(userId);
        if (!user) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'User');

        const secret = this.generateSecret();
        const address = await this.users.wellKnown.address();
        const label = `${user.username} (${address})`;
        const issuer = 'Nox';
        const qrCodeUrl = this.generateQrCodeUrl(secret, label, issuer);
        const backupCodes = Array.from({ length: 8 }, () => this.generateBackupCode());

        await this.users.prisma.users.update({
            where: { id: userId },
            data: { twofaSecret: secret },
        });

        try { await (this.users as any).cache?.del(`user:${userId}`); } catch { /* best-effort */ }

        return { secret, qr_code_url: qrCodeUrl, backup_codes: backupCodes };
    }

    async enable(userId: number, secret: string, token: string): Promise<{ enabled: boolean; message: string }> {
        const userDb = await this.users.prisma.users.findFirst({
            where: { id: userId },
            select: { twofaSecret: true },
        });
        if (!userDb?.twofaSecret)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, '2FA setup not started');

        if (userDb.twofaSecret !== secret)
            throw new ApiException(ApiErrorCode.VALIDATION_ERROR, { field: 'secret', message: 'Secret mismatch' }, 'Secret mismatch');

        if (!this.verify(secret, token))
            throw new ApiException(ApiErrorCode.VALIDATION_ERROR, { field: 'token', message: 'Invalid verification code' }, 'Invalid verification code');

        await this.users.prisma.users.update({
            where: { id: userId },
            data: { twofaEnabled: true },
        });

        try { await (this.users as any).cache?.del(`user:${userId}`); } catch { /* best-effort */ }

        return { enabled: true, message: '2FA enabled successfully' };
    }

    async disable(userId: number): Promise<{ disabled: boolean; message: string }> {
        await this.users.prisma.users.update({
            where: { id: userId },
            data: { twofaEnabled: false, twofaSecret: null },
        });

        try { await (this.users as any).cache?.del(`user:${userId}`); } catch { /* best-effort */ }

        return { disabled: true, message: '2FA disabled successfully' };
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private generateBackupCode(): string {
        return Array.from({ length: 4 }, () =>
            randomBytes(4).toString('hex'),
        ).join('-');
    }
}
