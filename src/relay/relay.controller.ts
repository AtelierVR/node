import { Controller, Get, Post, Delete, Param, Req, Query, Body, UseGuards, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { plainToInstance } from 'class-transformer';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiWrappedResponse, ApiWrappedArrayResponse, ApiWrappedSuccessResponse, ApiErrorResponse } from '../api/swagger';
import { ApiRelayDto } from './dto/relay-api.dto';
import { ApiInstanceDto } from '../instances/dto/instance-response.dto';
import { RelayService } from './relay.service';
import { RelayGateway } from './relay.gateway';
import { SendCommandDto } from './dto/send-command.dto';
import { RelayPlayerItemDto } from './dto/relay-response.dto';
import { RelayLogListApiDto, RelayInstanceApiDto, RelayClientApiDto, RelayPlayerApiDto } from './dto/relay-api.dto';
import { AdminUserGuard } from '../auth/admin-user.guard';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';

@ApiTags('Relay')
@Controller('relays')
export class RelayController {
    constructor(
        private readonly relay: RelayService,
        private readonly gateway: RelayGateway,
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
        return Promise.all(relays.map(r => this.serializeRelay(r)));
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
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        return this.serializeRelay(r);
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

        const logs = await this.gateway.requestLogs(id, since, limit);
        if (!logs) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay did not respond');

        return logs;
    }

    // ── Instances ──────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Get relay instances', description: 'List active instances reported by the relay process. Admin only.' })
    @ApiWrappedArrayResponse(RelayInstanceApiDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get(':id/instances')
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

        const result = await this.gateway.requestInstances(id, limit, offset);
        if (!result) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay did not respond');

        return {
            total: result.total,
            limit,
            offset,
            items: result.instances.map(i => i.normalize()),
        };
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

        const result = await this.gateway.requestClients(id, limit, offset);
        if (!result) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay did not respond');

        return {
            total: result.total,
            limit,
            offset,
            items: result.clients.map(c => c.normalize()),
        };
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

        const result = await this.gateway.requestInstances(id, 1000, 0);
        if (!result) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay did not respond');

        const instance = result.instances.find(i => (i.i ?? i.id) === iid);
        if (!instance) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Instance (${iid})`);

        const players = instance.rawPlayers().map((p: unknown) =>
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

        const sent = this.gateway.sendCommand(id, body.content);
        if (!sent) throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay is not connected');

        return { success: true };
    }

    // ── Stop / Restart ────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Stop relay', description: 'Send a stop command to the relay process. Admin only.' })
    @ApiWrappedSuccessResponse(HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Post(':id/stop')
    async stop(@Param('id') rawId: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        if (!this.relay.isRelayConnected(id))
            throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay is not connected');

        this.gateway.sendCommand(id, 'stop');
        return { success: true };
    }

    @ApiOperation({ summary: 'Restart relay', description: 'Send a restart command to the relay process. Admin only.' })
    @ApiWrappedSuccessResponse(HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Post(':id/restart')
    async restart(@Param('id') rawId: string) {
        const id = parseInt(rawId, 10);
        if (!Number.isFinite(id)) throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid relay ID');

        const r = await this.relay.findById(id);
        if (!r) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        if (!this.relay.isRelayConnected(id))
            throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null, 'Relay is not connected');

        this.gateway.sendCommand(id, 'restart');
        return { success: true };
    }

    // ── Delete ────────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'Delete relay', description: 'Stop and unregister a relay process. Admin only.' })
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

        if (this.relay.isRelayConnected(id)) this.gateway.sendCommand(id, 'stop');

        const deleted = await this.relay.delete(id);
        if (!deleted) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Relay (${id})`);

        return { success: true };
    }

    // ── Serializer ────────────────────────────────────────────────────────────────

    private async serializeRelay(r: { id: number; createdAt: Date }) {
        const connected = this.relay.isRelayConnected(r.id);
        const status = connected ? await this.gateway.requestStatus(r.id) : null;

        return {
            id: r.id,
            connected,
            created_at: r.createdAt.toISOString(),
            status: status ? {
                instances:    status.i,
                max_instances: status.m,
                clients:      status.c,
                engine:       status.e,
                version:      status.v,
                protocol:     status.p,
                uptime:       status.u,
                response_ms:  status.t ?? null,
                specs: status.s ? {
                    cpu:    status.s.c,
                    mem:    status.s.m,
                    uptime: status.s.u,
                    disk:   status.s.d,
                } : null,
            } : null,
        };
    }
}
