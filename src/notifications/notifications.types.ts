import { Allow, IsInt, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { NoxIdentifier } from '../common/identifier';

/** Input shape for creating a new notification. */
export interface SendNotificationInput<T = any> {
  type: string;
  key: string | null;
  data: T | null;
  by: NoxIdentifier | null;
  to: NoxIdentifier;
  /** Absolute expiry, or `null` for a transient (never-persisted) notification. */
  expiresAt: Date | null;
}

/**
 * Payload of a generic `notification` tunnel request (server → server).
 *
 * The tunnel id is always `notification`; the notification's own `type` field
 * carries the specific kind (e.g. `location:request`, `location:invite`).
 *
 * Validated by `TunnelService` before the handler runs (see `@OnTunnel`).
 */
export class TunnelNotificationDto<T = any> {
  /** Recipient id/username, without the `@server` part. */
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** Semantic notification type (e.g. `location:request`). */
  @IsString()
  @IsNotEmpty()
  type!: string;

  /** Idempotency key, or `null` when the sender provided none. */
  @ValidateIf((o: TunnelNotificationDto) => o.key !== null)
  @IsString()
  key!: string | null;

  /** Sender id/username, or `null` when unknown. */
  @ValidateIf((o: TunnelNotificationDto) => o.from !== null)
  @IsString()
  from!: string | null;

  /** Notification payload (its shape depends on `type`), or `null`. */
  @Allow()
  data!: T | null;

  /** Absolute expiry, in ms since epoch — or `null` when the notification is transient. */
  @ValidateIf((o: TunnelNotificationDto) => o.expires_at !== null)
  @IsInt()
  expires_at!: number | null;
}
