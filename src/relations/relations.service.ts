import { Injectable, forwardRef, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { UserRelationType } from 'src/generated/prisma/enums';
import { WellKnownService } from '../fediverse/well-known.service';
import { UsersService } from '../users/users.service';
import { ExternalServersService } from '../external/external-servers.service';
import { UserWithMethods } from '../users/user.model';
import { S2SRelationDto, S2SRelationResponseDto } from './relations.types';
import { ApiErrorCode } from '../api/api-error.factory';
import { ApiException } from '../api/api-exception';
import { ApiUserRelations } from '../users/users.types';
import { NoxIdentifier } from '../common/identifier';
import { Relation, RELATION_TYPES, RelationWithMethods } from './relation.model';
import { ExternalUsersService } from 'src/external/external-users.service';
import { EventsService } from '../gateway/events.service';

@Injectable()
export class RelationsService {
    private readonly logger = new Logger(RelationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        public readonly wellKnown: WellKnownService,
        @Inject(forwardRef(() => UsersService))
        private readonly users: UsersService,
        private readonly externalServers: ExternalServersService,
        private readonly externalUsers: ExternalUsersService,
        private readonly events: EventsService,
    ) { }

    // ── Queries ──────────────────────────────────────────────────────────────────

    async findRelation(initiator: NoxIdentifier, target: NoxIdentifier): Promise<RelationWithMethods | null> {
        let rel = await this.prisma.userRelations.findUnique({
            where: {
                initiatorRef_targetRef: {
                    initiatorRef: initiator.toString(),
                    targetRef: target.toString()
                }
            },
        });
        return rel ? Relation.attach(rel, this) : null;
    }

    async getFollowingCount(user: UserWithMethods): Promise<number> {
        return this.prisma.userRelations.count({
            where: { initiatorRef: user.identifier().toString(), type: UserRelationType.FOLLOW },
        });
    }

    async getFollowersCount(user: UserWithMethods): Promise<number> {
        return this.prisma.userRelations.count({
            where: { targetRef: user.identifier().toString(), type: UserRelationType.FOLLOW },
        });
    }

    async getRelationBetween(user: UserWithMethods, viewer: NoxIdentifier): Promise<ApiUserRelations> {
        const [viewerToUser, userToViewer] = await Promise.all([
            this.findRelation(viewer, user.identifier()),
            this.findRelation(user.identifier(), viewer),
        ]);
        return {
            out: viewerToUser ? RELATION_TYPES[viewerToUser.type] : null,
            in: userToViewer ? RELATION_TYPES[userToViewer.type] : null
        };
    }

    // ── Mutations ─────────────────────────────────────────────────────────────────

    async follow(initiator: UserWithMethods, target: NoxIdentifier): Promise<RelationWithMethods> {
        let userTarget: NoxIdentifier;

        if (target.isLocal(await this.wellKnown.address())) {
            const localTarget = await this.users.findByIdentifier(target);
            if (!localTarget) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Target user');
            userTarget = localTarget.identifier();
        } else {
            let externalTarget = await this.externalUsers.findOrDiscover(target);
            if (!externalTarget) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Target user');
            userTarget = await externalTarget.identifier();
        }

        if (initiator.identifier().equals(userTarget, false))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Cannot follow yourself');

        const existing = await this.findRelation(initiator.identifier(), userTarget);
        if (existing)
            throw new ApiException(ApiErrorCode.CONFLICT, null, 'Relation');

        const domain = await this.wellKnown.address();
        const isLocalTarget = userTarget.isLocal(domain);
        let requiresRequest = false;

        if (isLocalTarget) {
            const targetUser = await this.users.findByIdentifier(userTarget);
            if (!targetUser) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Target user');

            if (targetUser.isAutoRejectFollow())
                throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'This user does not accept follow requests');

            if (targetUser)
                requiresRequest = targetUser.isManualFollowApproval();

            const type = requiresRequest ? UserRelationType.REQUEST : UserRelationType.FOLLOW;
            const rel = Relation.attach(await this.prisma.userRelations.create({
                data: { initiatorRef: initiator.identifier().toString(), targetRef: targetUser.identifier().toString(), type },
            }), this);

            const relType = RELATION_TYPES[type];
            const reverseRel = await this.findRelation(targetUser.identifier(), initiator.identifier());
            const reverseType = reverseRel ? RELATION_TYPES[reverseRel.type] : null;
            this.events.emitToUser(initiator.id, 'user:relation', { user: targetUser.identifier().toString(domain), out: relType, in: reverseType });
            this.events.emitToUser(targetUser.id, 'user:relation', { user: initiator.identifier().toString(domain), out: reverseType, in: relType });

            return rel;
        }

        // Remote target — sync to Server B first, only create local REQUEST if accepted
        const result = await this._syncS2S(userTarget.server, {
            initiator: initiator.id,
            target: userTarget.numericId!,
            type: 'follow',
        });

        if (!result.ok) 
            throw new ApiException(
                ApiErrorCode.EXTERNAL_SERVER_ERROR,
                null,
                `Remote server refused the follow: ${result.error}`,
            );

        const rel = Relation.attach(await this.prisma.userRelations.create({
            data: { 
                initiatorRef: initiator.identifier().toString(), 
                targetRef: userTarget.toString(), 
                type: UserRelationType.FOLLOW
            }
        }), this);

        return rel;
    }

    async unfollow(initiator: UserWithMethods, target: NoxIdentifier): Promise<void> {
        let userTarget: NoxIdentifier;
        let localTargetUser: UserWithMethods | null = null;

        if (target.isLocal(await this.wellKnown.address())) {
            const targetUser = await this.users.findByIdentifier(target);
            if (!targetUser) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Target user');
            localTargetUser = targetUser;
            userTarget = targetUser.identifier();
        } else {
            let externalTarget = await this.externalUsers.findOrDiscover(target);
            if (!externalTarget) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Target user');
            userTarget = await externalTarget.identifier();
        }

        const existing = await this.findRelation(initiator.identifier(), userTarget);
        if (!existing)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Relation');

        await this.prisma.userRelations.delete({
            where: {
                initiatorRef_targetRef: {
                    initiatorRef: initiator.identifier().toString(),
                    targetRef: userTarget.toString()
                }
            },
        });

        if (localTargetUser) {
            const unfollowDomain = await this.wellKnown.address();
            const reverseRel = await this.findRelation(localTargetUser.identifier(), initiator.identifier());
            const reverseType = reverseRel ? RELATION_TYPES[reverseRel.type] : null;
            this.events.emitToUser(initiator.id, 'user:relation', { user: localTargetUser.identifier().toString(unfollowDomain), out: null, in: reverseType });
            this.events.emitToUser(localTargetUser.id, 'user:relation', { user: initiator.identifier().toString(unfollowDomain), out: reverseType, in: null });
        }

        // Sync unfollow to remote server if target is remote
        const domain = await this.wellKnown.address();
        if (!userTarget.isLocal(domain) && userTarget.numericId !== null)
            await this._syncS2S(userTarget.server, {
                initiator: initiator.id,
                target: userTarget.numericId,
                type: 'unfollow',
            });
    }

    async respondToRequest(
        responder: UserWithMethods,
        initiator: NoxIdentifier,
        accept: boolean,
    ): Promise<RelationWithMethods> {
        // Strip type prefix to ensure correct database format
        initiator = NoxIdentifier.type(null, initiator);
        
        const request = await this.findRelation(initiator, responder.identifier());
        if (!request || request.type !== UserRelationType.REQUEST)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Follow request');

        const respondDomain = await this.wellKnown.address();

        await this.prisma.userRelations.delete({
            where: {
                initiatorRef_targetRef: {
                    initiatorRef: initiator.toString(),
                    targetRef: responder.identifier().toString()
                }
            },
        });

        if (!accept) {
            const initiatorUser = await this.users.findByIdentifier(initiator);
            if (initiatorUser) {
                const reverseRel = await this.findRelation(responder.identifier(), initiatorUser.identifier());
                const reverseType = reverseRel ? RELATION_TYPES[reverseRel.type] : null;
                this.events.emitToUser(initiatorUser.id, 'user:relation', { user: responder.identifier().toString(respondDomain), out: null, in: reverseType });
                this.events.emitToUser(responder.id, 'user:relation', { user: initiatorUser.identifier().toString(respondDomain), out: reverseType, in: null });
            }
            await this._notifyS2SResponse(initiator, responder.id, false);
            return Relation.attach(request, this);
        }

        const follow = await this.prisma.userRelations.create({
            data: { initiatorRef: initiator.toString(), targetRef: responder.identifier().toString(), type: UserRelationType.FOLLOW },
        });

        const initiatorUser = await this.users.findByIdentifier(initiator);
        if (initiatorUser) {
            const reverseRel = await this.findRelation(responder.identifier(), initiatorUser.identifier());
            const reverseType = reverseRel ? RELATION_TYPES[reverseRel.type] : null;
            this.events.emitToUser(initiatorUser.id, 'user:relation', { user: responder.identifier().toString(respondDomain), out: 'follow', in: reverseType });
            this.events.emitToUser(responder.id, 'user:relation', { user: initiatorUser.identifier().toString(respondDomain), out: reverseType, in: 'follow' });
        }

        await this._notifyS2SResponse(initiator, responder.id, true);
        return Relation.attach(follow, this);
    }

    /**
     * Applies a follow policy to every pending request targeting `user`:
     * `accept` turns them into follows, `refuse` drops them. Used when the account
     * switches to an auto-accept or an auto-refuse policy.
     *
     * Best-effort: one failing request does not abort the others.
     */
    async applyFollowPolicy(user: UserWithMethods, policy: 'accept' | 'refuse'): Promise<number> {
        const pending = await this.prisma.userRelations.findMany({
            where: { targetRef: user.identifier().toString(), type: UserRelationType.REQUEST },
            select: { initiatorRef: true },
        });

        let resolved = 0;
        for (const rel of pending)
            try {
                await this.respondToRequest(user, NoxIdentifier.parse(rel.initiatorRef), policy === 'accept');
                resolved++;
            } catch (err) {
                this.logger.warn(`Failed to apply follow policy to ${rel.initiatorRef}: ${(err as Error).message}`);
            }
        return resolved;
    }

    /**
     * Drop every relation involving `userId` (both directions) and notify the
     * affected local users so their follow/friend lists update live.
     *
     * Relations are stored by NoxIdentifier string refs (no FK), so nothing
     * cascades when an account is deleted — this must be called explicitly.
     * The remote servers that still hold these relations are notified too (best-effort).
     */
    async purgeUserRelations(userId: number): Promise<void> {
        // Local users are stored as exactly `<id>@::` (NoxIdentifier.LOCALSERVER) —
        // an exact match, so we never touch a remote user sharing the same numeric id.
        const localRef = `${userId}@${NoxIdentifier.LOCALSERVER}`;
        const rows = await this.purgeRefRelations(localRef);
        if (!rows.length) return;

        // Best-effort: mirror the removal on the remote servers. Each remote peer is told
        // both directions — our user no longer follows it, and it no longer follows us.
        const domain = await this.wellKnown.address();
        const peers = new Map<string, Set<number>>();

        for (const row of rows) {
            // The counterpart of a relation is whichever side is not the local user.
            const counterpartRef = row.initiatorRef === localRef ? row.targetRef : row.initiatorRef;
            const counterpart = NoxIdentifier.parse(counterpartRef);
            if (counterpart.isLocal(domain) || !counterpart.server || counterpart.numericId === null) continue;

            const ids = peers.get(counterpart.server) ?? new Set<number>();
            ids.add(counterpart.numericId);
            peers.set(counterpart.server, ids);
        }

        for (const [server, ids] of peers)
            for (const remoteId of ids) {
                await this._syncS2S(server, { initiator: userId, target: remoteId, type: 'unfollow' });
                await this._syncS2S(server, { initiator: userId, target: remoteId, type: 'unfollow_reverse' });
            }
    }

    /**
     * Delete every relation referencing `ref` (exact match, both directions) and
     * notify the affected **local** users so their follow/friend lists update live.
     * Returns the deleted rows so callers can fan out to remote servers.
     */
    private async purgeRefRelations(ref: string): Promise<{ initiatorRef: string; targetRef: string }[]> {
        const rows = await this.prisma.userRelations.findMany({
            where: { OR: [{ initiatorRef: ref }, { targetRef: ref }] },
            select: { initiatorRef: true, targetRef: true },
        });
        if (!rows.length) return [];

        await this.prisma.userRelations.deleteMany({
            where: { OR: [{ initiatorRef: ref }, { targetRef: ref }] },
        });

        const domain = await this.wellKnown.address();
        const self = NoxIdentifier.parse(ref).toString(domain);

        const notified = new Set<number>();
        for (const row of rows) {
            for (const otherRef of [row.initiatorRef, row.targetRef]) {
                if (otherRef === ref) continue;
                const other = NoxIdentifier.parse(otherRef);
                const otherId = other.numericId;
                if (otherId === null || !other.isLocal(domain) || notified.has(otherId)) continue;
                notified.add(otherId);
                this.events.emitToUser(otherId, 'user:relation', { user: self, out: null, in: null });
            }
        }

        return rows;
    }

    // ── S2S incoming ─────────────────────────────────────────────────────────────

    async s2sSync(address: string, dto: S2SRelationDto): Promise<void> {
        const domain = await this.wellKnown.address();
        const initiator = new NoxIdentifier(null, String(dto.initiator), address);

        switch (dto.type) {
            case 'follow': {
                const targetUser = await this.users.findById(dto.target);
                if (!targetUser) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Target user');
                if (targetUser.isAutoRejectFollow())
                    throw new ApiException(ApiErrorCode.FORBIDDEN, null, 'This user does not accept follow requests');
                const target = targetUser.identifier();
                const requiresRequest = targetUser.isManualFollowApproval();
                const existing = await this.findRelation(initiator, target);
                if (existing) return; // idempotent
                const created = await this.prisma.userRelations.create({
                    data: {
                        initiatorRef: initiator.toString(),
                        targetRef: target.toString(),
                        type: requiresRequest ? UserRelationType.REQUEST : UserRelationType.FOLLOW,
                    },
                });
                // Mirror the local `follow` notification on the target's clients.
                const reverseRel = await this.findRelation(target, initiator);
                const reverseType = reverseRel ? RELATION_TYPES[reverseRel.type] : null;
                this.events.emitToUser(targetUser.id, 'user:relation', {
                    user: initiator.toString(domain),
                    out: reverseType,
                    in: RELATION_TYPES[created.type],
                });
                break;
            }
            case 'unfollow': {
                const targetUser = await this.users.findById(dto.target);
                if (!targetUser) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Target user');
                const target = targetUser.identifier();
                const { count } = await this.prisma.userRelations.deleteMany({
                    where: {
                        initiatorRef: initiator.toString(),
                        targetRef: target.toString()
                    },
                });
                if (count > 0) {
                    const reverseRel = await this.findRelation(target, initiator);
                    const reverseType = reverseRel ? RELATION_TYPES[reverseRel.type] : null;
                    this.events.emitToUser(targetUser.id, 'user:relation', {
                        user: initiator.toString(domain),
                        out: reverseType,
                        in: null,
                    });
                }
                break;
            }
            case 'follow_accept': {
                // Remote accepted our follow request → upgrade REQUEST → FOLLOW
                const localInitiator = new NoxIdentifier(null, String(dto.target));
                const remoteTarget = new NoxIdentifier(null, String(dto.initiator), address);
                const { count } = await this.prisma.userRelations.updateMany({
                    where: {
                        initiatorRef: localInitiator.toString(),
                        targetRef: remoteTarget.toString(),
                        type: UserRelationType.REQUEST
                    },
                    data: { type: UserRelationType.FOLLOW },
                });
                if (count > 0) {
                    const reverseRel = await this.findRelation(remoteTarget, localInitiator);
                    const reverseType = reverseRel ? RELATION_TYPES[reverseRel.type] : null;
                    this.events.emitToUser(dto.target, 'user:relation', {
                        user: remoteTarget.toString(domain),
                        out: 'follow',
                        in: reverseType,
                    });
                }
                break;
            }
            case 'follow_refuse': {
                const localInitiator = new NoxIdentifier(null, String(dto.target));
                const remoteTarget = new NoxIdentifier(null, String(dto.initiator), address);
                const { count } = await this.prisma.userRelations.deleteMany({
                    where: {
                        initiatorRef: localInitiator.toString(),
                        targetRef: remoteTarget.toString(),
                        type: UserRelationType.REQUEST
                    },
                });
                if (count > 0) {
                    const reverseRel = await this.findRelation(remoteTarget, localInitiator);
                    const reverseType = reverseRel ? RELATION_TYPES[reverseRel.type] : null;
                    this.events.emitToUser(dto.target, 'user:relation', {
                        user: remoteTarget.toString(domain),
                        out: null,
                        in: reverseType,
                    });
                }
                break;
            }
            case 'unfollow_reverse': {
                // Mirror of `unfollow`: the receiver's user no longer follows the sender's
                // user `<initiator>@<address>` (e.g. because that account was deleted).
                const targetUser = await this.users.findById(dto.target);
                if (!targetUser) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Target user');
                const target = targetUser.identifier();
                const { count } = await this.prisma.userRelations.deleteMany({
                    where: {
                        initiatorRef: target.toString(),
                        targetRef: initiator.toString(),
                    },
                });
                if (count > 0) {
                    const reverseRel = await this.findRelation(initiator, target);
                    const reverseType = reverseRel ? RELATION_TYPES[reverseRel.type] : null;
                    this.events.emitToUser(targetUser.id, 'user:relation', {
                        user: initiator.toString(domain),
                        out: null,
                        in: reverseType,
                    });
                }
                break;
            }
        }
    }

    // ── S2S outgoing helpers ──────────────────────────────────────────────────────

    private async _syncS2S(address: string | undefined, dto: S2SRelationDto): Promise<{ ok: boolean; error?: string }> {
        if (!address || address === NoxIdentifier.LOCALSERVER) return { ok: true };
        try {
            const server = await this.externalServers.discover(address);
            const res = await server.fetch<S2SRelationResponseDto>('api/relations', {
                method: 'POST',
                body: JSON.stringify(dto),
                headers: { 'Content-Type': 'application/json' },
                responseClass: S2SRelationResponseDto,
            });
            if (res.error) {
                const msg = `[${res.error.code}] ${res.error.message}`;
                this.logger.warn(
                    `S2S ${dto.type} to ${address} ` +
                    `(${dto.initiator}→${dto.target}): ${msg}`,
                );
                return { ok: false, error: msg };
            }
            this.logger.log(
                `S2S ${dto.type} to ${address} ` +
                `(${dto.initiator}→${dto.target}): OK`,
            );
            return { ok: true };
        } catch (err: any) {
            const msg = err?.message ?? String(err);
            this.logger.error(
                `S2S ${dto.type} to ${address} ` +
                `(${dto.initiator}→${dto.target}): ${msg}`,
            );
            return { ok: false, error: msg };
        }
    }

    private async _notifyS2SResponse(initiator: NoxIdentifier, responderId: number, accept: boolean): Promise<void> {
        if (!initiator.server || initiator.server === NoxIdentifier.LOCALSERVER) return;
        if (initiator.numericId === null) return;
        const dto: S2SRelationDto = {
            initiator: responderId,
            target: initiator.numericId,
            type: accept ? 'follow_accept' : 'follow_refuse',
        };
        await this._syncS2S(initiator.server, dto);
    }

    async getFollowing(
        user: UserWithMethods,
        limit: number,
        offset: number,
    ): Promise<RelationWithMethods[]> {
        return (await this.prisma.userRelations.findMany({
            where: { initiatorRef: user.identifier().toString(), type: UserRelationType.FOLLOW },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        })).map(rel => Relation.attach(rel, this));
    }

    async getFollowers(
        user: UserWithMethods,
        limit: number,
        offset: number,
    ): Promise<RelationWithMethods[]> {
        return (await this.prisma.userRelations.findMany({
            where: { targetRef: user.identifier().toString(), type: UserRelationType.FOLLOW },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        })).map(rel => Relation.attach(rel, this));
    }

    async getFriendsCount(user: UserWithMethods): Promise<number> {
        const meRef = user.identifier().toString();
        // Self-join: find mutual follows in a single query.
        // r1 = my outgoing follows, r2 = their follow back to me.
        const result: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS count
             FROM user_relations r1
             JOIN user_relations r2
               ON r1.target_ref = r2.initiator_ref
              AND r2.target_ref = r1.initiator_ref
              AND r2.type = $2::user_relation_type
             WHERE r1.initiator_ref = $1
               AND r1.type = $2::user_relation_type`,
            meRef,
            UserRelationType.FOLLOW,
        );
        return (result[0] as any).count ?? 0;
    }

    async getFriends(
        user: UserWithMethods,
        limit: number,
        offset: number,
    ): Promise<{ total: number; items: Array<{
        out: RelationWithMethods;
        in: RelationWithMethods;
    }> }> {
        const meRef = user.identifier().toString();
        // Self-join: find mutual follows in a single query.
        // r1 = my outgoing follow (out), r2 = their follow back to me (in).
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT r1.id AS out_id, r1.type AS out_type, r1.initiator_ref AS out_initiator,
                    r1.target_ref AS out_target, r1.created_at AS out_created_at,
                    r1.updated_at AS out_updated_at,
                    r2.id AS in_id, r2.type AS in_type, r2.initiator_ref AS in_initiator,
                    r2.target_ref AS in_target, r2.created_at AS in_created_at,
                    r2.updated_at AS in_updated_at
             FROM user_relations r1
             JOIN user_relations r2
               ON r1.target_ref = r2.initiator_ref
              AND r2.target_ref = r1.initiator_ref
              AND r2.type = $4::user_relation_type
             WHERE r1.initiator_ref = $1
               AND r1.type = $4::user_relation_type
             ORDER BY r2.created_at DESC
             LIMIT $2 OFFSET $3`,
            meRef,
            limit,
            offset,
            UserRelationType.FOLLOW,
        );

        // Count the same join (no LIMIT/OFFSET)
        const countResult: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS count
             FROM user_relations r1
             JOIN user_relations r2
               ON r1.target_ref = r2.initiator_ref
              AND r2.target_ref = r1.initiator_ref
              AND r2.type = $2::user_relation_type
             WHERE r1.initiator_ref = $1
               AND r1.type = $2::user_relation_type`,
            meRef,
            UserRelationType.FOLLOW,
        );

        return {
            total: (countResult[0] as any).count ?? 0,
            items: rows.map((r: any) => ({
                out: Relation.attach({
                    id: r.out_id,
                    type: r.out_type,
                    initiatorRef: r.out_initiator,
                    targetRef: r.out_target,
                    createdAt: r.out_created_at,
                    updatedAt: r.out_updated_at,
                }, this),
                in: Relation.attach({
                    id: r.in_id,
                    type: r.in_type,
                    initiatorRef: r.in_initiator,
                    targetRef: r.in_target,
                    createdAt: r.in_created_at,
                    updatedAt: r.in_updated_at,
                }, this),
            })),
        };
    }
}