import { SessionModel } from '../generated/prisma/models';
import type { DeviceModel } from '../generated/prisma/models';
import { SessionService } from './session.service';
import type { WsService } from '../ws/ws.service';

// ── Device ───────────────────────────────────────────────────────────────────

/** API-friendly device shape (mirrors ApiDeviceDto). */
export interface DeviceSanitized {
    user_agent: string;
    ip: string;
    last_seen: number;
}

export type DeviceWithMethods = DeviceModel & {
    sanitize(): DeviceSanitized;
};

export class Device {
    /** Attach methods to a plain DeviceModel and return it as DeviceWithMethods. */
    static attach(model: DeviceModel): DeviceWithMethods {
        const obj = model as unknown as DeviceWithMethods;
        Object.setPrototypeOf(obj, Device.prototype as any);
        return obj;
    }

    async sanitize(this: DeviceWithMethods): Promise<DeviceSanitized> {
        const d = this as unknown as DeviceModel;
        return {
            user_agent: d.userAgent,
            ip: d.ip,
            last_seen: d.lastSeen instanceof Date ? d.lastSeen.getTime() : new Date(d.lastSeen).getTime(),
        };
    }
}

// ── Session ──────────────────────────────────────────────────────────────────

export interface SessionSanitized {
    id: string;
    current: boolean;
    active: boolean;
    public_key: string | null;
    expires_at: number;
    created_at: number;
    devices: DeviceSanitized[];
}

export type SessionWithMethods = SessionModel & {
    manager: {
        ws: WsService;
        sessions: SessionService;
    };
    sanitize(currentSessionId: string): SessionSanitized;
};

export class Session {
    /** Attach methods to a plain SessionModel and return it as SessionWithMethods. */
    static attach(
        model: SessionModel & { devices?: DeviceModel[] },
        manager: { ws: WsService; sessions: SessionService },
    ): SessionWithMethods {
        const obj = model as unknown as SessionWithMethods;
        Object.defineProperty(obj, 'manager', {
            value: manager,
            enumerable: false,
            configurable: true,
            writable: true,
        });
        Object.setPrototypeOf(obj, Session.prototype as any);
        return obj;
    }

    async sanitize(this: SessionWithMethods, currentSessionId: string): Promise<SessionSanitized> {
        const session = this as unknown as SessionModel & { devices?: DeviceModel[] };
        const isCurrent = session.id === currentSessionId;
        return {
            id: session.id,
            current: isCurrent,
            active: isCurrent || this.manager.ws.isUserConnected(session.userId),
            public_key: session.publicKey
                ? Buffer.from(session.publicKey).toString('base64')
                : null,
            expires_at: session.expires instanceof Date
                ? session.expires.getTime()
                : new Date(session.expires).getTime(),
            created_at: session.createdAt instanceof Date
                ? session.createdAt.getTime()
                : new Date(session.createdAt).getTime(),
            devices: await Promise.all(
                (session.devices ?? []).map(d => Device.attach(d).sanitize()),
            ),
        };
    }
}
