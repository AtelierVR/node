import Reileta from "../../Main";
import Session from "./Session";
import { randomBytes } from "crypto";
import { Session as ISession } from "@prisma/client";
import SessionAPIWeb from "./SessionAPIWeb";
import { AuthenticationTypes } from "../../network/NetData";
import { Security } from "../../utils/Security";

/**
 * Manages user sessions including creation, retrieval, and deletion operations.
 * Provides methods to handle session lifecycle and device associations.
 * 
 * @class SessionManager
 */
export default class SessionManager {

    /** Web API handler for session-related endpoints */
    api_web: SessionAPIWeb;

    /**
     * Creates a new SessionManager instance.
     * 
     * @param {Reileta} app - The main application instance
     */
    constructor(private readonly app: Reileta) {
        this.api_web = new SessionAPIWeb(app);
    }

    /**
     * Finds a session by its unique identifier.
     * 
     * @param {string} id - The session ID to search for
     * @returns {Promise<Session | null>} The session object or null if not found
     */
    async findSessionById(id: string): Promise<Session | null> {
        let session: ISession | null = null;
        try {
            session = await this.app.database.session.findUnique({ where: { id } });
        } catch { }
        return session ? new Session(session, this.app) : null;
    }

    /**
     * Finds a session by its authentication token.
     * 
     * @param {string} token - The session token to search for
     * @returns {Promise<Session | null>} The session object or null if not found
     */
    async findSessionByToken(token: string): Promise<Session | null> {
        let session: ISession | null = null;
        try {
            session = await this.app.database.session.findFirst({ where: { token } });
        } catch { }
        return session ? new Session(session, this.app) : null;
    }

    /**
     * Finds all sessions for a specific user with optional pagination.
     * 
     * @param {Object} obj - Query parameters
     * @param {number} obj.user_id - The user ID to search sessions for
     * @param {number} [obj.limit] - Maximum number of sessions to return
     * @param {number} [obj.offset] - Number of sessions to skip for pagination
     * @returns {Promise<{sessions: Session[], total: number}>} Object containing sessions array and total count
     */
    async findSessionsByUserId(obj: {
        user_id: number,
        limit?: number,
        offset?: number
    }) {
        let sessions: ISession[] = [];
        let total = 0;
        try {
            sessions = await this.app.database.session.findMany({
                where: { user_id: obj.user_id },
                take: obj.limit || undefined,
                skip: obj.offset || undefined
            });
            total = await this.app.database.session.count({ where: { user_id: obj.user_id } });
        } catch { }
        return {
            sessions: sessions.map(s => new Session(s, this.app)),
            total: total
        }
    }

    /**
     * Creates a new session in the database.
     * 
     * @param {CreateTokenSession} session - The session data to create
     * @returns {Promise<Session>} The newly created session
     */
    async createTokenSession(session: CreateTokenSession): Promise<Session> {
        var pk = session.public_key ? Security.pemToPublicKey(session.public_key) : null;
        return new Session(await this.app.database.session.create({
            data: {
                id: session.id,
                token: session.token || SessionManager.generateToken(),
                user_id: session.user_id,
                expires: session.expires,
                created_at: session.created_at,
                updated_at: session.updated_at,
                public_key: pk
                    ? Security.publicKeyToDer(pk)
                    : null,
                fingerprint: pk
                    ? Security.publicKeyToFingerprint(pk)
                    : null
            }
        }), this.app);
    }

    /**
     * Deletes a session and all its associated devices.
     * Uses a database transaction to ensure data consistency.
     * 
     * @param {Session} session - The session to delete
     * @returns {Promise<boolean>} True if deletion was successful, false otherwise
     */
    async deleteSession(session: Session): Promise<boolean> {
        try {
            await this.app.database.$transaction([
                this.app.database.device.deleteMany({ where: { session_id: session.id } }),
                this.app.database.session.delete({ where: { id: session.id } })
            ]);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Generates a secure random token for session authentication.
     * 
     * @static
     * @returns {string} A base64-encoded random token
     */
    static generateToken(): string {
        return randomBytes(64).toString('base64');
    }

    /**
     * Deletes all sessions for a specific user and their associated devices.
     * Uses a database transaction to ensure data consistency.
     * 
     * @param {number} user_id - The ID of the user whose sessions should be deleted
     * @returns {Promise<boolean>} True if deletion was successful, false otherwise
     */
    async deleteSessionsByUserId(user_id: number) {
        try {
            await this.app.database.$transaction([
                this.app.database.device.deleteMany({ where: { session: { user_id } } }),
                this.app.database.session.deleteMany({ where: { user_id } })
            ]);
            return true;
        }
        catch { }
        return false;
    }

   async findSession(authBody: string): Promise<Session | null> {
        return this.findSessionByToken(authBody);
    }
}

/**
 * Interface for creating a new session.
 * 
 * @interface CreateTokenSession
 */
export interface CreateTokenSession {
    /** Optional session ID. If not provided, one will be generated */
    id?: string;
    /** Optional session token. If not provided, one will be generated */
    token?: string;
    /** ID of the user this session belongs to */
    user_id: number;
    /** Date and time when this session expires */
    expires: Date;
    /** Date and time when this session was created */
    created_at: Date;
    /** Date and time when this session was last updated */
    updated_at: Date;
    /** Optional public key for pairing sessions */
    public_key?: string;
}