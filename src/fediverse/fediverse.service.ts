import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { join } from 'node:path';
import type { NodeInfoDocument, NodeInfoLinks, WebFingerDocument } from './fediverse.types';
import { WellKnownService } from './well-known.service';
import { UsersService } from '../users/users.service';

/**
 * Handles ActivityPub-specific logic: actor lookup, WebFinger resolution.
 * Well-known document building lives in WellKnownService.
 */
@Injectable()
export class FediverseService implements OnModuleInit {
    private readonly logger = new Logger(FediverseService.name);

    constructor(
        private readonly wellKnown: WellKnownService,
        @Inject(forwardRef(() => UsersService))
        private readonly users: UsersService,
    ) { }

    onModuleInit() {
        this.logger.log('FediverseService initialized');
    }

    /**
     * Build the NodeInfo links document for this instance.
     * @returns NodeInfoLinks
     */
    async nodeInfoLinks(): Promise<NodeInfoLinks> {
        return {
            links: [
                {
                    rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
                    href: `${await this.wellKnown.webBaseUrl()}/nodeinfo/2.1`,
                },
                {
                    rel: 'nox/1.0',
                    href: `${await this.wellKnown.webBaseUrl()}/.well-known/nox`,
                }
            ],
        };
    }

    /**
     * Build the NodeInfo 2.1 document for this instance.
     * Extend this method to include real usage statistics and metadata.
     * @returns NodeInfoDocument
     */
    async nodeInfoDocument(): Promise<NodeInfoDocument> {
        return {
            version: '2.1',
            software: this.wellKnown.software,
            protocols: this.wellKnown.protocols,
            usage: {
                users: {
                    total: 0,
                    activeMonth: 0,
                    activeHalfyear: 0
                },
                localPosts: 0,
            },
            openRegistrations: false,
        };
    }

    /** 
     * /.well-known/host-meta — XRD/XML WebFinger link template 
     * @returns XML string
     */
    async hostMetaXml(): Promise<string> {
        const template = `${await this.wellKnown.webBaseUrl()}/.well-known/webfinger?resource={uri}`;
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">',
            `  <Link rel="lrdd" template="${template}"/>`,
            '</XRD>',
        ].join('\n');
    }

    /**
     * Look up an actor by resource URI (WebFinger).
     * Handles acct:username@domain and https://domain/u/username formats.
     */
    async findWebFinger(resource: string): Promise<WebFingerDocument | null> {
        const domain = await this.wellKnown.address();

        // Handle acct: format
        const acctMatch = resource.match(/^acct:(.+)@(.+)$/);
        if (acctMatch) {
            const [, username, host] = acctMatch;
            if (host !== domain) return null;
            return this.buildWebFingerForUsername(username);
        }

        // Handle https:// URL format
        try {
            const url = new URL(resource);
            if (url.hostname !== domain) return null;
            const pathParts = url.pathname.split('/').filter(Boolean);
            if ((pathParts[0] === 'u' || (pathParts[0] === 'ap' && pathParts[1] === 'u')) && pathParts[pathParts.length - 1]) {
                const username = pathParts[0] === 'u' ? pathParts[1] : pathParts[2];
                return this.buildWebFingerForUsername(username);
            }
        } catch { /* invalid URL */ }

        return null;
    }

    private async buildWebFingerForUsername(username: string): Promise<WebFingerDocument | null> {
        const user = await this.users.findByUsername(username);
        if (!user) return null;
        return user.buildWebFinger();
    }
}

