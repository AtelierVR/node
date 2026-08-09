import { Injectable, CanActivate, ExecutionContext, OnModuleDestroy, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { ExternalServersService } from 'src/external/external-servers.service';
import { ExternalServerWithMethods } from 'src/external/external-server.model';
import { WellKnownService } from 'src/fediverse/well-known.service';
import { verify, decrypt, decompressPublicKey } from 'src/utils/crypto';

export interface OptionalServerAuthenticatedRequest extends Request {
    server: ExternalServerWithMethods | null;
    token: ServerToken | null;
}

export interface ServerAuthenticatedRequest extends OptionalServerAuthenticatedRequest {
    server: ExternalServerWithMethods;
    token: ServerToken;
}

export interface ServerToken {
    /** Adresse du serveur appelant — sert à retrouver sa clé publique. */
    keyId: string;
    /** RSA-OAEP({timestamp, nonce}), chiffré avec notre clé publique. */
    data: Buffer;
    /** RSA-SHA256(data), signé avec la clé privée de l'émetteur. */
    sig: Buffer;
}

interface TokenPayload {
    t: number; // Timestamp d'émission (Date.now()) — vérifié avec une fenêtre de tolérance pour compenser les horloges désynchronisées
    n: string; // Nonce aléatoire pour garantir l'unicité du token (anti-replay) — stocké en mémoire avec sa date d'expiration (timestamp + fenêtre)
    v: number; // Version du token — permet d'ajouter des champs sans casser la validation, en ignorant les champs inconnus
}

const MAX_TOKEN_AGE_MS = 5 * 60 * 1000;

@Injectable()
export class OptionalServerGuard implements CanActivate, OnModuleDestroy {
    private readonly logger = new Logger(OptionalServerGuard.name);

    constructor(
        private readonly servers: ExternalServersService,
        private readonly wellKnown: WellKnownService,
    ) {
        this._cleanupTimer = setInterval(
            () => this._purgeExpiredNonces(),
            MAX_TOKEN_AGE_MS / 2,
        );
    }

    /** nonce → expiry (token.timestamp + fenêtre). Usage unique. */
    private readonly _nonces = new Map<string, number>();
    private readonly _cleanupTimer: NodeJS.Timeout;

    onModuleDestroy() {
        clearInterval(this._cleanupTimer);
    }

    private _purgeExpiredNonces(): void {
        const now = Date.now();
        for (const [nonce, expiresAt] of this._nonces)
            if (expiresAt <= now) this._nonces.delete(nonce);
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<OptionalServerAuthenticatedRequest>();

        const auth = req.get('authorization') ?? '';
        if (!auth.toLowerCase().startsWith('challenge '))
            return true;

        const parts = auth.slice(10).trim().split('.');
        if (parts.length !== 3)
            return true;

        let keyId: string;
        let dataBuffer: Buffer;
        let sigBuffer: Buffer;
        try {
            keyId = Buffer.from(parts[0], 'base64url').toString('utf8');
            dataBuffer = Buffer.from(parts[1], 'base64url');
            sigBuffer = Buffer.from(parts[2], 'base64url');
        } catch {
            return true;
        }

        // 1. Résoudre le serveur appelant — tente une découverte si inconnu
        let server = await this.servers.findOrDiscover(keyId);
        if (!server)
            return true;

        // 2. Vérifier la signature du blob chiffré avec la clé publique de l'émetteur
        const senderPubPem = decompressPublicKey(Buffer.from(server.public as Buffer).toString('utf8'));
        if (!await verify(dataBuffer, sigBuffer, senderPubPem)) {
            this.logger.warn(`Challenge signature verification failed for ${keyId}`);
            return true;
        }

        // 3. Déchiffrer avec notre propre clé privée
        let payload: TokenPayload;
        try {
            const { private: privKey } = await this.wellKnown.pairKeys();
            payload = JSON.parse(decrypt(dataBuffer, privKey).toString('utf8')) as TokenPayload;
        } catch (err: any) {
            this.logger.warn(`Challenge decryption failed for ${keyId}: ${err?.message ?? err}`);
            return true;
        }

        // 4. Vérifier la fenêtre temporelle
        if (Math.abs(Date.now() - payload.t) > MAX_TOKEN_AGE_MS) {
            this.logger.warn(`Challenge timestamp too old for ${keyId}: ${payload.t}`);
            return true;
        }

        // 5. Vérifier l'unicité du nonce (anti-replay)
        if (this._nonces.has(payload.n)) {
            this.logger.warn(`Challenge nonce already used for ${keyId}`);
            return true;
        }

        // Enregistrer le nonce — expire à timestamp + fenêtre
        this._nonces.set(payload.n, payload.t + MAX_TOKEN_AGE_MS);

        await server.touchLastSeen();

        req.server = server;
        req.token = { keyId, data: dataBuffer, sig: sigBuffer };
        return true;
    }
}

@Injectable()
export class ServerGuard implements CanActivate {
    constructor(private readonly optional: OptionalServerGuard) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (!await this.optional.canActivate(context))
            return false;
        const req = context.switchToHttp().getRequest<ServerAuthenticatedRequest>();
        if (!req.server || !req.token)
            throw new ApiException(ApiErrorCode.UNAUTHORIZED);
        return true;
    }
}

export default ServerGuard;
