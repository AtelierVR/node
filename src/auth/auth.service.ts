import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../database/prisma.service';
import { hashPassword, verifyPassword } from '../utils/password';
import { SessionService } from './session.service';
import { DeviceService } from './device.service';
import { VerificationService } from './verification.service';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { User } from 'src/users/user.model';
import { AppConfigService } from 'src/config/config.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { NoxIdentifier } from '../common/identifier';
export { RegisterDto, LoginDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
    constructor(
        public readonly users: UsersService,
        private readonly prisma: PrismaService,
        private readonly sessions: SessionService,
        private readonly devices: DeviceService,
        private readonly config: AppConfigService,
        private readonly verification: VerificationService,
    ) { }

    async register(input: RegisterDto, meta?: { ip?: string; userAgent?: string }) {
        // Check for existing username or email
        if (await this.users.findByUsername(input.username))
            throw new ApiException(ApiErrorCode.CONFLICT, null, 'Username');

        if (input.email && (await this.prisma.users.findFirst({ where: { email: input.email } })))
            throw new ApiException(ApiErrorCode.CONFLICT, null, 'Email');

        // Hash password with argon2
        const passwordHash = await hashPassword(input.password);
        // Generate Ed25519 keypair for certificate fields
        const kp = await this.users.generateKeyPair();
        // Create user with all required fields
        const user = User.attach(await this.prisma.users.create({
            data: {
                username: input.username,
                display: input.display ?? input.username,
                email: input.email,
                password: passwordHash,
                thumbnail: input.thumbnail,
                banner: input.banner,
                tags: [],
                links: [],
                presence: 'ONLINE',
                presenceStatus: null,
                public: Buffer.from(kp.public),
                private: Buffer.from(kp.private),
                expiresKey: kp.expiresAt,
            },
        }), this.users);
        // Create session
        const sessionExpiration = await this.config.get<number>('session.expiration');
        const session = await this.sessions.createTokenSession({
            userId: user.id,
            expires: new Date(Date.now() + sessionExpiration),
            publicKeyBase64: input.public_key ?? null,
        });

        // Register device if metadata provided
        if (meta?.ip && meta?.userAgent)
            await this.devices.upsertDevice(session.id, meta.ip, meta.userAgent);

        this.users.activity.create({
            type: 'user.register',
            message: `User "${user.username}" registered`,
            details: { user_id: user.id },
            author: NoxIdentifier.type('u', user.identifier()).toString(),
        }).catch(() => { });

        return { session, user };
    }

    async login(input: LoginDto, meta?: { ip?: string; userAgent?: string }) {
        // Find user by username or id
        let user = typeof input.identifier === 'string'
            ? await this.users.findByUsername(input.identifier)
            : await this.users.findById(input.identifier);

        if (!user)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'User');

        // Check password with argon2
        if (!user.password || !(await verifyPassword(user.password, input.password)))
            throw new ApiException(ApiErrorCode.VALIDATION_ERROR, { field: 'password', message: 'Invalid password' }, 'Invalid password');

        // Handle MFA
        if (this.verification.isVerificationRequired(user)) {
            if (!input.factor_code) {
                const methods = this.verification.getAvailableVerificationMethods(user);
                throw new ApiException(ApiErrorCode.VERIFICATION_REQUIRED, { verification_required: true, methods }, 'Verification required');
            }

            const verifyResult = await this.verification.verifyFactorCode(user, input.factor_code);
            if (!verifyResult.success)
                throw new ApiException(ApiErrorCode.VALIDATION_ERROR, { field: 'factor_code', message: verifyResult.message }, verifyResult.message);
        }

        const sessionExpiration = await this.config.get<number>('session.expiration');
        const session = await this.sessions.createTokenSession({
            userId: user.id,
            expires: new Date(Date.now() + sessionExpiration),
            publicKeyBase64: input.public_key ?? null,
        });

        if (meta?.ip && meta?.userAgent)
            await this.devices.upsertDevice(session.id, meta.ip, meta.userAgent);

        this.users.activity.create({
            type: 'auth.login',
            message: `User "${user.username}" logged in`,
            details: { user_id: user.id, session_id: session.id },
            author: NoxIdentifier.type('u', user.identifier()).toString(),
        }).catch(() => { });

        return { session, user };
    }

    async logoutByToken(token: string): Promise<boolean> {
        const s = await this.sessions.findSessionByToken(token);
        if (!s) return false;
        this.users.findById(s.userId).then(user => {
            if (!user) return;
            this.users.activity.create({
                type: 'auth.logout',
                message: `User "${user.username}" logged out`,
                details: { user_id: s.userId, session_id: s.id },
                author: NoxIdentifier.type('u', user.identifier()).toString(),
            }).catch(() => { });
        }).catch(() => { });
        return this.sessions.deleteSessionById(s.id);
    }
}
