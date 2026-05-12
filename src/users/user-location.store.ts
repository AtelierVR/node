import { Injectable } from '@nestjs/common';

interface LocationEntry {
    iid: string;
    at: number; // Unix ms timestamp when set_location was received
}

/**
 * In-memory store for the current instance locations of connected users.
 * Each socket can be in at most one instance; a user may have multiple sockets
 * in different instances simultaneously (e.g. multiple game windows).
 * Cleared when the user's last socket disconnects.
 *
 * No database dependency — purely ephemeral, scoped to the process lifetime.
 */
@Injectable()
export class UserLocationStore {
    /** userId → map of iid → entry */
    private readonly locations = new Map<number, Map<string, LocationEntry>>();

    /** iid → map of userId → at (reverse index for fast instance player lookup) */
    private readonly instanceUsers = new Map<string, Map<number, number>>();

    /** Add or refresh one location entry with the given timestamp. */
    addLocation(userId: number, iid: string, at: number): void {
        let map = this.locations.get(userId);
        if (!map) { map = new Map(); this.locations.set(userId, map); }
        map.set(iid, { iid, at });

        let users = this.instanceUsers.get(iid);
        if (!users) { users = new Map(); this.instanceUsers.set(iid, users); }
        users.set(userId, at);
    }

    /** Remove one specific location. Returns true if the user's map is now empty. */
    removeLocation(userId: number, iid: string): boolean {
        const map = this.locations.get(userId);
        if (!map) return true;
        map.delete(iid);
        if (map.size === 0) { this.locations.delete(userId); }

        const users = this.instanceUsers.get(iid);
        if (users) {
            users.delete(userId);
            if (users.size === 0) this.instanceUsers.delete(iid);
        }

        return !map || map.size === 0;
    }

    /** Remove all locations for a user (e.g. all sockets disconnected). */
    clearLocations(userId: number): void {
        const map = this.locations.get(userId);
        if (map) {
            for (const iid of map.keys()) {
                const users = this.instanceUsers.get(iid);
                if (users) {
                    users.delete(userId);
                    if (users.size === 0) this.instanceUsers.delete(iid);
                }
            }
        }
        this.locations.delete(userId);
    }

    /** Returns iids sorted by most recent first. */
    getLocations(userId: number): string[] {
        const map = this.locations.get(userId);
        if (!map) return [];
        return Array.from(map.values())
            .sort((a, b) => b.at - a.at)
            .map(e => e.iid);
    }

    /**
     * Returns userIds for all users currently in the given instance,
     * sorted by earliest join time first (oldest player first).
     */
    getUsersInInstance(iid: string): number[] {
        const users = this.instanceUsers.get(iid);
        if (!users) return [];
        return Array.from(users.entries())
            .sort((a, b) => a[1] - b[1])
            .map(e => e[0]);
    }
}
