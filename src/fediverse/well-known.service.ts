import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
    NoxEndpoints,
    NoxGateway,
    NoxVersions,
    NoxWellKnown,
    NodeInfoDocument,
    NodeInfoLinks,
    NoxSoftware,
} from './fediverse.types';
import { FediverseService } from './fediverse.service';
import { existsSync, mkdir, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { KeyPairKeyObjectResult } from 'node:crypto';
import { KeyPair, make, compressPublicKey } from 'src/utils/crypto';
import { AppConfigService } from 'src/config/config.service';

/**
 * Builds all /.well-known/* response documents for this Nox instance.
 *
 * Owns:  /.well-known/nox, /.well-known/nodeinfo, /.well-known/host-meta
 * Uses:  ConfigService (instance.*, gateway.*, http.*)
 */
@Injectable()
export class WellKnownService {
    constructor(
        private readonly config: AppConfigService
    ) {
        try {
            const pkg = JSON.parse(
                readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
            ) as { version?: string };
            this.version = pkg.version ?? '0.0.1';
        } catch {
            this.version = '0.0.1';
        }
        this.termsVersion = WellKnownService.readDocVersion('public/api/terms.md').version || "0";
        this.privacyVersion = WellKnownService.readDocVersion('public/api/privacy.md').version || "0";
        this.rulesVersion = WellKnownService.readDocVersion('public/api/rules.md').version || "0";
    }

    readonly version: string;
    readonly termsVersion: string;
    readonly privacyVersion: string;
    readonly rulesVersion: string;

    /** Reads the `version` field from a Markdown YAML frontmatter. Returns '1' on failure. */
    private static readDocVersion(relativePath: string): Record<string, string> {
        try {
            const content = readFileSync(join(process.cwd(), relativePath), 'utf8');
            return Object.fromEntries(
                /^-+\n([\s\S]+?)\n-+/
                    .exec(content)?.[1]
                    .split('\n')
                    .map((line) => {
                        const [key, ...rest] = line.split(':');
                        return [key.trim(), rest.join(':').trim()];
                    }) ?? []);
        } catch {
            return {};
        }
    }

    // ── Derived URLs ────────────────────────────────────────────────────────────

    /** e.g. https://example.com/api/ */
    async apiBaseUrl(): Promise<string> {
        return await this.config.get<string>('gateway.api');
    }

    /** e.g. wss://example.com/api/ws */
    async wsBaseUrl(): Promise<string> {
        return await this.config.get<string>('gateway.ws');
    }

    /** e.g. https://example.com/ */
    async webBaseUrl(): Promise<string> {
        return await this.config.get<string>('gateway.web');
    }

    async address(): Promise<string> {
        return await this.config.get<string>('address');
    }

    async port(): Promise<number> {
        return await this.config.get<number>('http.port');
    }

    async identifier(): Promise<string> {
        return await this.config.get<string>('identifier');
    }

    get software(): NoxSoftware {
        return {
            name: 'nox',
            version: this.version,
        };
    }

    get protocols(): string[] {
        return [
            'activitypub',
            'nox'
        ];
    }

    async pairKeys() {
        let pubpath = await this.config.get<string>('http.public_path');
        let privpath = await this.config.get<string>('http.private_path');
        let keyPair: KeyPair;
        if (!existsSync(pubpath) || !existsSync(privpath)) {
            keyPair = await make();
            let parent = dirname(pubpath);
            if (!existsSync(parent))
                mkdirSync(parent, { recursive: true });
            parent = dirname(privpath);
            if (!existsSync(parent))
                mkdirSync(parent, { recursive: true });
            writeFileSync(privpath, keyPair.private, 'utf8');
            writeFileSync(pubpath, keyPair.public, 'utf8');
        } else keyPair = {
            public: readFileSync(pubpath, 'utf8'),
            private: readFileSync(privpath, 'utf8'),
        };
        return keyPair;
    }
    // ── Document builders ───────────────────────────────────────────────────────

    async noxWellKnown(): Promise<NoxWellKnown> {
        return {
            id: await this.identifier(),
            status: 'online',
            address: await this.address(),
            public: compressPublicKey((await this.pairKeys()).public),
            port: await this.port(),
            software: this.software,
            started: new Date(Date.now() - Math.floor(process.uptime() * 1000)).getTime(),
            gateway: {
                web: await this.webBaseUrl(),
                ws: await this.wsBaseUrl(),
                api: await this.apiBaseUrl(),
            },
            endpoints: {
                wellknown: new URL(`.well-known/nox`, await this.webBaseUrl()).toString(),
                webfinger: new URL(`.well-known/webfinger?resource={uri}`, await this.webBaseUrl()).toString(),
                nodeinfo: new URL(`.well-known/nodeinfo`, await this.webBaseUrl()).toString(),
                hostmeta: new URL(`.well-known/host-meta`, await this.webBaseUrl()).toString(),
                terms: new URL(`terms.md`, await this.apiBaseUrl()).toString(),
                privacy: new URL(`privacy.md`, await this.apiBaseUrl()).toString(),
                rules: new URL(`rules.md`, await this.apiBaseUrl()).toString(),
            },
            versions: {
                node: process.version.replace(/^v/, ''),
                terms: this.termsVersion,
                privacy: this.privacyVersion,
                rules: this.rulesVersion,
            },
            metadata: {
                title: await this.config.get<string>('instance.name'),
                description: await this.config.getOptional<string>('instance.description') ?? null,
                icon: await this.config.getOptional<string>('instance.icon') ?? null,
                contact: await this.config.getOptional<string>('instance.contact') ?? null,
            },
            features: await this.instanceFeatures(),
            capabilities: [
                ...this.protocols,
                'webfinger',
                'nodeinfo',
                'hostmeta',
            ],
            maintenance: null
        };
    }

    // ── Private helpers ─────────────────────────────────────────────────────────

    /** Parses the comma-separated 'instance.features' config value. */
    private async instanceFeatures(): Promise<string[]> {
        const raw = await this.config.get<string>('instance.features');
        return raw.split(',').map((f) => f.trim()).filter(Boolean);
    }
}
