import { SetMetadata } from '@nestjs/common';
import type { WebsocketFrame } from './websocket-frames';

/** Metadata key holding every frame a method guards — one method may guard several. */
export const WEBSOCKET_FRAME_GUARD_METADATA = 'nox:websocket-frame-guards';

/**
 * Registers the access check that guards one or more client-facing WebSocket frames.
 *
 * Strictly the counterpart of `@OnEvent`, on the *other* channel. Decorate a method that answers
 * "may this socket subscribe to these frames?": the gateways call it on every `subscribe`, so the
 * policy lives next to the code that owns the frames, and there is no runtime `registerValidator()`
 * that could be forgotten.
 *
 * ```ts
 * @OnWebsocketEventRegister(WsFrame.RELAY_STATUS)
 * @OnWebsocketEventRegister(WsFrame.RELAY_CREATED)
 * private registerRelayFrames(socket: Socket): Promise<boolean> {
 *     return Promise.resolve(!!socket.data?.user?.isAdmin?.());
 * }
 * ```
 *
 * The decorated method is *not* a handler: the decorator never sends anything. Delivery stays an
 * explicit `this.ws.emit(WsFrame.X, payload)` in the business method, so a frame can never reach
 * clients as a side effect of an unrelated code path.
 *
 * @param frame the frame being guarded; must be a declared client frame
 */
export function OnWebsocketEventRegister<TFrame extends WebsocketFrame>(
  frame: TFrame,
): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    if (typeof descriptor.value !== 'function')
      throw new TypeError(
        `@OnWebsocketEventRegister(${frame}) expects a method on ${String(propertyKey)}`,
      );
    // Frames already declared by the decorators applied *below* this one: the decorator is
    // reusable, so stacking it guards every listed frame (plain SetMetadata would only keep
    // the innermost one).
    // `SetMetadata` stores on the *function*, so that is where the previous run left them.
    const already = Reflect.getMetadata(
      WEBSOCKET_FRAME_GUARD_METADATA,
      descriptor.value,
    ) as string[] | undefined;
    const frames = already?.includes(frame)
      ? already
      : [...(already ?? []), frame];

    SetMetadata(WEBSOCKET_FRAME_GUARD_METADATA, frames)(
      target,
      propertyKey,
      descriptor,
    );
    return descriptor;
  };
}
