import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { CreateActivityEventDto, ApiActivityEvent } from './activity.types';
import { EventsService } from '../gateway/events.service';

@Injectable()
export class ActivityService {

    constructor(
        private readonly prisma: PrismaService,
        private readonly events: EventsService,
    ) { }

    private sanitize(row: {
        id: number;
        type: string;
        message: string;
        details: unknown;
        authorRef: string | null;
        createdAt: Date;
    }): ApiActivityEvent {
        return {
            id: row.id,
            type: row.type,
            message: row.message,
            details: row.details ?? null,
            author: row.authorRef ?? null,
            created_at: row.createdAt.toISOString(),
        };
    }

    async create(dto: CreateActivityEventDto): Promise<ApiActivityEvent> {
        const row = await this.prisma.activityEvents.create({
            data: {
                type: dto.type,
                message: dto.message,
                details: dto.details !== undefined ? (dto.details as any) : undefined,
                authorRef: dto.author ?? null,
            },
        });
        const event = this.sanitize(row);
        this.events.emit('activity', event);
        return event;
    }

    async list(opts: {
        type?: string;
        limit: number;
        offset: number;
    }): Promise<{ total: number; items: ApiActivityEvent[] }> {
        const where = opts.type ? { type: opts.type } : {};
        const [total, rows] = await Promise.all([
            this.prisma.activityEvents.count({ where }),
            this.prisma.activityEvents.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: opts.limit,
                skip: opts.offset,
            }),
        ]);
        return { total, items: rows.map(r => this.sanitize(r)) };
    }

    async deleteById(id: number): Promise<boolean> {
        try {
            await this.prisma.activityEvents.delete({ where: { id } });
            return true;
        } catch {
            return false;
        }
    }
}
