import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TunnelService } from '../tunnel/tunnel.service';
import type { TunnelContext } from '../tunnel/tunnel.service';
import { OnTunnel } from '../tunnel/tunnel.decorator';
import { UsersService } from '../users/users.service';
import { WsGateway } from '../ws/ws.gateway';
import { WellKnownService } from '../fediverse/well-known.service';
import { NoxIdentifier } from '../common/identifier';
import {
  SendNotificationInput,
  TunnelNotificationDto,
} from './notifications.types';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    public readonly prisma: PrismaService,
    private readonly tunnel: TunnelService,
    @Inject(forwardRef(() => UsersService))
    public readonly users: UsersService,
    @Inject(forwardRef(() => WsGateway))
    public readonly wsGateway: WsGateway,
    public readonly wellKnown: WellKnownService,
  ) {}

  /**
   * Send a notification to a user.
   *
   * Persisted (so the recipient can list/replay it) **unless** `expiresAt` is
   * `null`, in which case it is transient: delivered live but never stored —
   * used for e.g. a `ping` whose expiry is immediate.
   */
  async sendNotification(input: SendNotificationInput): Promise<boolean> {
    try {
      const payload: TunnelNotificationDto = {
        to: input.to.id,
        type: input.type,
        key: input.key ?? null,
        from: input.by ? input.by.id : null,
        data: input.data ?? null,
        expires_at: input.expiresAt ? input.expiresAt.getTime() : null,
      };

      // No expiry ⇒ transient: deliver without persisting.
      if (!input.expiresAt) 
        return await this.deliver(payload, input.to);

      const created = await this.prisma.notifications.create({
        data: {
          type: input.type,
          key: input.key ?? null,
          data: input.data ?? null,
          by: input.by ? input.by.toString() : null,
          to: input.to.toString(),
          expiresAt: input.expiresAt,
        },
      });

      await this.deliver(payload, input.to, created.id);
      return true;
    } catch (err) {
      this.logger.error(
        `sendNotification failed: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // ── Delivery ────────────────────────────────────────────────────────────────

  /**
   * Deliver a notification payload to its recipient.
   * - Local recipient: push it over WebSocket (marking `id` delivered when reached).
   * - Remote recipient: federate it through the generic `notification` tunnel.
   *
   * Returns true when the recipient was reached (local client(s) / remote server).
   */
  private async deliver(
    payload: TunnelNotificationDto,
    to: NoxIdentifier,
    id?: number,
  ): Promise<boolean> {
    const domain = await this.wellKnown.address();

    // Local recipient
    if (to.isLocal(domain)) {
      const targetUser = await this.users.findByIdentifier(to);
      if (!targetUser) return false;
      const sent = this.emit(targetUser.id, payload);
      if (sent > 0 && id !== undefined) 
        await this.markDelivered(id);
      return sent > 0;
    }

    // Remote recipient → federate through the generic `notification` tunnel.
    try {
      await this.tunnel.send(to.server!, 'notification', payload);
      if (id !== undefined)
        await this.markDelivered(id);
      return true;
    } catch (err) {
      this.logger.warn(
        `Tunnel notification to ${to.server} failed: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // ── Incoming ────────────────────────────────────────────────────────────────

  /**
   * Receive a notification federated by a remote server and hand it to its local
   * recipient. The tunnel id is always `notification`; the specific kind travels
   * in `dto.type`.
   */
  @OnTunnel('notification', TunnelNotificationDto)
  async onTunnelNotification(
    dto: TunnelNotificationDto,
    ctx: TunnelContext,
  ): Promise<void> {
    const domain = await this.wellKnown.address();
    const targetUser = await this.users.findByIdentifier(
      NoxIdentifier.parse(dto.to),
    );
    if (!targetUser) return;

    // `from` only carries the id: re-attach the authenticated source server so
    // the recipient gets a full identifier.
    const from = dto.from
      ? new NoxIdentifier(null, dto.from, ctx.server.address).toString()
      : null;

    // Transient (no expiry) → live only, never persisted.
    if (dto.expires_at === null) {
      this.emit(targetUser.id, { ...dto, from });
      return;
    }

    // Persist so the recipient can list it later.
    const created = await this.prisma.notifications.create({
      data: {
        type: dto.type,
        key: dto.key,
        data: dto.data ?? null,
        by: from,
        to: targetUser.identifier().toString(domain),
        expiresAt: new Date(dto.expires_at),
      },
    });

    // Mark delivered only when at least one client was actually reached.
    const sent = this.emit(targetUser.id, { ...dto, from });
    if (sent > 0) 
      await this.markDelivered(created.id);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Push a notification to a local user's clients. Returns how many were reached. */
  private emit(userId: number, n: TunnelNotificationDto): number {
    return this.wsGateway.emitToUser(userId, 'notification', {
      type: n.type,
      key: n.key,
      from: n.from,
      data: n.data,
    });
  }

  private async markDelivered(id: number): Promise<void> {
    await this.prisma.notifications.update({
      where: { id },
      data: { delivered: true },
    });
  }
}