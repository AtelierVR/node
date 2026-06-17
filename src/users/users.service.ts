import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { generateKeyPairSync, createHash, randomBytes } from 'node:crypto';
import { extname } from 'path';
import { UpdateUserDto } from './dto/update-user.dto';
import type { ApiLinkDto } from './dto/update-user.dto';
import { PrismaService } from '../database/prisma.service';
import { NoxIdentifier } from '../common/identifier';
import { ApiLink } from './users.types';
import { WellKnownService } from '../fediverse/well-known.service';
import { UserDelegate } from 'src/generated/prisma/models';
import { User, UserWithMethods } from './user.model';
import { $Enums } from 'src/generated/prisma/client';
import { hashPassword, verifyPassword } from 'src/utils/password';
import { JsonValue } from '@prisma/client/runtime/client';
import { VerificationService } from '../auth/verification.service';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { AppConfigService } from 'src/config/config.service';
import { StorageService } from '../storage/storage.service';
import { RelationsService } from '../relations/relations.service';
import { ActivityService } from '../activity/activity.service';
import { CacheService } from '../cache/cache.service';
import type { WsGateway } from '../ws/ws.gateway';

export interface Ed25519KeyPair {
    public: Buffer;
    private: Buffer;
    expiresAt: Date;
}

type DiskMulterFile = Express.Multer.File & { path?: string };

const USER_CACHE_PREFIX = 'user:';
const USER_CACHE_TTL = 300; // 5 minutes

@Injectable()
export class UsersService implements OnModuleInit {

    public readonly logger = new Logger(UsersService.name);

    constructor(
        public readonly prisma: PrismaService,
        private readonly config: AppConfigService,
        public readonly wellKnown: WellKnownService,
        private readonly verification: VerificationService,
        public readonly storage: StorageService,
        @Inject(forwardRef(() => RelationsService))
        public readonly relations: RelationsService,
        @Inject(forwardRef(() => ActivityService))
        public readonly activity: ActivityService,
        @Inject(forwardRef(() => require('../ws/ws.gateway').WsGateway))
        public readonly wsGateway: WsGateway,
        private readonly cache: CacheService,
    ) { }

    async onModuleInit(): Promise<void> {
        try {
            await this.prisma.ready;
        } catch {
            this.logger.warn('Database unavailable — skipping admin user bootstrap');
            return;
        }
        await this.ensureAdminUser();
    }

    async domain(): Promise<string> {
        return await this.wellKnown.address();
    }

    async mainAdminId(): Promise<number> {
        return await this.config.get<number>('admin.id');
    }

    /**
     * Upserts the built-in admin user, matching the _node Database.whenReady() approach:
     *
     * - Config vars: ADMIN_ID (default 1), ADMIN_USERNAME (default 'admin'),
     *                ADMIN_DISPLAY (default 'Admin'), ADMIN_PASSWORD (default '')
     * - Upsert by id, not username.
     * - Create: writes all fields including a fresh Ed25519 cert.
     * - Update: ONLY merges the sys:admin tag — does NOT overwrite
     *           display name, password, or username.
     * - The cert is only ever written at creation time.
     */
    async ensureAdminUser(): Promise<void> {
        try {
            const id = await this.mainAdminId();
            const username = await this.config.get<string>('admin.username') ?? 'admin';
            const display = await this.config.get<string>('admin.display') ?? 'Admin';
            const password = await this.config.get<string>('admin.password') ?? '';

            // Read existing tags so sys:admin is merged, not replaced.
            const existing = await this.users.findFirst({
                where: { id: id },
                select: { tags: true } as Record<string, boolean>,
            });
            const existingTags: string[] = (existing as unknown as { tags?: string[] })?.tags ?? [];
            const mergedTags = existingTags.includes('sys:admin')
                ? existingTags
                : [...existingTags, 'sys:admin'];

            // Fresh cert — only used in the create branch.
            const kp = await this.generateKeyPair();
            const passwordHash = await hashPassword(password);

            await this.users.upsert({
                where: { id: id },
                create: {
                    id: id,
                    username: username,
                    display: display,
                    bio: null,
                    pronoun: null,
                    email: null,
                    emailVerified: false,
                    password: passwordHash,
                    rank: 100,
                    tags: ['sys:admin'],
                    thumbnail: null,
                    banner: null,
                    links: [],
                    presence: $Enums.PresenceStatus.ONLINE,
                    presenceStatus: null,
                    public: Buffer.from(kp.public),
                    private: Buffer.from(kp.private),
                    expiresKey: kp.expiresAt,
                },
                update: {
                    // Merge the sys:admin tag without touching other fields.
                    tags: mergedTags,
                    // Re-sync password only when an explicit password is set in config —
                    // prevents clearing a password that was changed via the API.
                    ...(password ? { password: passwordHash } : {}),
                },
            });

            const fp = createHash('sha256').update(kp.public).digest('hex').slice(0, 16);
            this.logger.log(
                existing
                    ? `Admin user updated (id=${id})`
                    : `Admin user created (id=${id}) — cert fp: ${fp}`,
            );

            this.activity.create({
                type: 'node.ready',
                message: existing
                    ? 'Node started'
                    : 'Node started (admin user created)',
                details: { admin_id: id }
            }).catch(() => { });
        } catch (err) {
            this.logger.warn(`Could not ensure admin user: ${(err as Error).message}`);
        }
    }

