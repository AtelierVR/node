import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';

export interface TableMeta {
    key: string;
    hash: string;
    created_at: number;
    updated_at: number;
}

export interface TableRow {
    key: string;
    userId: number;
    value: Buffer;
    mime: string;
    createdAt: Date;
    updatedAt: Date;
}

@Injectable()
export class TablesService {

    constructor(private readonly prisma: PrismaService) { }

    async getAll(userId: number, limit: number, offset: number): Promise<{ tables: Record<string, TableMeta>; total: number }> {
        const [rows, total] = await Promise.all([
            this.prisma.userTables.findMany({
                where: { userId },
                orderBy: { updatedAt: 'desc' },
                take: limit,
                skip: offset,
            }),
            this.prisma.userTables.count({ where: { userId } }),
        ]);

        const tables: Record<string, TableMeta> = {};
        for (const row of rows)
            tables[row.key] = {
                key: row.key,
                hash: sha256(row.value),
                created_at: row.createdAt.getTime(),
                updated_at: row.updatedAt.getTime(),
            };

        return { tables, total };
    }

    async get(key: string, userId: number): Promise<TableRow | null> {
        return this.prisma.userTables.findUnique({
            where: { key_userId: { key, userId } },
        }) as Promise<TableRow | null>;
    }

    async getPublic(type: string, userId: number): Promise<TableRow | null> {
        return this.get(`public.${type}`, userId);
    }

    /** Create or update a table entry. Returns the row and whether it already existed. */
    async set(key: string, userId: number, value: Buffer, mime: string): Promise<{ row: TableRow; existed: boolean }> {
        const existed = !!(await this.prisma.userTables.findUnique({
            where: { key_userId: { key, userId } },
            select: { key: true },
        }));

        const bytes = value as unknown as Uint8Array<ArrayBuffer>;
        const row = await this.prisma.userTables.upsert({
            where: { key_userId: { key, userId } },
            update: { value: bytes, mime },
            create: { key, userId, value: bytes, mime },
        });

        return { row: row as TableRow, existed };
    }

    async delete(key: string, userId: number): Promise<boolean> {
        const existing = await this.prisma.userTables.findUnique({
            where: { key_userId: { key, userId } },
            select: { key: true },
        });
        if (!existing) return false;
        await this.prisma.userTables.delete({ where: { key_userId: { key, userId } } });
        return true;
    }

    async deleteAllForUser(userId: number): Promise<void> {
        await this.prisma.userTables.deleteMany({ where: { userId } });
    }
}

function sha256(data: Buffer | Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
}
