import { Device as IDevice } from "@prisma/client";
import Main from "../../Main";
import Session from "../sessions/Session";

/**
 * Represents a device associated with a user session.
 * Devices track information about the client accessing the application.
 * 
 * @class Devices
 * @implements {IDevice}
 */
export default class Devices implements IDevice {
    /**
     * Creates a new Device instance.
     * 
     * @param {IDevice} device - The device data from the database
     * @param {Main} app - The main application instance
     */
    constructor(device: IDevice, private readonly app: Main) {
        this.id = device.id;
        this.session_id = device.session_id;
        this.ip = device.ip;
        this.user_agent = device.user_agent;
        this.last_seen = device.last_seen;
        this.created_at = device.created_at;
    }

    /** Unique device identifier */
    id: number;
    /** ID of the session this device belongs to */
    session_id: string;
    /** IP address of the device */
    ip: string;
    /** User agent string of the device */
    user_agent: string;
    /** Date and time when this device was last seen */
    last_seen: Date;
    /** Date and time when this device was first created */
    created_at: Date;

    /**
     * Retrieves the session associated with this device.
     * 
     * @returns {Promise<Session | null>} The session object or null if not found
     */
    async getSession(): Promise<Session | null> {
        return this.app.sessions.findSessionById(this.session_id);
    }

    /**
     * Saves changes to this device in the database.
     * Updates the user agent and last seen timestamp.
     * 
     * @returns {Promise<boolean>} True if save was successful, false otherwise
     */
    async save(): Promise<boolean> {
        try {
            await this.app.database.device.update({
                where: { id: this.id },
                data: {
                    user_agent: this.user_agent,
                    last_seen: this.last_seen,
                }
            });
        } catch { return false; }
        return true;
    }
}