import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { WellKnownService } from '../well-known.service';
import { UsersService } from '../../users/users.service';
import type {
    APActor, APCreate, APFollow, APAccept, APReject,
    APOrderedCollection, APCollectionPage, APObject,
} from './activitypub.types';
import { AP_CONTEXT } from './activitypub.types';

/** Inbox callback: fired when an ActivityPub activity is received. */
export type InboxHandler = (activity: APObject, sender: APActor) => Promise<void>;

/** Outbox activity registry — stores activities for actor outboxes. */
interface OutboxEntry {
    actorId: string;
    activity: APObject;
    createdAt: Date;
}

@Injectable()
export class ActivityPubService {
    private readonly logger = new Logger(ActivityPubService.name);

    /** In-memory outbox store (replace with DB in production). */
    private readonly outbox: OutboxEntry[] = [];
    /** In-memory inbox handler registry. */
    private readonly inboxHandlers: InboxHandler[] = [];

    constructor(
        private readonly wellKnown: WellKnownService,
        @Inject(forwardRef(() => UsersService))
        private readonly users: UsersService,
    ) { }

    // ── Actor building ──────────────────────────────────────────────────────
    // Moved to User.buildActor() in user.model.ts — use UsersService.findByUsername()

    // ── Outbox ──────────────────────────────────────────────────────────────

    /** Add an activity to an actor's outbox. */
    async addToOutbox(actorId: string, activity: APObject): Promise<void> {
        this.outbox.push({ actorId, activity, createdAt: new Date() });
        this.logger.debug(`Outbox: ${activity.type} added for ${actorId}`);
    }

    /** Get the outbox collection for an actor. */
    async getOutbox(actorId: string, page?: number): Promise<APOrderedCollection | APCollectionPage> {
        const domain = await this.wellKnown.address();
        const baseUrl = `${await this.wellKnown.activityPubUrl()}u/${actorId}/outbox`;
        const entries = this.outbox.filter(e => e.actorId === actorId);

        if (page !== undefined) {
            const limit = 20;
            const start = page * limit;
            const items = entries.slice(start, start + limit).map(e => e.activity);
            return {
                '@context': AP_CONTEXT,
                id: `${baseUrl}?page=${page}`,
                type: 'OrderedCollectionPage',
                partOf: baseUrl,
                orderedItems: items,
            };
        }

        return {
            '@context': AP_CONTEXT,
            id: baseUrl,
            type: 'OrderedCollection',
            totalItems: entries.length,
            first: `${baseUrl}?page=0`,
            last: `${baseUrl}?page=${Math.max(0, Math.ceil(entries.length / 20) - 1)}`,
        };
    }

    // ── Inbox ───────────────────────────────────────────────────────────────

    /** Register an inbox handler. */
    onInboxActivity(handler: InboxHandler): void {
        this.inboxHandlers.push(handler);
    }

    /** Process an incoming activity delivered to an actor's inbox. */
    async processInbox(actorId: string, activity: APObject): Promise<void> {
        this.logger.log(`Inbox: ${activity.type} for ${actorId} from ${(activity as any).actor}`);

        // Auto-accept Follow activities
        if (activity.type === 'Follow') {
            await this.handleFollow(actorId, activity as APFollow);
            return;
        }

        // Notify all registered handlers
        for (const handler of this.inboxHandlers) {
            try {
                const sender = await this.resolveActor((activity as any).actor);
                if (sender) await handler(activity, sender);
            } catch (e) {
                this.logger.error(`Inbox handler error: ${e}`);
            }
        }
    }

    // ── Follow handling ─────────────────────────────────────────────────────

    private async handleFollow(targetUsername: string, follow: APFollow): Promise<void> {
        const user = await this.users.findByUsername(targetUsername);
        if (!user) {
            this.logger.warn(`Follow target not found: ${targetUsername}`);
            return;
        }

        const senderId = typeof follow.actor === 'string' ? follow.actor : follow.actor.id;
        const targetActor = await user.buildActor();

        // Auto-accept: send Accept back to sender
        const accept: APAccept = {
            '@context': AP_CONTEXT,
            id: `${targetActor.id}/activities/${Date.now()}`,
            type: 'Accept',
            actor: targetActor.id,
            object: follow,
        };

        await this.addToOutbox(targetUsername, accept);
        // TODO: POST the Accept to the sender's inbox
        this.logger.log(`Accepted follow from ${senderId} for ${targetUsername}`);
    }

    // ── HTTP Signatures ─────────────────────────────────────────────────────

    // TODO: Implement HTTP Signature verification for incoming activities
    // TODO: Implement HTTP Signature generation for outgoing activities

    // ── Actor resolution ────────────────────────────────────────────────────

    private async resolveActor(actorId: string): Promise<APActor | null> {
        try {
            const url = new URL(actorId);
            // Local actor
            if (url.hostname === await this.wellKnown.address()) {
                const pathParts = url.pathname.split('/').filter(Boolean);
                // Handle both /ap/u/username and /u/username formats
                if (pathParts[0] === 'ap' && pathParts[1] === 'u' && pathParts[2]) {
                    const user = await this.users.findByUsername(pathParts[2]);
                    if (user) return user.buildActor();
                } else if (pathParts[0] === 'u' && pathParts[1]) {
                    const user = await this.users.findByUsername(pathParts[1]);
                    if (user) return user.buildActor();
                }
            }
            // TODO: Remote actor resolution via HTTP fetch
            return null;
        } catch {
            return null;
        }
    }

    // ── Followers / Following collections ───────────────────────────────────

    async getFollowers(actorId: string): Promise<APOrderedCollection> {
        const domain = await this.wellKnown.address();
        const baseUrl = `${await this.wellKnown.activityPubUrl()}u/${actorId}/followers`;
        return {
            '@context': AP_CONTEXT,
            id: baseUrl,
            type: 'OrderedCollection',
            totalItems: 0,
            first: `${baseUrl}?page=0`,
        };
    }

    async getFollowing(actorId: string): Promise<APOrderedCollection> {
        const domain = await this.wellKnown.address();
        const baseUrl = `${await this.wellKnown.activityPubUrl()}u/${actorId}/following`;
        return {
            '@context': AP_CONTEXT,
            id: baseUrl,
            type: 'OrderedCollection',
            totalItems: 0,
            first: `${baseUrl}?page=0`,
        };
    }
}
