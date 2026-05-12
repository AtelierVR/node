import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';

export interface TableMeta {
    key: string;
    mime: string;
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

    async getAll(userId: number, limit: number, offset: number, filter?: string): Promise<{ items: TableMeta[]; total: number }> {
        const keyFilter = buildKeyFilter(filter);
        const where = { userId, ...(keyFilter ? { key: keyFilter } : {}) };
        const [rows, total] = await Promise.all([
            this.prisma.userTables.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                take: limit,
                skip: offset,
            }),
            this.prisma.userTables.count({ where }),
        ]);

        const items: TableMeta[] = rows.map(row => ({
            key: row.key,
            mime: row.mime,
            hash: sha256(row.value),
            created_at: row.createdAt.getTime(),
            updated_at: row.updatedAt.getTime(),
        }));

        return { items, total };
    }

    async get(key: string, userId: number): Promise<TableRow | null> {
        return this.prisma.userTables.findUnique({
            where: { key_userId: { key, userId } },
        }) as Promise<TableRow | null>;
    }

    async getPublic(type: string, userId: number): Promise<TableRow | null> {
        return this.get(`public.${type}`, userId);
    }

    async listPublic(userId: number, limit: number, offset: number, filter?: string): Promise<{ items: { key: string; mime: string; hash: string; updated_at: number }[]; total: number }> {
        const keyFilter = buildKeyFilter(filter);
        const where = {
            userId,
            AND: [
                { key: { startsWith: 'public.' } },
                ...(keyFilter ? [{ key: keyFilter }] : []),
            ],
        };
        const [rows, total] = await Promise.all([
            this.prisma.userTables.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                take: limit,
                skip: offset,
                select: { key: true, mime: true, value: true, updatedAt: true },
            }),
            this.prisma.userTables.count({ where }),
        ]);
        const items = rows.map(r => ({
            key: r.key,
            mime: r.mime,
            hash: sha256(r.value),
            updated_at: r.updatedAt.getTime(),
        }));
        return { items, total };
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

/**
 * Converts a glob-style pattern (using `*` as wildcard) into a safe Prisma
 * string filter. No raw SQL is ever emitted — Prisma parameterizes all values.
 *
 * Examples:
 *   "public.*"  → { startsWith: 'public.' }
 *   "*avatar"   → { endsWith: 'avatar' }
 *   "*meta*"    → { contains: 'meta' }
 *   "profile"   → { equals: 'profile' }
 */
function buildKeyFilter(pattern: string | undefined):
    | { startsWith: string } | { endsWith: string } | { contains: string } | { equals: string }
    | undefined {
    if (!pattern || pattern.trim() === '' || pattern === '*') return undefined;
    // Limit length to prevent abuse
    const p = pattern.trim().slice(0, 200);
    const startsWithWild = p.startsWith('*');
    const endsWithWild = p.endsWith('*');
    if (startsWithWild && endsWithWild) {
        const inner = p.slice(1, -1);
        return inner ? { contains: inner } : undefined;
    }
    if (startsWithWild) return { endsWith: p.slice(1) };
    if (endsWithWild)   return { startsWith: p.slice(0, -1) };
    return { equals: p };
}
