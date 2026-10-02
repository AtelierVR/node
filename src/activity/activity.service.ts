import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EventsService } from '../gateway/events.service';
import { NoxIdentifier } from '../common/identifier';
import { WellKnownService } from '../fediverse/well-known.service';
import { CreateActivityEventDto } from './dto/create.dto';
import { Activity, ActivityWithMethods } from './activity.model';
import { ActivityEvent as PrismaInstance } from 'src/generated/prisma/client';

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly wellKnown: WellKnownService,
  ) {}

  async domain(): Promise<string> {
    return this.wellKnown.address();
  }

  /** Graft the model getters (`relay`, `lifecycle`) onto a database row. */
  private attach(model: PrismaInstance): ActivityWithMethods {
    return Activity.attach(model, this);
  }

  async create(dto: CreateActivityEventDto): Promise<ActivityWithMethods> {
    const activity = this.attach(
      await this.prisma.activityEvents.create({
        data: {
          type: dto.type,
          message: dto.message,
          details: dto.details ? (dto.details as any) : undefined,
          authorRef: dto.author
            ? NoxIdentifier.type(
                null,
                NoxIdentifier.parse(dto.author),
              ).toString()
            : null,
        },
      }),
    );

    this.events.emit('activity', event);
    return activity;
  }

  async search(opts: {
    q?: string;
    type?: string;
    limit: number;
    offset: number;
  }): Promise<{ total: number; items: ActivityWithMethods[] }> {
    const where: any = {};

    if (opts.type) where.type = opts.type;
    if (opts.q)
      where.OR = [
        { type: { contains: opts.q, mode: 'insensitive' } },
        { message: { contains: opts.q, mode: 'insensitive' } },
      ];

    const [total, rows] = await Promise.all([
      this.prisma.activityEvents.count({ where }),
      this.prisma.activityEvents.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
        skip: opts.offset,
      }),
    ]);

    return {
      total,
      items: rows.map((a) => this.attach(a)),
    };
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
