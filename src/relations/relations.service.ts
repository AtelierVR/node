import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { UserRelationType } from 'src/generated/prisma/enums';
import { WellKnownService } from '../fediverse/well-known.service';
import { UsersService } from '../users/users.service';
import { ExternalServersService } from '../external/external-servers.service';
import { UserWithMethods } from '../users/user.model';
import { S2SRelationDto } from './relations.types';
import { ApiErrorCode } from '../api/api-error.factory';
import { ApiException } from '../api/api-exception';
import { ApiUserRelations } from '../users/users.types';
import { NoxIdentifier } from '../common/identifier';
import { Relation, RELATION_TYPES, RelationWithMethods } from './relation.model';
import { ExternalUsersService } from 'src/external/external-users.service';

@Injectable()
export class RelationsService {
    constructor(
        private readonly prisma: PrismaService,
        public readonly wellKnown: WellKnownService,
        @Inject(forwardRef(() => UsersService))
        private readonly users: UsersService,
        private readonly externalServers: ExternalServersService,
        private readonly externalUsers: ExternalUsersService,
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
        const [out, inn] = await Promise.all([
            this.findRelation(user.identifier(), viewer),
            this.findRelation(viewer, user.identifier()),
        ]);
        return {
            out: out ? RELATION_TYPES[out.type] : null,
            in: inn ? RELATION_TYPES[inn.type] : null
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

        if (initiator.identifier() === userTarget)
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

            if (targetUser)
                requiresRequest = (targetUser.tags ?? []).includes('manual_follow');

            const type = requiresRequest ? UserRelationType.REQUEST : UserRelationType.FOLLOW;
            return Relation.attach(await this.prisma.userRelations.create({
                data: { initiatorRef: initiator.identifier().toString(), targetRef: targetUser.identifier().toString(), type },
            }), this);
        }

        // Remote target — create local REQUEST first, then sync via S2S
        const rel = Relation.attach(await this.prisma.userRelations.create({
            data: { initiatorRef: initiator.identifier().toString(), targetRef: userTarget.toString(), type: UserRelationType.REQUEST },
        }), this);

        await this._syncS2S(userTarget, {
            initiator: initiator.id,
            target: userTarget.numericId!,
            type: 'follow',
        });

        return rel;
    }

    async unfollow(initiator: UserWithMethods, target: NoxIdentifier): Promise<void> {
        let userTarget: NoxIdentifier;

        if (target.isLocal(await this.wellKnown.address())) {
            const targetUser = await this.users.findByIdentifier(target);
            if (!targetUser) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Target user');
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

        // Sync unfollow to remote server if target is remote
        const domain = await this.wellKnown.address();
        if (!userTarget.isLocal(domain) && userTarget.numericId !== null)
            await this._syncS2S(userTarget, {
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
        const request = await this.findRelation(initiator, responder.identifier());
        if (!request || request.type !== UserRelationType.REQUEST)
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Follow request');

        await this.prisma.userRelations.delete({
            where: {
                initiatorRef_targetRef: {
                    initiatorRef: initiator.toString(),
                    targetRef: responder.identifier().toString()
                }
            },
        });

        if (!accept) {
            await this._notifyS2SResponse(initiator, responder.id, false)
            return Relation.attach(request, this);
        }

        const follow = await this.prisma.userRelations.create({
            data: { initiatorRef: initiator.toString(), targetRef: responder.identifier().toString(), type: UserRelationType.FOLLOW },
        });

        await this._notifyS2SResponse(initiator, responder.id, true);
        return Relation.attach(follow, this);
    }

    // ── S2S incoming ─────────────────────────────────────────────────────────────

    async s2sSync(address: string, dto: S2SRelationDto): Promise<void> {
        const domain = await this.wellKnown.address();
        const initiator = new NoxIdentifier(null, String(dto.initiator), address);
        const target = new NoxIdentifier(null, String(dto.target));

        switch (dto.type) {
            case 'follow': {
                const targetUser = await this.users.findById(dto.target);
                if (!targetUser) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Target user');
                const requiresRequest = (targetUser.tags ?? []).includes('manual_follow');
                const existing = await this.findRelation(initiator, target);
                if (existing) return; // idempotent
                await this.prisma.userRelations.create({
                    data: {
                        initiatorRef: initiator.toString(),
                        targetRef: target.toString(),
                        type: requiresRequest ? UserRelationType.REQUEST : UserRelationType.FOLLOW,
                    },
                });
                break;
            }
            case 'unfollow': {
                await this.prisma.userRelations.deleteMany({
                    where: {
                        initiatorRef: initiator.toString(),
                        targetRef: target.toString()
                    },
                });
                break;
            }
            case 'follow_accept': {
                // Remote accepted our follow request → upgrade REQUEST → FOLLOW
                const localInitiator = new NoxIdentifier(null, String(dto.target));
                const remoteTarget = new NoxIdentifier(null, String(dto.initiator), address);
                await this.prisma.userRelations.updateMany({
                    where: {
                        initiatorRef: localInitiator.toString(),
                        targetRef: remoteTarget.toString(),
                        type: UserRelationType.REQUEST
                    },
                    data: { type: UserRelationType.FOLLOW },
                });
                break;
            }
            case 'follow_refuse': {
                const localInitiator = new NoxIdentifier(null, String(dto.target));
                const remoteTarget = new NoxIdentifier(null, String(dto.initiator), address);
                await this.prisma.userRelations.deleteMany({
                    where: {
                        initiatorRef: localInitiator.toString(),
                        targetRef: remoteTarget.toString(),
                        type: UserRelationType.REQUEST
                    },
                });
                break;
            }
        }
    }

    // ── S2S outgoing helpers ──────────────────────────────────────────────────────

    private async _syncS2S(target: NoxIdentifier, dto: S2SRelationDto): Promise<void> {
        if (!target.server || target.server === NoxIdentifier.LOCALSERVER) return;
        const server = await this.externalServers.discover(target.server);
        await server.fetch('/api/relations', {
            method: 'POST',
            body: JSON.stringify(dto),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    private async _notifyS2SResponse(initiator: NoxIdentifier, responderId: number, accept: boolean): Promise<void> {
        if (!initiator.server || initiator.server === NoxIdentifier.LOCALSERVER) return;
        if (initiator.numericId === null) return;
        const dto: S2SRelationDto = {
            initiator: responderId,
            target: initiator.numericId,
            type: accept ? 'follow_accept' : 'follow_refuse',
        };
        await this._syncS2S(initiator, dto);
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
}
