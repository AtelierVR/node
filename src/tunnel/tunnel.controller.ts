import {
  Controller,
  Post,
  Req,
  UseGuards,
  Body,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { ApiWrappedSuccessResponse, ApiErrorResponse } from '../api/swagger';
import { ServerAuthenticatedRequest, ServerGuard } from '../auth/server.guard';
import { TunnelService } from './tunnel.service';
import { TunnelFrameDto } from './tunnel.types';

@ApiTags('Tunnel')
@Controller('tunnel')
export class TunnelController {
  constructor(private readonly tunnel: TunnelService) {}

  @ApiOperation({
    summary: 'Tunnel Request',
    description:
      'Server-to-server endpoint: dispatch a request to the handler registered with @OnTunnel(id) and return its response.',
  })
  @ApiWrappedSuccessResponse()
  @ApiErrorResponse(HttpStatus.BAD_REQUEST)
  @ApiErrorResponse(HttpStatus.NOT_FOUND)
  @ApiSecurity('nox-challenge')
  @UseGuards(ServerGuard)
  @Post()
  async receiveEvent(
    @Req() req: Request & ServerAuthenticatedRequest,
    @Body() body: TunnelFrameDto,
  ): Promise<unknown> {
    return this.tunnel.handle(body.id, body.data ?? null, {
      server: req.server,
    });
  }
}