    // ── Certificate helpers ──────────────────────────────────────────────────────

    /**
     * Generates a fresh Ed25519 keypair valid for 1 year.
     * Public key: SPKI DER  (~44 bytes → ~60 chars base64)
     * Private key: PKCS#8 DER (~48 bytes)
     */
    async generateKeyPair(): Promise<Ed25519KeyPair> {
        const expirate = await this.config.get<number>('session.expiration');
        const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
            publicKeyEncoding: { type: 'spki', format: 'der' },
            privateKeyEncoding: { type: 'pkcs8', format: 'der' },
        });
        return {
            public: Buffer.from(publicKey),
            private: Buffer.from(privateKey),
            expiresAt: new Date(Date.now() + expirate)
        };
    }

    /** Compact representation: base64(SPKI DER) — ~60 chars, Ed25519 */
    compactPublicKey(certPub: Buffer): string {
        return certPub.toString('base64');
    }

    // ── Lookup ───────────────────────────────────────────────────────────────────

    async findById(id: number): Promise<UserWithMethods | null> {
        const cacheKey = `${USER_CACHE_PREFIX}${id}`;

        const cached = await this.cache.get<any>(cacheKey);
        if (cached) return User.attach(cached, this);

        const model = await this.users.findFirst({ where: { id } });
        if (!model) return null;

        await this.cache.set(cacheKey, model, USER_CACHE_TTL);
        return User.attach(model, this);
    }

    async findByUsername(username: string): Promise<UserWithMethods | null> {
        const model = await this.users.findFirst({ where: { username: username.toLowerCase() } });
        if (!model) return null;
        return User.attach(model, this);
    }

    /**
     * Resolves a user from a parsed NoxIdentifier.
     * Returns null for remote identifiers (not yet federated).
     */
    async findByIdentifier(identifier: NoxIdentifier): Promise<UserWithMethods | null> {
        if (!identifier.isLocal(await this.wellKnown.address())) return null;
        const numeric = identifier.numericId;
        if (numeric !== null) return this.findById(numeric);
        return this.findByUsername(identifier.id);
    }


    public parseLinks(raw: unknown): ApiLink[] {
        if (!Array.isArray(raw)) return [];
        return (raw as unknown[])
            .filter((e): e is ApiLink => typeof e === 'object' && e !== null && 'value' in e)
            .map((e: any) => ({ label: (e.label ?? e.key ?? '').toString(), value: e.value.toString() }));
    }

    // ── Delegate shortcut ────────────────────────────────────────────────────────

    private get users(): UserDelegate {
        return this.prisma.users as UserDelegate;
    }

    /**
     * Search users by numeric ids, usernames or free-text query.
     * Returns a paginated list and total count.
     */
    async searchUsers(
        opts: { ids?: Array<number | string>; query?: string },
        limit = 10,
        offset = 0,
    ): Promise<{ users: UserWithMethods[]; total: number }> {
        // Build where clause: support ids OR free-text query. When neither is provided
        // we list all users (empty where => all rows), matching _node behavior.
        const where: any = {};

        if (opts.ids && opts.ids.length > 0) {
            const numericIds = opts.ids.filter((v) => typeof v === 'number') as number[];
            const names = opts.ids.filter((v) => typeof v === 'string') as string[];

            const clauses: any[] = [];
            if (numericIds.length > 0) clauses.push({ id: { in: numericIds } });
            if (names.length > 0) clauses.push({ username: { in: names } });

            if (clauses.length === 1) Object.assign(where, clauses[0]);
            else where.OR = clauses;
        } else {
            const q = opts.query && opts.query.length > 0 ? opts.query : undefined;
            if (q) {
                where.OR = [
                    { username: { contains: q, mode: 'insensitive' } },
                    { display: { contains: q, mode: 'insensitive' } },
                ];
            } else {
                // no filters: leave `where` empty to return all users
            }
        }

        const total = await this.users.count({ where });
        const users = await this.users.findMany({ where, take: limit, skip: offset, orderBy: { id: 'asc' } });
        const wrapped = users.map(u => User.attach(u, this));
        return { users: wrapped, total };
    }

    /** Update a user by id with the provided fields. Returns wrapped updated user. */
    async updateUser(userId: number, input: UpdateUserDto, files?: { thumbnail?: Express.Multer.File[]; banner?: Express.Multer.File[] }): Promise<UserWithMethods> {
        const model = await this.users.findFirst({ where: { id: userId } });
        if (!model) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'User');

        let sensitive = false;
        let emailChanged = false;
        const updates: any = {};

        // Username
        if (input.username && input.username !== model.username) {
            const existing = await this.users.findFirst({ where: { username: input.username.toLowerCase() } });
            if (existing && existing.id !== model.id) throw new ApiException(ApiErrorCode.CONFLICT, null, 'Username');
            updates.username = input.username.toLowerCase();
            sensitive = true;
        }

        // Basic fields
        if (input.display !== undefined) updates.display = input.display ?? model.display;
        if (input.bio !== undefined) updates.bio = input.bio ?? null;
        if (input.pronoun !== undefined) updates.pronoun = input.pronoun ?? null;

        // Links
        if (input.links !== undefined) {
            const normalized = Array.isArray(input.links)
                ? input.links.map((l: any) => ({ label: (l.label ?? l.key ?? '').trim(), value: (l.value || '').trim() }))
                : [];
            updates.links = normalized as JsonValue;
        }

        // Tags: keep only usr:* tags provided, merge non-usr from existing
        if (input.tags !== undefined) {
            const newUsrTags = Array.isArray(input.tags)
                ? input.tags.reduce((acc: string[], tag: string) => {
                    if (!acc.includes(tag)) acc.push(tag);
                    return acc;
                }, [] as string[]).filter(t => t.startsWith('usr:') && t.split(':')[1]?.length > 0)
                : [];
            const nonUsr = (model.tags || []).filter(t => !t.startsWith('usr:'));
            updates.tags = [...newUsrTags, ...nonUsr];
        }

        // Thumbnails / banners: if a file was uploaded, store it and set the URL;
        // otherwise honor explicit JSON `thumbnail`/`banner` in the body (string or null).
        if (files?.thumbnail && files.thumbnail.length > 0) {
            const f = files.thumbnail[0] as DiskMulterFile;
            const ok = await this.storage.store({ source: f.path!, mimetype: f.mimetype });
            if (ok) updates.thumbnail = ok.key;
            else this.logger.warn(`Failed to store uploaded thumbnail for user ${model.id}`);
        } else if (input.thumbnail !== undefined)
            updates.thumbnail = input.thumbnail ?? null;

        if (files?.banner && files.banner.length > 0) {
            const f = files.banner[0] as DiskMulterFile;
            const ok = await this.storage.store({ source: f.path!, mimetype: f.mimetype });
            if (ok) updates.banner = ok.key;
            else this.logger.warn(`Failed to store uploaded banner for user ${model.id}`);
        } else if (input.banner !== undefined)
            updates.banner = input.banner ?? null;

        // Home identifier
        if (input.home !== undefined)
            if (input.home === null) updates.homeRef = null;
            else if (typeof input.home === 'string' && input.home.length > 0) {
                const ni = NoxIdentifier.parse(input.home);
                if (ni.type && ni.type !== 'w') 
                    throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'home');
                let homeStr: string;
                if (ni.isLocal(await this.wellKnown.address())) {
                    const clean = new NoxIdentifier(null, ni.id, undefined, ni.query);
                    homeStr = clean.toString();
                } else {
                    homeStr = ni.toString();
                }
                updates.homeRef = homeStr;
            }

        // Avatar identifier
        if (input.avatar !== undefined)
            if (input.avatar === null) updates.avatarRef = null;
            else if (typeof input.avatar === 'string' && input.avatar.length > 0) {
                const ni = NoxIdentifier.parse(input.avatar);
                let avatarStr: string;
                if (ni.isLocal(await this.wellKnown.address())) {
                    const clean = new NoxIdentifier(null, ni.id, undefined, ni.query);
                    avatarStr = clean.toString();
                } else avatarStr = ni.toString();
                updates.avatarRef = avatarStr;
            }

        // Presence
        if (input.presence !== undefined) {
            const map: Record<string, $Enums.PresenceStatus> = {
                online: $Enums.PresenceStatus.ONLINE,
                busy: $Enums.PresenceStatus.BUSY,
                do_not_disturb: $Enums.PresenceStatus.DO_NOT_DISTURB,
                stream: $Enums.PresenceStatus.STREAM,
                offline: $Enums.PresenceStatus.OFFLINE,
            } as any;
            const p = map[input.presence];
            if (!p) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'presence');
            updates.presence = p as any;
        }

        if (input.presence_status !== undefined)
            updates.presenceStatus = (input.presence_status?.trim() || null);

        // Password change
        if (input.password !== undefined) {
            if (!input.current_password) throw new ApiException(ApiErrorCode.VALIDATION_ERROR, { field: 'current_password', message: 'Current password is required to change password' }, 'Current password is required to change password');
            if (!model.password || !(await verifyPassword(model.password, input.current_password)))
                throw new ApiException(ApiErrorCode.VALIDATION_ERROR, { field: 'current_password', message: 'Current password is incorrect' }, 'Current password is incorrect');
            updates.password = await hashPassword(input.password);
            sensitive = true;
        }

        // Email changes
        if (input.email !== undefined && input.email !== model.email) 
            if (input.email && input.email !== model.email) {
                const existing = await this.users.findFirst({ where: { email: input.email } });
                if (existing && existing.id !== model.id) throw new ApiException(ApiErrorCode.CONFLICT, null, 'Email');
                updates.email = input.email;
                updates.emailVerified = false;
                sensitive = true;
                emailChanged = true;
            } else if (input.email === null && model.email !== null) {
                updates.email = null;
                updates.emailVerified = false;
                sensitive = true;
                emailChanged = true;
            }
            
        // If sensitive changes require verification
        if (sensitive && this.verification.isVerificationRequired(model))
            if (input.factor_code) {
                const verifyResult = await this.verification.verifyFactorCode(model, input.factor_code);
                if (!verifyResult.success)
                    throw new ApiException(ApiErrorCode.VALIDATION_ERROR, { field: 'factor_code', message: verifyResult.message }, verifyResult.message);
            } else {
                const methods = this.verification.getAvailableVerificationMethods(model);
                throw new ApiException(ApiErrorCode.VERIFICATION_REQUIRED, { verification_required: true, methods }, 'Verification required');
            }

        // Apply update
        const updated = await this.users.update({ where: { id: model.id }, data: updates });

        // Cleanup old files: if we changed thumbnail/banner and the previous value
        // was a local provider URL (file://...), delete the old file.
        try {
            if (updates.thumbnail !== undefined) {
                const oldThumb = model.thumbnail;
                const newThumb = updates.thumbnail ?? null;
                if (oldThumb && oldThumb !== newThumb)
                    await this.storage.delete(oldThumb);
            }
        } catch (err) {
            this.logger.warn(`Failed to delete old thumbnail for user ${model.id}: ${(err as Error).message}`);
        }

        try {
            if (updates.banner !== undefined) {
                const oldBanner = model.banner;
                const newBanner = updates.banner ?? null;
                if (oldBanner && oldBanner !== newBanner)
                    await this.storage.delete(oldBanner);
            }
        } catch (err) {
            this.logger.warn(`Failed to delete old banner for user ${model.id}: ${(err as Error).message}`);
        }

        // Try to send verification code when email changed (best-effort)
        if (emailChanged && updated.email)
            try {
                await this.verification.sendVerificationCode(updated, 'email');
            } catch (err) {
                this.logger.warn(`Failed to create/send verification code for user ${updated.id}: ${(err as Error).message}`);
            }

        // Invalidate cache on update
        await this.cache.del(`${USER_CACHE_PREFIX}${model.id}`);

        return User.attach(updated, this);
    }
}
