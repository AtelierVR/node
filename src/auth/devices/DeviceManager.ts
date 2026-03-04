import Main from "../../Main";
import Device from "./Device";
import { Device as IDevice } from "@prisma/client";

/**
 * Manages device records associated with user sessions.
 * Provides methods for device creation, retrieval, updating, and deletion.
 * 
 * @class DeviceManager
 */
export default class DeviceManager {
    /**
     * Creates a new DeviceManager instance.
     * 
     * @param {Main} app - The main application instance
     */
    constructor(private readonly app: Main) { }

    /**
     * Finds a device by its unique identifier.
     * 
     * @param {number} id - The device ID to search for
     * @returns {Promise<Device | null>} The device object or null if not found
     */
    async findDeviceById(id: number): Promise<Device | null> {
        let device: IDevice | null = null;
        try {
            device = await this.app.database.device.findUnique({ where: { id } });
        } catch { }
        return device ? new Device(device, this.app) : null;
    }

    /**
     * Finds all devices associated with a specific session.
     * 
     * @param {string} session_id - The session ID to search for devices
     * @returns {Promise<Device[]>} Array of devices for the session
     */
    async findDevicesBySessionId(session_id: string): Promise<Device[]> {
        let devices: IDevice[] = [];
        try {
            devices = await this.app.database.device.findMany({ where: { session_id } });
        } catch { }
        return devices.map(device => new Device(device, this.app));
    }

    /**
     * Creates a new device in the database.
     * 
     * @param {CreateDevice} device - The device data to create
     * @returns {Promise<Device>} The newly created device
     */
    async createDevice(device: CreateDevice): Promise<Device> {
        return new Device(await this.app.database.device.create({
            data: {
                id: device.id,
                session_id: device.session_id,
                ip: device.ip,
                user_agent: device.user_agent,
                last_seen: device.last_seen,
                created_at: device.created_at,
            }
        }), this.app);
    }

    /**
     * Deletes a device from the database.
     * 
     * @param {Device} device - The device to delete
     * @returns {Promise<boolean>} True if deletion was successful, false otherwise
     */
    async deleteDevice(device: Device): Promise<boolean> {
        try {
            await this.app.database.device.delete({ where: { id: device.id } });
        } catch { return false; }
        return true;
    }

    /**
     * Updates a device by deleting the old record and creating a new one.
     * This is used to update device information while maintaining a fresh timestamp.
     * 
     * @param {string} session_id - The session ID of the device
     * @param {string} ip - The IP address of the device
     * @param {string} user_agent - The user agent string of the device
     * @returns {Promise<Device | null>} The updated device or null if operation failed
     */
    async updateDevice(session_id: string, ip: string, user_agent: string): Promise<Device | null> {
        try {
            await this.app.database.device.deleteMany({
                where: {
                    session_id,
                    ip,
                    user_agent
                }
            });
            return await this.createDevice({
                session_id,
                ip,
                user_agent,
                last_seen: new Date()
            });
        }
        catch { }
        return null;
    }
}


/**
 * Interface for creating a new device.
 * 
 * @interface CreateDevice
 */
export interface CreateDevice {
    /** Optional device ID. If not provided, one will be auto-generated */
    id?: number;
    /** ID of the session this device belongs to */
    session_id: string;
    /** IP address of the device */
    ip: string;
    /** User agent string of the device */
    user_agent: string;
    /** Optional last seen timestamp. Defaults to current time if not provided */
    last_seen?: Date;
    /** Optional creation timestamp. Defaults to current time if not provided */
    created_at?: Date;
}

