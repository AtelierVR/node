import { Controller, Get, Post, Delete, Patch, Param, Query, Body, UseGuards, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiWrappedResponse, ApiWrappedArrayResponse, ApiWrappedSuccessResponse, ApiErrorResponse } from '../api/swagger';
import { ApiRelayDto, ApiRunnerInfoDto, RelayAssignedInstanceDto } from './dto/relay-api.dto';
import { RelayService } from './relay.service';
import { RelayGateway } from './relay.gateway';
import { WsGateway } from '../ws/ws.gateway';
import { SendCommandDto } from './dto/send-command.dto';
import { RelayPlayerItemDto, RelayInstanceItemDto, RelayClientItemDto } from './dto/relay-response.dto';
import { RelayLogListApiDto, RelayInstanceApiDto, RelayClientApiDto, RelayPlayerApiDto } from './dto/relay-api.dto';
import { CreateRelayDto, UpdateRelayTagsDto, AssignInstanceDto } from './dto/relay-manage.dto';
import { AdminUserGuard } from '../auth/admin-user.guard';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import type { RelayWithMethods } from './relay.model';
import { NoxIdentifier } from 'src/common/identifier';
import { InstancesService } from '../instances/instances.service';

@ApiTags('Relay')
@Controller('relays')
export class RelayController {
    constructor(
        private readonly relay: RelayService,
        private readonly gateway: RelayGateway,
        @Inject(forwardRef(() => WsGateway))
        private readonly wsGateway: WsGateway,
        @Inject(forwardRef(() => InstancesService))
        private readonly instances: InstancesService,
    ) { }

    // ── List ──────────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'List relays', description: 'Return all registered relay processes. Admin only.' })
    @ApiWrappedArrayResponse(ApiRelayDto)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get()
    async list() {
        const relays = await this.relay.findAll();
        return Promise.all(relays.map(r => r.serialize()));
    }

