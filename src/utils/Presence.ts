import { PresenceStatus } from "@prisma/client";

// Mapping DB (Prisma) -> API
const PRESENCE_DB_TO_API: Record<PresenceStatus, string> = {
    ONLINE_ALL_JOIN: 'oja',
    ONLINE_JOIN: 'ojf',
    ONLINE: 'online',
    BUSY: 'busy',
    DO_NOT_DISTURB: 'dnd',
    STREAM: 'stream',
    OFFLINE: 'offline',
};

// Mapping API -> DB (Prisma)
const PRESENCE_API_TO_DB: Record<string, PresenceStatus> = {
    oja: 'ONLINE_ALL_JOIN',
    ojf: 'ONLINE_JOIN',
    online: 'ONLINE',
    busy: 'BUSY',
    dnd: 'DO_NOT_DISTURB',
    stream: 'STREAM',
    offline: 'OFFLINE',
};

/**
 * Convert DB presence status to API format
 */
export function presenceToApi(dbStatus: PresenceStatus): string {
    return PRESENCE_DB_TO_API[dbStatus] || 'offline';
}

/**
 * Convert API presence status to DB format
 */
export function presenceToDb(apiStatus: string): PresenceStatus {
    return PRESENCE_API_TO_DB[apiStatus.toLowerCase()] || 'OFFLINE';
}
