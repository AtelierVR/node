import { Table as ITable } from "@prisma/client";
import Main from "../Main";
import Table from "./Table";
import TableAPIWeb from "./TableAPIWeb";
import UserIdentifier from "../users/UserIdentifier";
import Debug from "../utils/Debug";

export default class TableManager {
    async getAllTablesForUser(id: number, ilimit: number, ioffset: number): Promise<[Table[], number]> {
        try {
            const [tables, total] = await Promise.all([
                this.app.database.table.findMany({
                    where: { user_id: id },
                    orderBy: { updated_at: 'desc' },
                    take: ilimit,
                    skip: ioffset
                }),
                this.app.database.table.count({
                    where: { user_id: id }
                })
            ]);
            return [tables.map(table => new Table(table, this.app)), total];
        } catch (error) {
            Debug.log('Error getting all tables for user:', error);
            return [[], 0];
        }
    }
    api_web: TableAPIWeb;

    constructor(private readonly app: Main) {
        this.api_web = new TableAPIWeb(app, this);
    }

    /**
     * Find a table entry by key and user reference
     */
    async findTableByKeyAndUser(key: string, userId: number): Promise<Table | null> {
        try {
            const table = await this.app.database.table.findUnique({
                where: {
                    key_user_id: {
                        key,
                        user_id: userId
                    }
                }
            });
            return table ? new Table(table, this.app) : null;
        } catch (error) {
            Debug.log('Error finding table entry:', error);
            return null;
        }
    }

    /**
     * Find all table entries for a user with optional key filter
     */
    async findTablesByUser(userId: number, keyFilter?: string): Promise<Table[]> {
        try {
            const whereClause: any = { user_id: userId };
            if (keyFilter)
                whereClause.key = keyFilter;


            const tables = await this.app.database.table.findMany({
                where: whereClause,
                orderBy: { updated_at: 'desc' }
            });
            return tables.map(table => new Table(table, this.app));
        } catch (error) {
            Debug.log('Error finding tables by user:', error);
            return [];
        }
    }

    /**
     * Create or update a table entry
     */
    async setTableValue(key: string, userId: number, value: Buffer, mime: string): Promise<Table | null> {
        try {
            const table = await this.app.database.table.upsert({
                where: {
                    key_user_id: {
                        key,
                        user_id: userId
                    }
                },
                update: {
                    value,
                    mime
                },
                create: {
                    key,
                    user_id: userId,
                    value,
                    mime
                }
            });
            return new Table(table, this.app);
        } catch (error) {
            Debug.log('Error setting table value:', error);
            return null;
        }
    }

    /**
     * Delete a table entry by key and user reference
     */
    async deleteTableEntry(key: string, userId: number): Promise<boolean> {
        try {
            await this.app.database.table.delete({
                where: {
                    key_user_id: {
                        key,
                        user_id: userId
                    }
                }
            });
            return true;
        } catch (error) {
            Debug.log('Error deleting table entry:', error);
            return false;
        }
    }

    /**
     * Delete all table entries for a user
     */
    async deleteAllTableEntriesForUser(userId: number): Promise<boolean> {
        try {
            await this.app.database.table.deleteMany({
                where: { user_id: userId }
            });
            return true;
        } catch (error) {
            Debug.log('Error deleting all table entries for user:', error);
            return false;
        }
    }

    async hasTableByKeyAndUser(key: string, id: number): Promise<boolean> {
        try {
            const table = await this.app.database.table.findFirst({
                where: {
                    key,
                    user_id: id
                }
            });
            return !!table;
        } catch (error) {
            Debug.log('Error checking table existence:', error);
            return false;
        }
    }

    /**
     * Get table statistics for a user
     */
    async getTableStatsForUser(userId: number): Promise<{ total: number; keys: string[] }> {
        try {
            const tables = await this.app.database.table.findMany({
                where: { user_id: userId },
                select: { key: true }
            });

            const keys = tables.map(t => t.key);
            const uniqueKeys = [...new Set(keys)];

            return {
                total: tables.length,
                keys: uniqueKeys
            };
        } catch (error) {
            Debug.log('Error getting table stats:', error);
            return { total: 0, keys: [] };
        }
    }
}

export interface CreateTableEntry {
    key: string;
    user_ref: string;
    value: string;
}

export interface UpdateTableEntry {
    value: string;
}