    // ── Create ────────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Create relay', description: 'Register a new relay with optional label, provider, and tags. Admin only.' })
    @ApiWrappedResponse(ApiRelayDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Post()
    async create(@Body() body: CreateRelayDto) {
        const r = await this.relay.create({
            label: body.label,
            provider: body.provider,
            tags: body.tags,
        });
        return await r.serialize();
    }

    // ── Get one ───────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Get relay', description: 'Return a single relay by ID. Admin only.' })
    @ApiWrappedResponse(ApiRelayDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get(':id')
    async getOne(@Param('id') rawId: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) 
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const r = await this.relay.findById(id);
        if (!r) 
            throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        return await r.serialize();
    }

    // ── Runner info ───────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Get runner info', description: 'Return runtime info from the underlying provider (Docker container state, etc.). Admin only.' })
    @ApiWrappedResponse(ApiRunnerInfoDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get(':id/runner')
    async getRunnerInfo(@Param('id') rawId: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        const info = await this.relay.getRunnerInfo(id);
        return {
            provider_id: info.providerId,
            status: info.status,
            started_at: info.startedAt?.toISOString() ?? null,
            meta: info.meta,
        };
    }

    // ── Logs ──────────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Get relay logs', description: 'Return recent log lines from the relay process (relay must be connected). Admin only.' })
    @ApiWrappedResponse(RelayLogListApiDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get(':id/logs')
    async getLogs(
        @Param('id') rawId: string,
        @Query('since') rawSince?: string,
        @Query('limit') rawLimit?: string,
    ) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const since = rawSince ? parseInt(rawSince, 10) : undefined;
        const limit = rawLimit ? Math.min(parseInt(rawLimit, 10) || 100, 1000) : 100;

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        if (!this.relay.isRelayConnected(id))
            throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay is not connected');

        const logs = await this.wsGateway.requestLogs(id, since, limit);
        if (!logs) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay did not respond');

        return logs;
    }

    // ── Live instances (from relay) ────────────────────────────────────────────────

    @ApiOperation({ summary: 'Get relay live instances', description: 'List active instances reported by the relay process in real-time. Admin only.' })
    @ApiWrappedArrayResponse(RelayInstanceApiDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get(':id/live')
    async getInstances(
        @Param('id') rawId: string,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const limit = Math.min(parseInt(rawLimit ?? '100', 10) || 100, 1000);
        const offset = Math.max(parseInt(rawOffset ?? '0', 10) || 0, 0);

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        if (!this.relay.isRelayConnected(id))
            throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay is not connected');

        const result = await this.wsGateway.requestInstances(id, limit, offset);
        if (!result) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay did not respond');

        return { total: result.total, limit, offset, items: result.instances.map(i => plainToInstance(RelayInstanceItemDto, i).normalize()) };
    }

    // ── Assigned instances (DB) ───────────────────────────────────────────────────

    @ApiOperation({ summary: 'List assigned instances', description: 'Return the DB instances assigned to this relay (not live relay state). Admin only.' })
    @ApiWrappedArrayResponse(RelayAssignedInstanceDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get(':id/instances')
    async getAssignedInstances(@Param('id') rawId: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        const items = await this.relay.getAssignedInstances(id);
        const adress = await this.relay.address();

        // Enrich with relay-internal slot number when relay is online
        const slotMap = new Map<number, number>(); // dbId → relay slot
        if (this.relay.isRelayConnected(id)) {
            try {
                const liveResult = await this.wsGateway.requestInstances(id, 1000, 0);
                if (liveResult) {
                    for (const inst of liveResult.instances) {
                        const dto = plainToInstance(RelayInstanceItemDto, inst);
                        const slot = Number(dto.i ?? dto.id ?? -1);
                        const dbId = Number(dto.n ?? dto.internal_id ?? 0);
                        if (dbId > 0 && slot >= 0) slotMap.set(dbId, slot);
                    }
                }
            } catch { /* relay unavailable */ }
        }

        return {
            total: items.length,
            items: items.map(i => ({
                id: i.id,
                internal_id: slotMap.get(i.id) ?? null,
                name: i.name,
                title: i.title ?? null,
                world: NoxIdentifier.type(null, i.worldRef).toString(adress),
                owner: NoxIdentifier.type(null, i.ownerRef).toString(adress),
                capacity: i.capacity,
                created_at: i.createdAt.getTime()
            })),
        };
    }

    // ── Assign instance to relay ──────────────────────────────────────────────────

    @ApiOperation({ summary: 'Assign instance', description: 'Assign a node instance to this relay for hosting. Admin only.' })
    @ApiWrappedSuccessResponse(HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Post(':id/assign')
    async assignInstance(@Param('id') rawId: string, @Body() body: AssignInstanceDto) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        const ok = await this.relay.assignInstance(id, body.instance_id);
        if (!ok) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${body.instance_id})`);

        return { success: true };
    }

    // ── Unassign instance from relay ──────────────────────────────────────────────

    @ApiOperation({ summary: 'Unassign instance', description: 'Remove a relay assignment from an instance. Admin only.' })
    @ApiWrappedSuccessResponse()
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Delete(':id/assign/:instanceId')
    async unassignInstance(@Param('id') rawId: string, @Param('instanceId') rawIid: string) {
        const id = parseInt(rawId, 10);
        const instanceId = parseInt(rawIid, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');
        if (!Number.isFinite(instanceId)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid instance ID');

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        const ok = await this.relay.unassignInstance(instanceId);
        if (!ok) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${instanceId})`);

        return { success: true };
    }

    // ── Update tags ───────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Update relay tags', description: 'Replace the tag list on a relay (used for instance-assignment routing). Admin only.' })
    @ApiWrappedSuccessResponse()
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Patch(':id/tags')
    async updateTags(@Param('id') rawId: string, @Body() body: UpdateRelayTagsDto) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const updated = await this.relay.updateTags(id, body.tags);
        if (!updated) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        return { success: true };
    }

    // ── Clients ───────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Get relay clients', description: 'List connected clients reported by the relay process. Admin only.' })
    @ApiWrappedArrayResponse(RelayClientApiDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get(':id/clients')
    async getClients(
        @Param('id') rawId: string,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const limit = Math.min(parseInt(rawLimit ?? '100', 10) || 100, 1000);
        const offset = Math.max(parseInt(rawOffset ?? '0', 10) || 0, 0);

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        if (!this.relay.isRelayConnected(id))
            throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay is not connected');

        const result = await this.wsGateway.requestClients(id, limit, offset);
        if (!result) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay did not respond');

        return { total: result.total, limit, offset, items: result.clients.map(c => plainToInstance(RelayClientItemDto, c).normalize()) };
    }

    // ── Instance by relay slot ────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Get relay instance', description: 'Get full instance data by relay-internal slot number. Admin only.' })
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get(':id/instances/:iid')
    async getRelayInstance(@Param('id') rawId: string, @Param('iid') iid: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        if (!this.relay.isRelayConnected(id))
            throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay is not connected');

        const liveResult = await this.wsGateway.requestInstances(id, 1000, 0);
        if (!liveResult) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay did not respond');

        const liveInst = liveResult.instances
            .map((i: unknown) => plainToInstance(RelayInstanceItemDto, i))
            .find((i: RelayInstanceItemDto) => String(i.i ?? i.id) === iid);
        if (!liveInst) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${iid})`);

        const dbId = Number((liveInst as RelayInstanceItemDto).n ?? (liveInst as RelayInstanceItemDto).internal_id ?? 0);
        if (!dbId) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${iid}): no DB mapping`);

        const instance = await this.instances.findById(dbId);
        if (!instance) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${dbId})`);

        return this.instances.serialize(instance);
    }

    // ── Players in instance ───────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Get instance players', description: 'List players in a specific instance on the relay. Admin only.' })
    @ApiWrappedArrayResponse(RelayPlayerApiDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get(':id/instances/:iid/players')
    async getInstancePlayers(@Param('id') rawId: string, @Param('iid') iid: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        if (!this.relay.isRelayConnected(id))
            throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay is not connected');

        const result = await this.wsGateway.requestInstances(id, 1000, 0);
        if (!result) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay did not respond');

        const instance = result.instances
            .map(i => plainToInstance(RelayInstanceItemDto, i))
            .find(i => String(i.i ?? i.id) === iid);
        if (!instance) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${iid})`);

        const slotId = Number(instance.i ?? instance.id ?? 0);
        const playersResult = await this.wsGateway.requestPlayers(id, slotId, 1000, 0, true);
        if (!playersResult) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay did not respond');

        const players = playersResult.i.map((p: unknown) =>
            plainToInstance(RelayPlayerItemDto, p).normalize()
        );

        return { total: players.length, items: players };
    }

    // ── Send command ───────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Send relay command', description: 'Send a raw command string to the relay process. Admin only.' })
    @ApiWrappedSuccessResponse(HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Post(':id/command')
    async sendCommand(@Param('id') rawId: string, @Body() body: SendCommandDto) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        const sent = this.wsGateway.sendCommand(id, body.content);
        if (!sent) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay is not connected');

        return { success: true };
    }

    // ── Lifecycle (via runner) ─────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Start relay', description: 'Start the relay process via its configured runner (e.g. Docker). Admin only.' })
    @ApiWrappedSuccessResponse(HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Post(':id/start')
    async start(@Param('id') rawId: string, @Query('max_instances') rawMax?: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const maxInstances = rawMax ? parseInt(rawMax, 10) : undefined;

        try {
            const providerId = await this.relay.startRelay(id, maxInstances);
            return { success: true, provider_id: providerId };
        } catch (err: any) {
            if (err?.message?.includes('not found')) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);
            throw new ApiException(ApiErrorCode.INTERNAL_SERVER_ERROR, null, err?.message ?? 'Failed to start relay');
        }
    }

    @ApiOperation({ summary: 'Stop relay (runner)', description: 'Gracefully stop the relay process via its runner. Admin only.' })
    @ApiWrappedSuccessResponse(HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Post(':id/stop')
    async stop(@Param('id') rawId: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        try {
            await this.relay.stopRelay(id);
            return { success: true };
        } catch (err: any) {
            if (err?.message?.includes('not found')) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);
            throw new ApiException(ApiErrorCode.INTERNAL_SERVER_ERROR, null, err?.message ?? 'Failed to stop relay');
        }
    }

    @ApiOperation({ summary: 'Restart relay (runner)', description: 'Restart the relay process via its runner. Admin only.' })
    @ApiWrappedSuccessResponse(HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Post(':id/restart')
    async restart(@Param('id') rawId: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        try {
            const providerId = await this.relay.restartRelay(id);
            return { success: true, provider_id: providerId };
        } catch (err: any) {
            if (err?.message?.includes('not found')) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);
            throw new ApiException(ApiErrorCode.INTERNAL_SERVER_ERROR, null, err?.message ?? 'Failed to restart relay');
        }
    }

    @ApiOperation({ summary: 'Kill relay (runner)', description: 'Forcefully kill the relay process (SIGKILL). Admin only.' })
    @ApiWrappedSuccessResponse(HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Post(':id/kill')
    async kill(@Param('id') rawId: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        try {
            await this.relay.killRelay(id);
            return { success: true };
        } catch (err: any) {
            if (err?.message?.includes('not found')) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);
            throw new ApiException(ApiErrorCode.INTERNAL_SERVER_ERROR, null, err?.message ?? 'Failed to kill relay');
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Delete relay', description: 'Stop and unregister a relay. If Docker-managed, also kills the container. Admin only.' })
    @ApiWrappedSuccessResponse()
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Delete(':id')
    async remove(@Param('id') rawId: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        // Gracefully stop the runner before deleting the DB row
        try { await this.relay.stopRelay(id); } catch { /* not critical */ }
        if (this.relay.isRelayConnected(id)) this.wsGateway.sendCommand(id, 'stop');

        const deleted = await this.relay.delete(id);
        if (!deleted) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        return { success: true };
    }
}

