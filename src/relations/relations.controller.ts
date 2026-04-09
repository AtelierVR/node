import {
    Controller, Post, Req, UseGuards, Body, HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { ApiWrappedSuccessResponse, ApiErrorResponse } from '../api/swagger';
import { RelationsService } from './relations.service';
import type { S2SRelationDto } from './relations.types';
import { ServerAuthenticatedRequest, ServerGuard } from '../auth/server.guard';
import { ApiErrorCode } from '../api/api-error.factory';
import { ApiException } from '../api/api-exception';

@ApiTags('Relations (S2S)')
@Controller('api/relations')
export class RelationsController {
    constructor(
        private readonly relations: RelationsService,
    ) { }

    // ── S2S ──────────────────────────────────────────────────────────────────────

    @ApiOperation({ summary: 'S2S relation sync', description: 'Server-to-server endpoint: notify a remote server of a relation change (follow/unfollow/block).' })
    @ApiWrappedSuccessResponse()
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiSecurity('nox-challenge')
    @UseGuards(ServerGuard)
    @Post()
    async s2sRelation(
        @Req() req: Request & ServerAuthenticatedRequest,
        @Body() body: S2SRelationDto,
    ) {
        if (!body || typeof body.initiator !== 'number' || typeof body.target !== 'number' || !body.type)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Invalid S2S relation payload');

        await this.relations.s2sSync(req.server.address as string, body);
        return { success: true };
    }

}
