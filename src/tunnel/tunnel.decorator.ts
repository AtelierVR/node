import { SetMetadata } from '@nestjs/common';
import type { Type } from '@nestjs/common';

/** Metadata key holding the tunnel handler registration. */
export const TUNNEL_HANDLER_METADATA = 'nox:tunnel-handler';

/** Registration stored by {@link OnTunnel}. */
export interface TunnelHandlerMetadata {
  /** Handler id a caller targets with `send(server, id, data)`. */
  id: string;
  /** DTO validating the incoming payload before the handler runs. */
  dto?: Type<unknown>;
}

/**
 * Registers a method as the handler for an incoming tunnel request.
 *
 * The counterpart of `this.tunnel.send(...)` on the other server: pick an `id`,
 * answer it here, and the caller gets your return value back as the response.
 *
 * ```ts
 * @OnTunnel<S2SRelationResponseDto>('relation', S2SRelationDto)
 * async onRelation(dto: S2SRelationDto, ctx: TunnelContext) {
 *     return this.s2sSync(ctx.server.address, dto);
 * }
 * ```
 *
 * The decorated method *is* the handler: its return value (awaited if a Promise)
 * is sent back to the caller. `TResponse` documents/constrains that value — the
 * caller types its `send()` with the same response shape.
 *
 * When a `dto` is given, `TunnelService` validates the incoming payload against
 * it (whitelist + reject unknown properties) before calling the handler, and
 * passes the transformed instance. An invalid payload yields a 422.
 *
 * @param id  the tunnel handler id; a caller reaches it with `send(server, id, data)`
 * @param dto optional DTO class used to validate/transform the incoming payload
 */
export function OnTunnel<TResponse = unknown>(
  id: string,
  dto?: Type<unknown>,
): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    if (typeof descriptor.value !== 'function')
      throw new TypeError(
        `@OnTunnel(${id}) expects a method on ${String(propertyKey)}`,
      );
    const meta: TunnelHandlerMetadata = { id, dto };
    SetMetadata(TUNNEL_HANDLER_METADATA, meta)(
      target,
      propertyKey,
      descriptor,
    );
    return descriptor;
  };
}
