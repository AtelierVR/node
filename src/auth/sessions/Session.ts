import { $Enums, Session as ISession } from "@prisma/client";
import Main from "../../Main";
import User from "../../users/User";
import Device from "../devices/Device";

/**
 * Represents a user session in the authentication system.
 * Sessions are used to maintain user authentication state and track associated devices.
 * 
 * @class Session
 * @implements {ISession}
 */
export default class Session implements ISession {
    /**
     * Creates a new Session instance.
     * 
     * @param {ISession} session - The session data from the database
     * @param {Main} app - The main application instance
     */
    constructor(session: ISession, private readonly app: Main) {
        this.id = session.id;
        this.token = session.token;
        this.user_id = session.user_id;
        this.expires = session.expires;
        this.created_at = session.created_at;
        this.updated_at = session.updated_at;
        this.public_key = session.public_key;
        this.fingerprint = session.fingerprint;
    }

    /** Public key for this session, if available */
    public_key: Uint8Array<ArrayBufferLike> | null;
    /** Fingerprint of the public key, if available */
    fingerprint: string | null;
    /** Unique session identifier */
    id: string;
    /** Authentication token/public key for this session */
    token: string;
    /** ID of the user who owns this session */
    user_id: number;
    /** Date and time when this session expires */
    expires: Date;
    /** Date and time when this session was created */
    created_at: Date;
    /** Date and time when this session was last updated */
    updated_at: Date;

    /**
     * Retrieves the user associated with this session.
     * 
     * @returns {Promise<User | null>} The user object or null if not found
     */
    async getUser(): Promise<User | null> {
        return this.app.users.findUserById(this.user_id);
    }

    /**
     * Retrieves all devices associated with this session.
     * 
     * @returns {Promise<Device[]>} Array of devices for this session
     */
    async getDevices(): Promise<Device[]> {
        return this.app.devices.findDevicesBySessionId(this.id);
    }

    /**
     * Registers a new device for this session.
     * 
     * @param {string} ip - The IP address of the device
     * @param {string} userAgent - The user agent string of the device
     * @returns {Promise<Device>} The newly created device
     */
    async register(ip: string, userAgent: string): Promise<Device> {
        const device = await this.app.devices.createDevice({
            session_id: this.id,
            ip,
            user_agent: userAgent,
            last_seen: new Date()
        });
        return device;
    }

    /**
     * Updates the device logs for this session with new IP and user agent information.
     * 
     * @param {string} ip - The new IP address to log
     * @param {string} userAgent - The new user agent string to log
     * @returns {Promise<boolean>} True if update was successful
     */
    async updateLogs(ip: string, userAgent: string): Promise<boolean> {
        await this.app.devices.updateDevice(this.id, ip, userAgent);
        return true;
    }
}