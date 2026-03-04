import Main from "../Main";
import NetExpress, { Request, Response } from "../network/NetExpress";
import User from "../users/User";
import { ErrorCodes } from "../utils/Constants";
import { ErrorMessage, hash, sha256 } from "../utils/Utils";
import TableManager from "./TableManager";
import Express from "express";
import Table from "./Table";

export default class TableAPIWeb {
    constructor(private readonly app: Main, private readonly manager: TableManager) {
        // GET /api/users/@me/tables - get all tables
        this.app.http.express.server.get('/api/users/@me/tables', (req, res) =>
            this.handleGetAllTables(req as Request, res as Response));

        // GET /api/users/@me/tables - get specific key
        this.app.http.express.server.get('/api/users/@me/tables/:id', (req, res) =>
            this.handleGetTable(req as Request<{ id: string }>, res as Response));

        // POST /api/users/@me/tables - create or update table entry
        this.app.http.express.server.post('/api/users/@me/tables/:id',
            Express.raw({ type: '*/*', limit: '50mb' }), (req, res) =>
            this.handleSetTable(req as Request<{ id: string }>, res as Response));

        // DELETE /api/users/@me/tables - delete table entry by key
        this.app.http.express.server.delete('/api/users/@me/tables/:id', (req, res) =>
            this.handleDeleteTable(req as Request<{ id: string }>, res as Response));
    }

    private async handleGetAllTables(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        var { limit, offset } = request.query;
        if (!limit || typeof limit !== 'string') limit = '10';
        if (!offset || typeof offset !== 'string') offset = '0';
        if (!/^\d+$/.test(limit)) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'query', 'limit'));
        if (!/^\d+$/.test(offset)) return response.send(new ErrorMessage(ErrorCodes.InvalidField, 'query', 'offset'));
        var ilimit = parseInt(limit);
        var ioffset = parseInt(offset);
        if (ilimit > 100) ilimit = 100;
        if (ioffset < 0) ioffset = 0;
        let ids: string[] = [];

        const [tables, total] = await this.manager.getAllTablesForUser(user.id, ilimit, ioffset);
        const result: IRTableList = {
            tables: {},
            limit: ilimit,
            offset: ioffset,
            total: total
        };

        for (const table of tables)
            result.tables[table.key] = {
                key: table.key,
                hash: sha256(table.value),
                created_at: table.created_at.getTime(),
                updated_at: table.updated_at.getTime()
            };

        return response.send<IRTableList>(result);
    }


    /**
     * Handle GET /api/users/@me/tables/:id
     * Example: GET /api/users/@me/tables/nox.worlds.favorites
     * Returns: Direct value in body, metadata in headers
     */
    async handleGetTable(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        const table = await this.manager.findTableByKeyAndUser(request.params.id, user.id);
        if (!table)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Table'));

        // Mettre les métadonnées dans les headers
        response.setHeader('Content-Disposition', `inline; filename="${request.params.id}"`);
        response.setHeader('Date', table.created_at.toUTCString());
        response.setHeader('Last-Modified', table.updated_at.toUTCString());
        response.setHeader('Content-Type', table.mime);
        response.setHeader('Content-Length', table.value.length.toString());

        // Envoyer directement la valeur
        return response.send(table.value);
    }

    /**
     * Handle POST /api/users/@me/tables/:id
     * Example: POST /api/users/@me/tables/nox.worlds.favorites
     * Creates or updates a table entry
     * Returns: Direct value in body, metadata in headers
     */
    async handleSetTable(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        const value = request.body as Buffer;

        if (!value)
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, 'Value is required'));

        const hasTable = await this.manager.hasTableByKeyAndUser(request.params.id, user.id);
        const table = await this.manager.setTableValue(request.params.id, user.id, value, request.headers['content-type']?.toString() || 'application/octet-stream');
        if (!table)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, "set table value"));

        // Mettre les métadonnées dans les headers
        response.setHeader('Content-Disposition', `inline; filename="${request.params.id}"`);
        response.setHeader('Date', table.created_at.toUTCString());
        response.setHeader('Last-Modified', table.updated_at.toUTCString());
        response.setHeader('Content-Type', table.mime);
        response.setHeader('Content-Length', table.value.length.toString());

        // Envoyer directement la valeur
        let socket = await user.getSockets();
        for (let s of socket) s.emitData(hasTable ? 'table_update' : 'table_create', {
            key: request.params.id,
            created_at: table.created_at.getTime(),
            updated_at: table.updated_at.getTime(),
            hash: sha256(table.value)
        });
        return response.send(table.value);
    }

    /**
     * Handle DELETE /api/users/@me/tables/:id
     * Example: DELETE /api/users/@me/tables/nox.worlds.favorites
     */
    async handleDeleteTable(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));

        const user = await request.data.getData() as User | null;
        if (!user)
            return response.send(new ErrorMessage(ErrorCodes.UserNotFound));

        const { key } = request.query;

        if (!key || typeof key !== 'string')
            return response.send(new ErrorMessage(ErrorCodes.InvalidRequest, 'Key is required'));

        const success = await this.manager.deleteTableEntry(key, user.id);

        if (!success)
            return response.send(new ErrorMessage(ErrorCodes.NotFound, 'Table entry not found'));

        let socket = await user.getSockets();
        for (let s of socket) s.emitData('table_delete', { key: key });
        return response.send<IRTableDeleteResponse>({
            success: true,
            key: key,
            message: 'Table entry deleted successfully'
        });
    }
}

/**
 * Request interface for creating/updating table entries
 */
export interface ITableRequest {
    key: string;
    value: string;
}

/**
 * Response interface for individual table entries
 */
export interface IRTableEntry {
    key: string;
    hash: string;
    created_at: number;
    updated_at: number;
}

/**
 * Response interface for table list (all tables)
 */
export interface IRTableList {
    tables: Record<string, IRTableEntry>;
    total: number;
    limit: number;
    offset: number;
}

/**
 * Response interface for delete operations
 */
export interface IRTableDeleteResponse {
    success: boolean;
    key: string;
    message: string;
}
