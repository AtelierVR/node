import { Controller, Get, Post, Delete, Param, Query, Body, Req, UseGuards, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiWrappedResponse, ApiWrappedArrayResponse, ApiErrorResponse, ApiWrappedSuccessResponse } from '../api/swagger';
import { ApiActivityEventResponseDto } from './dto/activity-response.dto';
import { ActivityService } from './activity.service';
import { AdminUserGuard } from '../auth/admin-user.guard';
import { UserAuthenticatedRequest } from '../auth/auth.guard';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { CreateActivityEventDto } from './activity.types';

@ApiTags('Activity')
@Controller('activity')
export class ActivityController {
    constructor(private readonly activity: ActivityService) { }

    /**
     * GET /api/activity
     * Query: type (filter), limit, offset
     * Admin only.
     */
    @ApiOperation({ summary: 'List activity events', description: 'Paginated list of activity events. Admin only.' })
    @ApiWrappedArrayResponse(ApiActivityEventResponseDto)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Get()
    async list(
        @Query('q') q?: string,
        @Query('type') type?: string,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        let limit = parseInt(rawLimit ?? '50', 10);
        let offset = parseInt(rawOffset ?? '0', 10);
        if (!Number.isFinite(limit) || limit < 1) limit = 50;
        if (limit > 100) limit = 100;
        if (!Number.isFinite(offset) || offset < 0) offset = 0;

        const result = await this.activity.list({ q, type, limit, offset });
        return {
            total: result.total,
            limit,
            offset,
            items: result.items,
        };
    }

    /**
     * POST /api/activity
     * Body: CreateActivityEventDto
     * Admin only. Allows admins to manually emit events.
     */
    @ApiOperation({ summary: 'Create activity event', description: 'Manually emit an activity event. Admin only.' })
    @ApiWrappedResponse(ApiActivityEventResponseDto, HttpStatus.CREATED)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Post()
    async create(
        @Req() req: Request & UserAuthenticatedRequest,
        @Body() body: CreateActivityEventDto,
    ) {
        if (!body.type || typeof body.type !== 'string')
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'type is required');
        if (!body.message || typeof body.message !== 'string')
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'message is required');

        return this.activity.create(body);
    }

    /**
     * DELETE /api/activity/:id
     * Admin only.
     */
    @ApiOperation({ summary: 'Delete activity event', description: 'Remove an activity event by ID. Admin only.' })
    @ApiWrappedSuccessResponse()
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.FORBIDDEN)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiBearerAuth()
    @UseGuards(AdminUserGuard)
    @Delete(':id')
    async remove(@Param('id') id: string) {
        const numId = parseInt(id, 10);
        if (!Number.isFinite(numId))
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'id must be numeric');

        const ok = await this.activity.deleteById(numId);
        if (!ok) throw new ApiException(ApiErrorCode.NOT_FOUND, null, `ActivityEvent (${id})`);

        return { success: true };
    }
}
