import { ExternalServerModel } from 'src/generated/prisma/models';
import { ExternalServersService } from './external-servers.service';
import { NoxWellKnown } from 'src/fediverse/fediverse.types';
import { ApiResponse } from 'src/api/api.types';
import { ApiErrorCode, ApiErrorFactory } from 'src/api/api-error.factory';
import { discoverWellKnown } from './discover-well-known';
import { randomBytes } from 'node:crypto';
import { sign, encrypt, decompressPublicKey } from 'src/utils/crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ApiResponseEnvelopeDto } from 'src/api/dto/api-response.dto';

import { UserWithMethods } from 'src/users/user.model';

export interface ApiRequestInit extends RequestInit {
    resolve?: boolean; // If true, resolve the apiUrl.
    /** When set, adds X-Nox-As-User header so the remote server can apply ServerAsUserGuard. */
    user?: UserWithMethods;
}

export type ExternalServerWithMethods = ExternalServerModel & {
    manager: ExternalServersService;
    headers(): Promise<Record<string, string>>;
    wellKnown(): Promise<ServerWellKnown>;
    fetch<T = any>(path: string, options?: ApiRequestInit): Promise<ApiResponse<T>>;
    touchLastSeen(): Promise<void>;
};

interface ServerWellKnown {
    data: NoxWellKnown;
    fetchedAt: Date;
    expiresAt: Date;
}

export class ExternalServer {
    // Attach methods to a plain ExternalServerModel instance and return it as ExternalServerWithMethods
    static attach(model: ExternalServerModel, manager: ExternalServersService): ExternalServerWithMethods {
        const obj = model as unknown as ExternalServerWithMethods;
        Object.defineProperty(obj, 'manager', {
            value: manager,
            enumerable: false,
            configurable: true,
            writable: true,
        });

        // Ensure prototype methods are available
        Object.setPrototypeOf(obj, ExternalServer.prototype as any);
        return obj;
    }

    async wellKnown(this: ExternalServerWithMethods): Promise<ServerWellKnown> {
        const cacheKey = `wk:${this.address}`;
        const now = new Date();

        // Try Redis cache first
        const cached = await this.manager.cache.get<ServerWellKnown>(cacheKey);
        if (cached && new Date(cached.expiresAt) > now)
            return cached;

        const discovered = await discoverWellKnown(this.address);
        if (!discovered)
            throw new Error(`Unable to discover /.well-known/nox for ${this.address}`);

        const fetchedAt = new Date();
        const expiresAt = new Date(fetchedAt.getTime() + discovered.ttlMs);
        const entry: ServerWellKnown = { data: discovered.data, fetchedAt, expiresAt };

        // Cache in Redis with TTL matching the well-known expiration
        const ttl = Math.max(60, Math.floor(discovered.ttlMs / 1000));
        await this.manager.cache.set(cacheKey, entry, ttl);

        return entry;
    }

    async fetch<T = any>(this: ExternalServerWithMethods, path: string, options?: ApiRequestInit): Promise<ApiResponse<T>> {
        let apiUrl: string;
        try {
            apiUrl = (await this.wellKnown()).data.gateway.api;
        } catch (e) {
            console.error(`Failed to get API gateway URL for server ${this.address}:`, e);
            return {
                data: null,
                error: ApiErrorFactory.buildError(
                    ApiErrorCode.EXTERNAL_SERVER_ERROR,
                    `Failed to fetch well-known config for ${this.address}: ${(e as Error).message}`
                ),
                time: Date.now(),
                request: path,
            };
        }
        
        const url = new URL(
            path.startsWith('/') ? path.slice(1) : path, 
            apiUrl.endsWith('/') ? apiUrl : apiUrl + '/'
        ).toString();

        let response: Response;
        try {
            const extraHeaders: Record<string, string> = {};
            if (options?.user) extraHeaders['X-Nox-As'] = String(options.user.id);
            response = await fetch(url, {
                headers: {
                    ...options?.headers,
                    ...(await this.headers()),
                    ...extraHeaders,
                },
                ...options,
            });

            await this.touchLastSeen();
        } catch (e) {
            console.error(`Failed to fetch ${url}:`, e);
            return {
                data: null,
                error: ApiErrorFactory.buildError(
                    ApiErrorCode.EXTERNAL_SERVER_ERROR,
                    `Failed to communicate with external server ${this.address}: ${(e as Error).message}`
                ),
                time: Date.now(),
                request: path,
            };
        }


        let json: ApiResponse<T>;
        try {
            const raw = await response.json();
            const envelope = plainToInstance(ApiResponseEnvelopeDto, raw);
            const errors = validateSync(envelope);
            if (errors.length > 0) {
                console.error(`Invalid API response envelope from ${url}:`, errors);
                return {
                    data: null,
                    error: ApiErrorFactory.buildError(
                        ApiErrorCode.EXTERNAL_SERVER_ERROR,
                        `Invalid response envelope from ${url}: missing required fields`
                    ),
                    time: Date.now(),
                    request: path,
                };
            }
            json = raw as ApiResponse<T>;
        } catch (e) {
            console.error(`Failed to parse JSON response from ${url}:`, e);
            return {
                data: null,
                error: ApiErrorFactory.buildError(
                    ApiErrorCode.EXTERNAL_SERVER_ERROR,
                    `Failed to parse JSON response from ${url}: ${(e as Error).message}`
                ),
                time: Date.now(),
                request: path,
            };
        }

        return json;
    }

    async touchLastSeen(this: ExternalServerWithMethods): Promise<void> {
        let date = new Date();
        try {
            await this.manager.externalServers.updateMany({
                where: { id: this.id },
                data: { lastSeen: date },
            });
            this.lastSeen = date;
        } catch (e) {
            this.manager.logger.error(`Failed to update lastSeen for server ${this.address}: ${(e as Error).message}`);
        }

    }

    async headers(this: ExternalServerWithMethods): Promise<Record<string, string>> {
        const { private: privKey } = await this.manager.wellKnown.pairKeys();
        const keyId = await this.manager.wellKnown.address();

        const timestamp = Date.now();
        const nonce = randomBytes(16).toString('hex');

        // Chiffre {timestamp, nonce} avec la clé publique du destinataire
        const recipientPubPem = decompressPublicKey(Buffer.from(this.public as Buffer).toString('utf8'));
        const plaintext = Buffer.from(JSON.stringify({ t: timestamp, n: nonce, v: 1 }), 'utf8');
        const data = encrypt(plaintext, recipientPubPem);

        // Signe le blob chiffré avec notre clé privée
        const sig = await sign(data, privKey);

        const part1 = Buffer.from(keyId, 'utf8').toString('base64url');
        const part2 = data.toString('base64url');
        const part3 = sig.toString('base64url');

        return {
            Authorization: `Challenge ${part1}.${part2}.${part3}`,
        };
    }
}
