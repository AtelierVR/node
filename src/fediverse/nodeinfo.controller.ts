import { Controller, Get, Header, HttpStatus } from '@nestjs/common';
import { ApiExtraModels, ApiTags, ApiOperation, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { FediverseService } from './fediverse.service';
import type { NodeInfoDocument } from './fediverse.types';
import { NodeInfoDocumentDto } from './dto/fedi-protocol.dto';

@ApiTags('Fediverse')
@ApiExtraModels(NodeInfoDocumentDto)
@Controller('nodeinfo')
export class NodeInfoController {
    constructor(
        private readonly fediverse: FediverseService,
    ) { }

    @ApiOperation({ summary: 'NodeInfo 2.1', description: 'Returns NodeInfo 2.1 document with software info and usage statistics.' })
    @ApiResponse({ status: HttpStatus.OK, description: 'NodeInfo 2.1 document.', schema: { $ref: getSchemaPath(NodeInfoDocumentDto) } })
    @Get('2.1')
    @Header(
        'Content-Type',
        'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"',
    )

    async v21(): Promise<NodeInfoDocument> {
        return await this.fediverse.nodeInfoDocument();
    }
}
