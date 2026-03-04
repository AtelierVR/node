import Main from "../../Main";
import { ErrorCodes } from "../../utils/Constants";
import { Request, Response } from "../../network/NetExpress";
import { ErrorMessage } from "../../utils/Utils";
import Session from "./Session";
import Device from "../devices/Device";

/**
 * Handles session-related HTTP API endpoints.
 * Provides REST API functionality for session management including retrieval and deletion.
 * 
 * @class SessionAPIWeb
 */
export default class SessionAPIWeb {
    /**
     * Creates a new SessionAPIWeb instance and registers API routes.
     * 
     * @param {Main} app - The main application instance
     */
    constructor(private readonly app: Main) {
        this.app.http.express.server.get("/api/users/@me/session", (req, res) => this.handleGetCurrentSession(req as Request, res as Response));
        this.app.http.express.server.get("/api/users/@me/sessions", (req, res) => this.handleGetSessions(req as Request, res as Response));
        this.app.http.express.server.get("/api/users/@me/sessions/:id", (req, res) => this.handleGetSession(req as Request<{ id: string }>, res as Response));
        this.app.http.express.server.delete("/api/users/@me/sessions/:id", (req, res) => this.handleDeleteSession(req as Request<{ id: string }>, res as Response));
        this.app.http.express.server.delete("/api/users/@me/sessions", (req, res) => this.handleDeleteSessions(req as Request, res as Response));
    }

    /**
     * Handles GET /api/users/@me/session - retrieves the current user's session.
     * 
     * @param {Request} request - The HTTP request object
     * @param {Response} response - The HTTP response object
     * @returns {Promise<void>} Sends session data or error response
     */
    async handleGetCurrentSession(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData();
        if (!user) return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        let auth = await request.data.getAuthenticator();
        if (!auth || !(auth instanceof Session))
            return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        return response.send<IRSession>({
            id: auth.id,
            expires_at: auth.expires.getTime(),
            created_at: auth.created_at.getTime(),
            current: true,
            devices: (await auth.getDevices()).map(b => ({
                ip: b.ip,
                user_agent: b.user_agent,
                last_seen: b.last_seen.getTime()
            })).sort((a, b) => b.last_seen - a.last_seen)
        });
    }

    /**
     * Handles GET /api/users/@me/sessions - retrieves all sessions for the current user with pagination.
     * 
     * @param {Request} request - The HTTP request object with optional query parameters (limit, offset)
     * @param {Response} response - The HTTP response object
     * @returns {Promise<void>} Sends paginated session list or error response
     */
    async handleGetSessions(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData();
        if (!user) return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        var { limit, offset, device_limit } = request.query;
        if (!limit || typeof limit !== 'string' || !/^\d+$/.test(limit)) limit = '10';
        if (!offset || typeof offset !== 'string' || !/^\d+$/.test(offset)) offset = '0';
        var ilimit = parseInt(limit);
        var ioffset = parseInt(offset);
        if (ilimit > 10) ilimit = 10;
        if (ilimit < 1) ilimit = 1;
        if (ioffset < 0) ioffset = 0;

        const { sessions, total } = await this.app.sessions.findSessionsByUserId({
            user_id: user.id,
            limit: ilimit,
            offset: ioffset
        });

        let sessionWithDevices: {
            session: Session,
            devices: Device[],
        }[] = [];

        let auth = await request.data.getAuthenticator();
        if (!auth || !(auth instanceof Session))
            return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        for (const session of sessions)
            sessionWithDevices.push({
                session: session,
                devices: await session.getDevices()
            });


        return response.send<IRGetSessions>({
            limit: ilimit,
            offset: ioffset,
            sessions: sessionWithDevices.map(a => ({
                id: a.session.id,
                expires_at: a.session.expires.getTime(),
                created_at: a.session.created_at.getTime(),
                current: a.session.id === auth.id,
                devices: a.devices
                    .sort((a, b) => b.last_seen.getTime() - a.last_seen.getTime())
                    .filter((v, i, a) => a.findIndex(t => t.session_id === v.session_id && t.ip === v.ip && t.user_agent === v.user_agent) === i)
                    .map(b => ({
                        ip: b.ip,
                        user_agent: b.user_agent,
                        last_seen: b.last_seen.getTime()
                    }))
            })),
            total: total
        });
    }

