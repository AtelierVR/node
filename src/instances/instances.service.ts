import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { WellKnownService } from '../fediverse/well-known.service';
import { StorageService } from '../storage/storage.service';
import { NoxIdentifier } from '../common/identifier';
import { Tags } from '../common/tags';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import { ApiInstanceConnectionDto } from './dto/response.dto';
import type {
  InstanceCreatedEvent,
  InstanceLifecycleChangeEvent,
  InstanceRemovedEvent,
  InstanceUpdatedEvent,
} from '../events/domain-events';
import type { InstanceWithMethods } from './instance.model';
import type { InstanceLifecycle } from './lifecycle/lifecycle.registry';
import type { RelayWithMethods } from '../relay/relay.model';
import { EmitterService } from '../events/emitter.service';
import { Events } from '../events/domain-events';
import { OnWebsocketEventRegister } from '../events/websocket-event.decorator';
import { WsFrames } from '../events/websocket-frames';
import { WsService } from '../ws/ws.service';
import type { UserWithMethods } from '../users/user.model';
import { Instance } from './instance.model';
import type { Instance as PrismaInstance } from 'src/generated/prisma/client';
import type { Socket } from 'socket.io';
import type { WsGateway } from '../ws/ws.gateway';
import type { RelayService } from '../relay/relay.service';

export interface CreateInstanceDto {
  name?: string;
  title?: string | null;
  description?: string | null;
  capacity: number;
  worldRef: string;
  ownerRef: string;
  tags?: string[];
  thumbnail?: string | null;
  region?: string | null;
  useWhitelist?: boolean;
  whitelistRefs?: string[];
  usePassword?: boolean;
  password?: string | null;
}

export interface UpdateInstanceDto {
  title?: string | null;
  description?: string | null;
  capacity?: number;
  tags?: string[];
  thumbnail?: string | null;
  useWhitelist?: boolean;
  whitelistRefs?: string[];
  usePassword?: boolean;
  password?: string | null;
}

export interface InstanceSearchParams {
  query?: string;
  world?: string;
  owner?: string;
}

@Injectable()
export class InstancesService {
  public readonly logger = new Logger(InstancesService.name);

  constructor(
    public readonly prisma: PrismaService,
    public readonly wellKnown: WellKnownService,
    public readonly storage: StorageService,
    private readonly emitter: EmitterService,
    @Inject(forwardRef(() => require('../ws/ws.gateway').WsGateway))
    public readonly wsGateway: WsGateway,
    @Inject(forwardRef(() => require('../relay/relay.service').RelayService))
    public readonly relayService: RelayService,
    private readonly ws: WsService,
  ) {}

  // ── Client-facing frames ─────────────────────────────────────────────────────
  // Kept apart from the internal events above: a service decides on its own what a browser may
  // see. The guard below is what the gateways call when a socket subscribes; delivery stays the
  // explicit `this.ws.emit(...)` next to each change.

  @OnWebsocketEventRegister(WsFrames.INSTANCE_CREATED)
  @OnWebsocketEventRegister(WsFrames.INSTANCE_UPDATED)
  @OnWebsocketEventRegister(WsFrames.INSTANCE_REMOVED)
  @OnWebsocketEventRegister(WsFrames.INSTANCE_LIFECYCLE)
  private registerInstanceFrame(socket: Socket): Promise<boolean> {
    // Instance lifecycle is public: any signed-in account may follow an instance.
    return Promise.resolve(!!socket.data?.user);
  }

  /**
   * The reaper saw an instance leave its grace period and start an idle timer (or the reverse).
   *
   * It only owns the idle timer, so it cannot publish a client signal itself; this service
   * already serializes instances, so it relays the news to the admin UI. The frame is the
   * instance plus the relay whose page shows the badge — a client re-reads from there.
   *
   * Only the client frame: the domain event has already been published by the reaper, and
   * re-emitting it here would make this handler its own subscriber.
   */
  @OnEvent(Events.INSTANCE_LIFECYCLE)
  publishLifecycle(event: InstanceLifecycleChangeEvent) {
    this.ws.emit(WsFrames.INSTANCE_LIFECYCLE, {
      instance_id: event.instance_id,
      relay_id: event.relay_id,
      lifecycle: event.lifecycle,
      time: event.time,
    });
  }

  /** Where every instance reads its cleanup state from (see {@link InstanceLifecycle}). */
  get instanceLifecycleService(): InstanceLifecycle {
    return this.relayService.instanceLifecycle;
  }

  /** Graft the model getters (`relay`, `lifecycle`) onto a database row. */
  private attach(model: PrismaInstance): InstanceWithMethods {
    return Instance.attach(model, this);
  }

  async domain(): Promise<string> {
    return this.wellKnown.address();
  }

  // ── Validators ───────────────────────────────────────────────────────────────

  private static readonly NAME_REGEX = /^[a-z0-9_-]{3,32}$/;

  isValidName(name: string): boolean {
    return InstancesService.NAME_REGEX.test(name);
  }

  isValidCapacity(n: number): boolean {
    return Number.isInteger(n) && n >= 0 && n <= 65535;
  }

  generateName(): string {
    return randomBytes(4).toString('hex');
  }

  // ── Permissions ──────────────────────────────────────────────────────────────

  canCreate(user: UserWithMethods): boolean {
    return (
      user.isAdmin() ||
      Tags.has(user.tags, Tags.MODERATION, 'can_instance_create')
    );
  }

  canUploadFile(user: UserWithMethods): boolean {
    return (
      user.isAdmin() || Tags.has(user.tags, Tags.MODERATION, 'can_file_upload')
    );
  }

