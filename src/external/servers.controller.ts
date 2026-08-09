import { Controller, Get, HttpStatus, NotFoundException, Param, Query, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ApiWrappedResponse, ApiWrappedArrayResponse, ApiErrorResponse } from '../api/swagger';
import { ExternalServersService } from './external-servers.service';
import { ExternalServerDetailDto, ExternalServerListItemDto } from './dto/external-server.dto';
import { ExternalServerWithMethods } from './external-server.model';
import { NoxWellKnown } from '../fediverse/fediverse.types';
import { InstanceConfigDto } from '../server/dto/server-api-response.dto';

const MAX_LIMIT = 20;

@ApiTags('Servers')
@Controller('servers')
export class ServersController {
    constructor(private readonly servers: ExternalServersService) { }

    @ApiOperation({ summary: 'List known servers', description: 'Return federated servers known to this instance, paginated (max 20 per page).' })
    @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', default: 20, maximum: MAX_LIMIT } })
    @ApiQuery({ name: 'offset', required: false, schema: { type: 'integer', default: 0 } })
    @ApiWrappedArrayResponse(ExternalServerListItemDto)
    @Get()
    async listServers(
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ): Promise<ExternalServerListItemDto[]> {
        const limit = Math.min(Math.max(1, Number(rawLimit) || MAX_LIMIT), MAX_LIMIT);
        const offset = Math.max(0, Number(rawOffset) || 0);

        const all = await this.servers.findAllPaginated(limit, offset);

        // Best-effort pre-populate well-known cache (Redis-backed, shared across processes).
        await Promise.allSettled(
            all.map(s => s.wellKnown().catch(() => null)),
        );

        return Promise.all(all.map(toListItem));
    }

    @ApiOperation({ summary: 'Get server details', description: 'Return details and live well-known document for a server. Discovers the server if not yet known.' })
    @ApiWrappedResponse(ExternalServerDetailDto)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @Get(':address')
    async getServer(@Param('address') address: string): Promise<ExternalServerDetailDto> {
        const server = await this.servers.findOrDiscover(address);
        if (!server) throw new NotFoundException(`Server "${address}" not found and could not be discovered.`);

        let wellKnown: NoxWellKnown | null = null;
        try {
            const cached = await server.wellKnown();
            wellKnown = cached.data;
        } catch {
            // unreachable — return null well-known
        }

        const base = await toListItem(server);
        return { ...base, well_known: wellKnown } as ExternalServerDetailDto;
    }

    @ApiOperation({ summary: 'Redirect to server icon', description: 'Redirects to the icon URL declared in the well-known document. Returns 404 if no icon is set or the server is unreachable.' })
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @Redirect(undefined, 302)
    @Get(':address/icon')
    async getServerIcon(@Param('address') address: string) {
        const server = await this.servers.findOrDiscover(address);
        if (!server) throw new NotFoundException(`Server "${address}" not found and could not be discovered.`);

        let icon: string | null = null;
        try {
            const rawIcon = (await server.wellKnown()).data.metadata.icon;
            icon = Array.isArray(rawIcon) ? (rawIcon[0]?.src ?? null) : rawIcon;
        } catch { /* unreachable */ }

        if (!icon) throw new NotFoundException(`Server "${address}" has no icon.`);
        return { url: icon };
    }

    @ApiOperation({ summary: 'Get remote server config', description: 'Fetches and returns the public /configs endpoint of the remote server.' })
    @ApiWrappedResponse(InstanceConfigDto)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.SERVICE_UNAVAILABLE)
    @Get(':address/configs')
    async getServerConfigs(@Param('address') address: string): Promise<InstanceConfigDto> {
        const server = await this.servers.findOrDiscover(address);
        if (!server) throw new NotFoundException(`Server "${address}" not found and could not be discovered.`);

        const result = await server.fetch<InstanceConfigDto>('/configs', { responseClass: InstanceConfigDto });
        if (!result.data) throw new NotFoundException(`Could not fetch configs from server "${address}".`);
        return result.data;
    }
}

async function toListItem(server: ExternalServerWithMethods): Promise<ExternalServerListItemDto> {
    let wellknown: NoxWellKnown | null = null;
    try {
        const cached = await server.manager.cache.get<{ data: NoxWellKnown }>(`wk:${server.address}`);
        if (cached?.data) wellknown = cached.data;
    } catch { /* best-effort */ }

    return {
        address: server.address,
        rank: server.rank,
        last_seen: server.lastSeen.getTime(),
        created_at: server.createdAt.getTime(),
        wellknown: wellknown as any, // NoxWellKnown is compatible with NoxWellKnownDto at runtime
    };
}