    /**
     * Handles GET /api/users/@me/sessions/:id - retrieves a specific session by ID.
     * 
     * @param {Request<{ id: string }>} request - The HTTP request object with session ID parameter
     * @param {Response} response - The HTTP response object
     * @returns {Promise<void>} Sends session data or error response
     */
    async handleGetSession(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData();
        if (!user) return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        const session = await this.app.sessions.findSessionById(request.params.id);
        if (!session) return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        if (session.user_id !== user.id)
            return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        return response.send<IRSession>({
            id: session.id,
            expires_at: session.expires.getTime(),
            created_at: session.created_at.getTime(),
            current: session.id === (await request.data.getAuthenticator())?.id,
            devices: (await session.getDevices()).map(b => ({
                ip: b.ip,
                user_agent: b.user_agent,
                last_seen: b.last_seen.getTime()
            })).sort((a, b) => b.last_seen - a.last_seen)
        });
    }

    /**
     * Handles DELETE /api/users/@me/sessions/:id - deletes a specific session.
     * 
     * @param {Request<{ id: string }>} request - The HTTP request object with session ID parameter
     * @param {Response} response - The HTTP response object
     * @returns {Promise<void>} Sends deletion result or error response
     */
    async handleDeleteSession(request: Request<{ id: string }>, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData();
        if (!user) return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        const session = await this.app.sessions.findSessionById(request.params.id);
        if (!session) return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        if (session.user_id !== user.id)
            return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        let res = await this.app.sessions.deleteSession(session);
        if (res === false)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, "delete session"));

        return response.send<IRLogout>({
            logout: session.id === (await request.data.getAuthenticator())?.id
        });
    }

    /**
     * Handles DELETE /api/users/@me/sessions - deletes all sessions for the current user.
     * 
     * @param {Request} request - The HTTP request object
     * @param {Response} response - The HTTP response object
     * @returns {Promise<void>} Sends deletion result or error response
     */
    async handleDeleteSessions(request: Request, response: Response) {
        if (!request.data.isBearer())
            return response.send(new ErrorMessage(ErrorCodes.NotLogged));
        const user = await request.data.getData();
        if (!user) return response.send(new ErrorMessage(ErrorCodes.SessionNotFound));

        const sessions = await this.app.sessions.deleteSessionsByUserId(user.id);
        if (sessions === false)
            return response.send(new ErrorMessage(ErrorCodes.InternalError, "delete sessions"));
        
        return response.send<IRLogout>({
            logout: true
        });
    }
}

/**
 * Response interface for paginated session retrieval.
 * 
 * @interface IRGetSessions
 */
export interface IRGetSessions {
    /** Number of sessions per page */
    limit: number,
    /** Number of sessions skipped */
    offset: number,
    /** Array of session objects */
    sessions: IRSession[],
    /** Total number of sessions available */
    total: number
}

/**
 * Response interface for individual session data.
 * 
 * @interface IRSession
 */
export interface IRSession {
    /** Unique session identifier */
    id: string,
    /** Whether this is the current active session */
    current: boolean,
    /** Session expiration timestamp in milliseconds */
    expires_at: number,
    /** Session creation timestamp in milliseconds */
    created_at: number,
    /** Array of devices associated with this session */
    devices: IRDevice[]
}

/**
 * Response interface for device information within a session.
 * 
 * @interface IRDevice
 */
export interface IRDevice {
    /** User agent string of the device */
    user_agent: string,
    /** IP address of the device */
    ip: string,
    /** Last seen timestamp in milliseconds */
    last_seen: number
}

/**
 * Response interface for logout operations.
 * 
 * @interface IRLogout
 */
export interface IRLogout {
    /** Whether the current session was logged out */
    logout: boolean
}