  canManage(user: UserWithMethods, instance: InstanceWithMethods): boolean {
    if (user.isAdmin()) return true;
    const domain = NoxIdentifier.LOCALSERVER;
    const ownerRef = NoxIdentifier.parse(instance.ownerRef);
    if (ownerRef.isLocal(domain)) {
      const ownerId = ownerRef.numericId;
      if (ownerId !== null && ownerId === user.id) return true;
    }
    return false;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  async findById(id: number): Promise<InstanceWithMethods | null> {
    const row = await this.prisma.instances.findUnique({ where: { id } });
    return row ? this.attach(row) : null;
  }

  async findByName(name: string): Promise<InstanceWithMethods | null> {
    const row = await this.prisma.instances.findUnique({ where: { name } });
    return row ? this.attach(row) : null;
  }

  async search(
    params: InstanceSearchParams,
    limit = 10,
    offset = 0,
  ): Promise<{ items: InstanceWithMethods[]; total: number }> {
    const conditions: any[] = [];

    if (params.query) {
      conditions.push({
        OR: [
          { name: { contains: params.query, mode: 'insensitive' } },
          { title: { contains: params.query, mode: 'insensitive' } },
          { description: { contains: params.query, mode: 'insensitive' } },
        ],
      });
    }

    if (params.world) conditions.push({ worldRef: params.world });
    if (params.owner) conditions.push({ ownerRef: params.owner });

    const where = conditions.length > 0 ? { AND: conditions } : {};

    const [items, total] = await Promise.all([
      this.prisma.instances.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.instances.count({ where }),
    ]);

    return { items: items.map((i) => this.attach(i)), total };
  }

  async create(dto: CreateInstanceDto): Promise<InstanceWithMethods> {
    const name =
      dto.name && this.isValidName(dto.name) ? dto.name : this.generateName();

    // Ensure uniqueness
    let finalName = name;
    let attempts = 0;
    while (
      await this.prisma.instances.findUnique({ where: { name: finalName } })
    ) {
      finalName = this.generateName();
      if (++attempts > 10)
        throw new ApiException(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          null,
          'Could not generate unique instance name',
        );
    }

    const instance = await this.prisma.instances.create({
      data: {
        name: finalName,
        title: dto.title ?? null,
        description: dto.description ?? null,
        capacity: dto.capacity,
        worldRef: dto.worldRef,
        ownerRef: dto.ownerRef,
        tags: dto.tags ?? [],
        thumbnail: dto.thumbnail ?? null,
        useWhitelist: dto.useWhitelist ?? false,
        whitelistRefs: dto.whitelistRefs ?? [],
        usePassword: dto.usePassword ?? false,
        password: dto.password ?? null,
      },
    });

    // No relay yet: the assignment is a separate event (`relay.instance.assigned`).
    const event: InstanceCreatedEvent = {
      instance_id: instance.id,
      relay_id: null,
      time: Date.now(),
    };
    this.emitter.emit(Events.INSTANCE_CREATED, event);
    this.ws.emit(WsFrames.INSTANCE_CREATED, {
      instance_id: event.instance_id,
      time: event.time,
    });
    return this.attach(instance);
  }

  async update(
    id: number,
    dto: UpdateInstanceDto,
  ): Promise<InstanceWithMethods> {
    const data = {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.capacity !== undefined && { capacity: dto.capacity }),
      ...(dto.tags !== undefined && { tags: dto.tags }),
      ...(dto.thumbnail !== undefined && { thumbnail: dto.thumbnail }),
      ...(dto.useWhitelist !== undefined && { useWhitelist: dto.useWhitelist }),
      ...(dto.whitelistRefs !== undefined && {
        whitelistRefs: dto.whitelistRefs,
      }),
      ...(dto.usePassword !== undefined && { usePassword: dto.usePassword }),
      ...(dto.password !== undefined && { password: dto.password }),
    };

    const instance = await this.prisma.instances.update({
      where: { id },
      data,
    });
    const event: InstanceUpdatedEvent = {
      instance_id: instance.id,
      fields: Object.keys(data),
      time: Date.now(),
    };
    this.emitter.emit(Events.INSTANCE_UPDATED, event);
    this.ws.emit(WsFrames.INSTANCE_UPDATED, { ...event });
    return this.attach(instance);
  }

  /**
   * Delete an instance and tell its relay to stop hosting it.
   *
   * @param dropReason why it is going away, forwarded to the relay so its logs stay meaningful.
   */
  async delete(
    id: number,
    dropReason: { reason: string; message?: string } = {
      reason: 'deleted',
      message: 'Instance deleted',
    },
  ): Promise<InstanceWithMethods | null> {
    // Read the link *before* deleting: it says which relay is hosting the instance, and it goes
    // away with the instance (cascade).
    const link = await this.prisma.relayInstance.findUnique({
      where: { instanceId: id },
    });

    try {
      const deleted = await this.prisma.instances.delete({ where: { id } });

      // Without this the relay keeps hosting — and counting — the instance forever: the node has
      // no record of it left, so nothing else can ever notice the ghost.
      if (link && this.relayService.isRelayConnected(link.relayId))
        this.wsGateway.pushToRelay(link.relayId, 'drop_instance', {
          instance_id: id,
          ...dropReason,
        });

      const event: InstanceRemovedEvent = {
        instance_id: id,
        relay_id: link?.relayId ?? null,
        reason: dropReason.reason,
        time: Date.now(),
      };
      this.emitter.emit(Events.INSTANCE_REMOVED, event);
      // The frame drops the relay it was assigned to — the removal is global, not relay-scoped.
      this.ws.emit(WsFrames.INSTANCE_REMOVED, {
        instance_id: event.instance_id,
        reason: event.reason,
        time: event.time,
      });

      return this.attach(deleted);
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }
}
