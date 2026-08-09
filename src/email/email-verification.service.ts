import { Injectable, Inject, Optional, forwardRef, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { EmailService } from './email.service';
import { WellKnownService } from '../fediverse/well-known.service';
import { WsGateway } from '../ws/ws.gateway';
import { UsersService } from '../users/users.service';

@Injectable()
export class EmailVerificationService {
    private readonly logger = new Logger(EmailVerificationService.name);
    private static readonly LINK_EXPIRY_HOURS = 24;
    private static readonly CODE_EXPIRY_MINUTES = 10;

    constructor(
        private readonly prisma: PrismaService,
        private readonly email: EmailService,
        private readonly wk: WellKnownService,
        @Optional() @Inject(forwardRef(() => WsGateway))
        private readonly wsGateway?: WsGateway,
        @Optional() @Inject(forwardRef(() => UsersService))
        private readonly usersService?: UsersService,
    ) { }

    // ── Clickable link (email_verification) ──────────────────────────────

    async createEmailLinkToken(userId: number, email: string): Promise<string | null> {
        const random = randomBytes(32).toString('hex');
        const secret = process.env.JWT_SECRET || 'change-me';
        const token = createHash('sha256')
            .update(`${userId}:${email}:${Date.now()}:${random}:${secret}`)
            .digest('hex');

        const expires = new Date(Date.now() + EmailVerificationService.LINK_EXPIRY_HOURS * 3600_000);

        // Delete previous email_link tokens for this user
        await this.prisma.verifications.deleteMany({
            where: { userId, type: 'email_link' },
        });

        await this.prisma.verifications.create({
            data: { userId, type: 'email_link', code: token, expires },
        });

        return token;
    }

    async sendEmailLink(userId: number, email: string, display: string, username: string): Promise<boolean> {
        const token = await this.createEmailLinkToken(userId, email);
        if (!token) return false;

        const [origin, address, serverName] = await Promise.all([
            this.wk.webBaseUrl(),
            this.wk.address(),
            this.email.resolveInstanceName(),
        ]);
        const url = new URL('/confirmation', origin);
        url.searchParams.set('type', 'email');
        url.searchParams.set('token', token);

        return this.email.sendTemplatedEmail(email, 'email-verification', {
            username,
            display: display || username,
            verificationUrl: url.toString(),
            serverName,
            serverTeam: serverName,
            serverAddress: address,
            serverUrl: origin,
        });
    }

    async verifyEmailLink(token: string): Promise<{ success: boolean; userId?: number; message: string }> {
        const record = await this.prisma.verifications.findFirst({
            where: { type: 'email_link', code: token, validated: false, expires: { gt: new Date() } },
        });
        if (!record) return { success: false, message: 'Invalid or expired verification link' };

        await this.prisma.verifications.update({
            where: { id: record.id },
            data: { validated: true },
        });

        // Mark user email as verified (with cache invalidation + WebSocket via user.update())

        try {
            const user = await this.usersService!.findById(record.userId);
            if (user) {
                await user.update({ emailVerified: true });
            }
        } catch (err) {
            this.logger.warn(`Failed to update user after email verification: ${(err as Error).message}`);
        }

        return { success: true, userId: record.userId, message: 'Email verified' };
    }

    // ── 6-digit MFA code ─────────────────────────────────────────────────

    async createEmailCode(userId: number): Promise<{ code: string; expires: Date } | null> {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expires = new Date(Date.now() + EmailVerificationService.CODE_EXPIRY_MINUTES * 60_000);

        // Delete previous email_code entries for this user
        await this.prisma.verifications.deleteMany({
            where: { userId, type: 'email_code' },
        });

        await this.prisma.verifications.create({
            data: { userId, type: 'email_code', code, expires },
        });

        return { code, expires };
    }

    async sendEmailCode(userId: number, email: string, display: string): Promise<boolean> {
        const result = await this.createEmailCode(userId);
        if (!result) return false;

        const [origin, address, serverName] = await Promise.all([
            this.wk.webBaseUrl(),
            this.wk.address(),
            this.email.resolveInstanceName(),
        ]);

        return this.email.sendTemplatedEmail(email, 'verification-code', {
            display: display || email,
            verificationCode: result.code,
            expiresIn: EmailVerificationService.formatTimeRemaining(result.expires),
            serverName,
            serverTeam: serverName,
            serverAddress: address,
            serverUrl: origin,
        });
    }

    async verifyEmailCode(userId: number, code: string): Promise<boolean> {
        const record = await this.prisma.verifications.findFirst({
            where: { userId, type: 'email_code', code, validated: false, expires: { gt: new Date() } },
        });
        if (!record) return false;

        await this.prisma.verifications.update({
            where: { id: record.id },
            data: { validated: true },
        });
        return true;
    }

    // ── Security notifications ───────────────────────────────────────────

    /**
     * Send a security notification email when the user's email is verified.
     * Used for: login, auth method enabled, auth method disabled.
     */
    async sendSecurityNotification(
        to: string,
        display: string,
        action: 'login' | 'method_added' | 'method_removed',
        details?: { methodName?: string; ip?: string },
    ): Promise<void> {
        const [origin, address, serverName] = await Promise.all([
            this.wk.webBaseUrl(),
            this.wk.address(),
            this.email.resolveInstanceName(),
        ]);

        const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

        const configs: Record<string, {
            actionDescription: string;
            greeting: string;
            message: string;
            warningTitle: string;
            warningBody: string;
            detailLabel: string;
            detailValue: string;
            footerNote: string;
        }> = {
            login: {
                actionDescription: 'New login',
                greeting: `Hello ${display},`,
                message: 'A new login to your Nox account was just detected.',
                warningTitle: 'Was this you?',
                warningBody: 'If you did not just log in, change your password immediately and review your active sessions in Settings.',
                detailLabel: 'Time',
                detailValue: time,
                footerNote: 'If this was you, you can safely ignore this email.',
            },
            method_added: {
                actionDescription: 'Security method added',
                greeting: `Hello ${display},`,
                message: `A new security method (${details?.methodName ?? 'unknown'}) was added to your Nox account.`,
                warningTitle: '⚠ Security change',
                warningBody: 'If you did not add this security method, someone may have access to your account. Review your security settings immediately.',
                detailLabel: 'Method',
                detailValue: details?.methodName ?? 'Unknown',
                footerNote: 'You can manage your security methods in Account Settings.',
            },
            method_removed: {
                actionDescription: 'Security method removed',
                greeting: `Hello ${display},`,
                message: `A security method (${details?.methodName ?? 'unknown'}) was removed from your Nox account.`,
                warningTitle: '⚠ Security change',
                warningBody: 'If you did not remove this security method, someone may have access to your account. Review your security settings immediately.',
                detailLabel: 'Method',
                detailValue: details?.methodName ?? 'Unknown',
                footerNote: 'You can manage your security methods in Account Settings.',
            },
        };

        const cfg = configs[action];

        this.email.sendTemplatedEmail(to, 'security-notification', {
            ...cfg,
            display,
            serverName,
            serverTeam: serverName,
            serverAddress: address,
            serverUrl: origin,
        }).catch(err => {
            this.logger.warn(`Failed to send security notification (${action}) to ${to}: ${(err as Error).message}`);
        });
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private static formatTimeRemaining(expires: Date): string {
        const diffMs = expires.getTime() - Date.now();
        if (diffMs <= 0) return 'expired';

        const totalMinutes = Math.round(diffMs / 60_000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        const parts: string[] = [];
        if (hours > 0) parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
        if (minutes > 0) parts.push(minutes === 1 ? '1 minute' : `${minutes} minutes`);
        if (parts.length === 0) return 'less than a minute';

        return parts.join(' ');
    }
}
