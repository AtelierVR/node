import { Controller, Get, HttpStatus, NotFoundException, Param, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApiWrappedResponse, ApiWrappedArrayResponse, ApiErrorResponse } from '../api/swagger';
import { ExternalServersService } from './external-servers.service';
import { ExternalServerDetailDto, ExternalServerListItemDto } from './dto/external-server.dto';
import { ExternalServerWithMethods } from './external-server.model';
import { NoxWellKnown } from '../fediverse/fediverse.types';
import { InstanceConfigDto } from '../server/dto/server-api-response.dto';

@ApiTags('Servers')
@Controller('servers')
export class ServersController {
    constructor(private readonly servers: ExternalServersService) { }

    @ApiOperation({ summary: 'List known servers', description: 'Return all federated servers known to this instance.' })
    @ApiWrappedArrayResponse(ExternalServerListItemDto)
    @Get()
    async listServers(): Promise<ExternalServerListItemDto[]> {
        const all = await this.servers.findAll();
        return all.map(toListItem);
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

        return { ...toListItem(server), well_known: wellKnown } as ExternalServerDetailDto;
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
            icon = (await server.wellKnown()).data.metadata.icon;
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

        const result = await server.fetch<InstanceConfigDto>('/configs');
        if (!result.data) throw new NotFoundException(`Could not fetch configs from server "${address}".`);
        return result.data;
    }
}

function toListItem(server: ExternalServerWithMethods): ExternalServerListItemDto {
    return {
        address: server.address,
        rank: server.rank,
        last_seen: server.lastSeen.getTime(),
        created_at: server.createdAt.getTime(),
    };
}
