import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import type {
  NodeInfoDocument,
  NodeInfoLinks,
  WebFingerDocument,
} from './fediverse.types';
import { WellKnownService } from './well-known.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../database/prisma.service';
import { getAssetControllerTypes } from '../assets/asset-controller.registry';

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
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.logger.log('FediverseService initialized');
  }

  /**
   * Build the NodeInfo links document for this instance.
   * @returns NodeInfoLinks
   */
  async nodeInfoLinks(): Promise<NodeInfoLinks> {
    const base = await this.wellKnown.webBaseUrl();
    return {
      links: [
        {
          rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
          href: new URL('nodeinfo/2.1', base).toString(),
        },
        {
          rel: 'nox/1.0',
          href: new URL('.well-known/nox', base).toString(),
        },
      ],
    };
  }

  /**
   * Build the NodeInfo 2.1 document for this instance — the software, the
   * protocols, the registration policy, the real usage counters (accounts, and
   * accounts used in the last month / half-year) and the Nox content counters.
   * @returns NodeInfoDocument
   */
  async nodeInfoDocument(): Promise<NodeInfoDocument> {
    const [users, assets, instances] = await Promise.all([
      this.users.usageStatistics(),
      this.assetCounts(),
      this.prisma.instances.count(),
    ]);

    return {
      version: '2.1',
      software: this.wellKnown.software,
      protocols: this.wellKnown.protocols,
      // Nothing is federated through a feed or a bridge: ActivityPub is handled
      // by the endpoints themselves.
      services: { inbound: [], outbound: [] },
      usage: {
        users,
        // Nox has no timeline: there is no local post to count.
        localPosts: 0,
      },
      openRegistrations: await this.wellKnown.openRegistrations(),
      metadata: { assets, instances },
    };
  }

  /**
   * Number of assets declared on this instance, per registered type
   * (`world`, `avatar`, `mod`…) — the NodeInfo `metadata` counters.
   */
  private async assetCounts(): Promise<Record<string, number>> {
    const grouped = await this.prisma.assets.groupBy({
      by: ['type'],
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const type of getAssetControllerTypes()) counts[type] = 0;
    for (const row of grouped) counts[row.type] = row._count._all;
    return counts;
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
      if (
        (pathParts[0] === 'u' ||
          (pathParts[0] === 'ap' && pathParts[1] === 'u')) &&
        pathParts[pathParts.length - 1]
      ) {
        const username = pathParts[0] === 'u' ? pathParts[1] : pathParts[2];
        return this.buildWebFingerForUsername(username);
      }
    } catch {
      /* invalid URL */
    }

    return null;
  }

  private async buildWebFingerForUsername(
    username: string,
  ): Promise<WebFingerDocument | null> {
    const user = await this.users.findByUsername(username);
    if (!user) return null;
    return user.buildWebFinger();
  }
}
