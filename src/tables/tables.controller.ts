import {
    Controller, Get, Post, Delete, Param, Req, Res,
    UseGuards, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { createHash } from 'node:crypto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ApiWrappedResponse, ApiErrorResponse } from '../api/swagger';
import { TableListDataDto, PublicTableDto, TableDeleteResponseDto } from './dto/table-response.dto';
import { TablesService } from './tables.service';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { AuthUserGuard, UserAuthenticatedRequest } from '../auth/auth.guard';
import { UsersService } from '../users/users.service';
import { NoxIdentifier } from '../common/identifier';

@ApiTags('Tables')
@Controller('users')
export class TablesController {

    constructor(
        private readonly tables: TablesService,
        private readonly users: UsersService,
    ) { }

    // ── Private tables (@me) ──────────────────────────────────────────────────────

    /**
     * GET /api/users/@me/tables
     * Returns metadata for all table entries (no values).
     */
    @ApiOperation({ summary: 'List tables', description: 'Return metadata for all key/value table entries of the current user.' })
    @ApiWrappedResponse(TableListDataDto)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @UseGuards(AuthUserGuard)
    @Get('@me/tables')
    async listTables(
        @Req() req: Request & UserAuthenticatedRequest,
        @Query('limit') rawLimit?: string,
        @Query('offset') rawOffset?: string,
    ) {
        let limit = parseInt(rawLimit ?? '10', 10);
        let offset = parseInt(rawOffset ?? '0', 10);
        if (!Number.isFinite(limit) || limit < 1) limit = 10;
        if (limit > 100) limit = 100;
        if (!Number.isFinite(offset) || offset < 0) offset = 0;

        const { tables, total } = await this.tables.getAll(req.user.id, limit, offset);
        return { tables, limit, offset, total };
    }

    /**
     * GET /api/users/@me/tables/:key
     * Returns the raw binary value of the table entry with proper Content-Type header.
     */
    @ApiOperation({ summary: 'Get table entry', description: 'Return the raw binary value of a table entry with its stored Content-Type.' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Raw binary body with the stored Content-Type header.', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } })
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @UseGuards(AuthUserGuard)
    @Get('@me/tables/:key')
    async getTable(
        @Param('key') key: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @Res() res: Response,
    ) {
        const table = await this.tables.get(key, req.user.id);
        if (!table) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Table');

        res.setHeader('Content-Disposition', `inline; filename="${key}"`);
        res.setHeader('Date', table.createdAt.toUTCString());
        res.setHeader('Last-Modified', table.updatedAt.toUTCString());
        res.setHeader('Content-Type', table.mime);
        res.setHeader('Content-Length', table.value.length.toString());
        return res.send(table.value);
    }

    /**
     * POST /api/users/@me/tables/:key
     * Create or update a table entry. Body is read as raw bytes.
     * The stored MIME type is taken from the request's Content-Type header.
     */
    @ApiOperation({ summary: 'Set table entry', description: 'Create or update a table entry. Body is stored as raw bytes; MIME type is taken from Content-Type header.' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Returns the stored entry as raw binary with the stored Content-Type header.', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } })
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @UseGuards(AuthUserGuard)
    @Post('@me/tables/:key')
    async setTable(
        @Param('key') key: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @Res() res: Response,
    ) {
        const body = (req as any).rawBody as Buffer | undefined;
        if (!body || body.length === 0)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'Request body is required');

        const expectedHash = req.headers['x-file-hash'] as string | undefined;
        if (expectedHash) {
            const actualHash = createHash('sha256').update(body).digest('hex');
            if (actualHash !== expectedHash)
                throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'File hash mismatch');
        }

        const mime = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim();

        const { row, existed: _existed } = await this.tables.set(key, req.user.id, body, mime);

        res.setHeader('Content-Disposition', `inline; filename="${key}"`);
        res.setHeader('Date', row.createdAt.toUTCString());
        res.setHeader('Last-Modified', row.updatedAt.toUTCString());
        res.setHeader('Content-Type', row.mime);
        res.setHeader('Content-Length', row.value.length.toString());
        return res.send(row.value);
    }

    /**
     * DELETE /api/users/@me/tables/:key
     */
    @ApiOperation({ summary: 'Delete table entry', description: 'Delete a key/value table entry for the current user.' })
    @ApiWrappedResponse(TableDeleteResponseDto)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @UseGuards(AuthUserGuard)
    @HttpCode(HttpStatus.OK)
    @Delete('@me/tables/:key')
    async deleteTable(
        @Param('key') key: string,
        @Req() req: Request & UserAuthenticatedRequest,
    ) {
        const deleted = await this.tables.delete(key, req.user.id);
        if (!deleted) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'Table');
        return { success: true, key };
    }

    // ── Public elements ───────────────────────────────────────────────────────────

    /**
     * GET /api/users/@me/public/:type
     * Returns own public table entry (key "public.<type>").
     */
    @ApiOperation({ summary: 'Get own public entry', description: "Return the authenticated user's public table entry for the given type." })
    @ApiWrappedResponse(PublicTableDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @UseGuards(AuthUserGuard)
    @Get('@me/public/:type')
    async getMyPublic(
        @Param('type') type: string,
        @Req() req: Request & UserAuthenticatedRequest,
        @Res() res: Response,
    ) {
        const table = await this.tables.getPublic(type, req.user.id);
        if (!table) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'public element');

        const accept = req.headers['accept'];
        if (accept && accept !== '*/*' && table.mime && accept !== table.mime)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'MIME type not acceptable');

        return res
            .setHeader('Content-Type', table.mime || 'application/octet-stream')
            .json({
                key: table.key,
                value: table.value,
                updated_at: table.updatedAt.getTime(),
            });
    }

    /**
     * GET /api/users/@admin/public/:type
     * Returns the main admin user's public table entry (no auth required).
     */
    @ApiOperation({ summary: 'Get admin public entry', description: "Return the main admin user's public table entry for the given type (no auth required)." })
    @ApiWrappedResponse(PublicTableDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @Get('@admin/public/:type')
    async getAdminPublic(
        @Param('type') type: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const adminId = await this.users.mainAdminId();
        const table = await this.tables.getPublic(type, adminId);
        if (!table) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'public element');

        const accept = req.headers['accept'];
        if (accept && accept !== '*/*' && table.mime && accept !== table.mime)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'MIME type not acceptable');

        return res
            .setHeader('Content-Type', table.mime || 'application/octet-stream')
            .json({
                key: table.key,
                value: table.value,
                updated_at: table.updatedAt.getTime(),
            });
    }

    /**
     * GET /api/users/:id/public/:type
     * Returns the public table entry for any user (no auth required).
     */
    @ApiOperation({ summary: 'Get user public entry', description: "Return a specific user's public table entry for the given type (no auth required)." })
    @ApiWrappedResponse(PublicTableDto)
    @ApiErrorResponse(HttpStatus.BAD_REQUEST)
    @ApiErrorResponse(HttpStatus.NOT_FOUND)
    @ApiErrorResponse(HttpStatus.NOT_IMPLEMENTED)
    @Get(':id/public/:type')
    async getUserPublic(
        @Param('id') id: string,
        @Param('type') type: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const domain = await this.users.domain();
        const identifier = NoxIdentifier.parse(id);
        if (!identifier.isLocal(domain))
            throw new ApiException(ApiErrorCode.NOT_IMPLEMENTED, null, 'Fetch remote user public element');

        const numericId = identifier.numericId;
        if (numericId === null)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'User ID must be numeric or a valid identifier');

        const user = await this.users.findById(numericId);
        if (!user) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'User');

        const table = await this.tables.getPublic(type, user.id);
        if (!table) throw new ApiException(ApiErrorCode.NOT_FOUND, null, 'public element');

        const accept = req.headers['accept'];
        if (accept && accept !== '*/*' && table.mime && accept !== table.mime)
            throw new ApiException(ApiErrorCode.BAD_REQUEST, null, 'MIME type not acceptable');

        return res
            .setHeader('Content-Type', table.mime || 'application/octet-stream')
            .json({
                key: table.key,
                value: table.value,
                updated_at: table.updatedAt.getTime(),
            });
    }
}
