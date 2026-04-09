import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NodeInfoDocument, NodeInfoLinks, WebFingerDocument } from './fediverse.types';
import { WellKnownService } from './well-known.service';

/**
 * Handles ActivityPub-specific logic: actor lookup, WebFinger resolution.
 * Well-known document building lives in WellKnownService.
 */
@Injectable()
export class FediverseService implements OnModuleInit {
    private readonly logger = new Logger(FediverseService.name);

    constructor(
        private readonly wellKnown: WellKnownService,
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
     * Look up an actor by resource URI.
     * Returns null when no actor matches (caller should respond 404).
     * Extend this method once Actor entities are implemented.
     *
     * @param _resource - e.g. "acct:alice@example.com" or a URL
     * @returns WebFingerDocument or null
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    findWebFinger(_resource: string): WebFingerDocument | null {
        // TODO: resolve actors from database
        return null;
    }
}

