import { Controller, Get, Header, HttpStatus, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExtraModels, ApiTags, ApiOperation, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { FediverseService } from './fediverse.service';
import { WellKnownService } from './well-known.service';
import type { NodeInfoLinks, NoxWellKnown, WebFingerDocument } from './fediverse.types';
import { WebFingerDocumentDto, NodeInfoLinksDto } from './dto/fedi-protocol.dto';
import { NoxWellKnownDto } from './dto/nox-well-known.dto';

@ApiTags('Fediverse')
@ApiExtraModels(WebFingerDocumentDto, NodeInfoLinksDto, NoxWellKnownDto)
@Controller('.well-known')
export class WellKnownController {
    constructor(
        private readonly fediverse: FediverseService,
        private readonly wellKnown: WellKnownService,
    ) { }

    /**
     * WebFinger — actor resource discovery (RFC 7033).
     * Content-Type: application/jrd+json
     *
     * Returns 404 until actors are implemented.
     */
    @ApiOperation({ summary: 'WebFinger', description: 'Actor resource discovery per RFC 7033.' })
    @ApiResponse({ status: HttpStatus.OK, description: 'JRD document for the requested resource.', schema: { $ref: getSchemaPath(WebFingerDocumentDto) } })
    @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Missing resource parameter.' })
    @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No actor found for the given resource.' })
    @Get('webfinger')
    async webfinger(
        @Query('resource') resource: string | undefined,
        @Res() res: Response,
    ): Promise<void> {
        if (!resource) {
            res.status(HttpStatus.BAD_REQUEST).json({
                error: 'missing_resource',
                message: 'The "resource" query parameter is required',
            });
            return;
        }

        const doc: WebFingerDocument | null = await this.fediverse.findWebFinger(resource);

        if (!doc) {
            res.status(HttpStatus.NOT_FOUND).json({
                error: 'not_found',
                message: `No actor found for resource: ${resource}`,
            });
            return;
        }

        res
            .status(HttpStatus.OK)
            .header('Content-Type', 'application/jrd+json; charset=utf-8')
            .json(doc);
    }

    /** NodeInfo links index pointing to /nodeinfo/2.1. */
    @ApiOperation({ summary: 'NodeInfo links', description: 'Returns link to NodeInfo 2.1 document.' })
    @ApiResponse({ status: HttpStatus.OK, description: 'NodeInfo links index.', schema: { $ref: getSchemaPath(NodeInfoLinksDto) } })
    @Get('nodeinfo')
    async nodeInfo(): Promise<NodeInfoLinks> {
        return await this.fediverse.nodeInfoLinks();
    }

    /**
     * Host-Meta — XRD/XML advertising the WebFinger endpoint template.
     */
    @ApiOperation({ summary: 'Host-Meta', description: 'XRD/XML document advertising the WebFinger endpoint template.' })
    @ApiResponse({ status: HttpStatus.OK, description: 'XRD/XML host-meta document.', content: { 'application/xrd+xml': { schema: { type: 'string' } } } })
    @Get('host-meta')
    @Header('Content-Type', 'application/xrd+xml; charset=utf-8')
    async hostMeta(@Res() res: Response): Promise<void> {
        res.status(HttpStatus.OK).send(await this.fediverse.hostMetaXml());
    }

    /** Nox instance metadata. */
    @ApiOperation({ summary: 'Nox instance metadata', description: 'Returns server gateway URLs, features, and capabilities.' })
    @ApiResponse({ status: HttpStatus.OK, description: 'NoxWellKnown document.', schema: { $ref: getSchemaPath(NoxWellKnownDto) } })
    @Get('nox')
    async nox(): Promise<NoxWellKnown> {
        return await this.wellKnown.noxWellKnown();
    }
}

