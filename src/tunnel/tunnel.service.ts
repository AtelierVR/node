import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApiException } from 'src/api/api-exception';
import { ApiErrorCode } from 'src/api/api-error.factory';
import { ExternalServersService } from '../external/external-servers.service';
import type { ExternalServerWithMethods } from '../external/external-server.model';
import {
  TUNNEL_HANDLER_METADATA,
  type TunnelHandlerMetadata,
} from './tunnel.decorator';

/** Context passed to a tunnel handler alongside the request payload. */
export interface TunnelContext {
  /** The server the request came from (already discovered & authenticated). */
  server: ExternalServerWithMethods;
}

/** A method registered with `@OnTunnel(id)`. */
export type TunnelHandler<TData = any, TResult = any> = (
  data: TData,
  context: TunnelContext,
) => Promise<TResult> | TResult;

/**
 * Server-to-server request/response over the standard tunnel.
 *
 * Outgoing: `send(server, id, data)` POSTs `{ id, data }` to the remote `/tunnel`
 * endpoint and resolves with the handler's response.
 *
 * Incoming: the `TunnelController` dispatches to the handler registered with
 * `@OnTunnel(id)` — the value it returns becomes the HTTP response body.
 *
 * This replaces the old fire-and-forget path that re-emitted tunnel frames onto
 * the in-process domain bus.
 */
@Injectable()
export class TunnelService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TunnelService.name);

  private readonly handlers = new Map<
    string,
    { handler: TunnelHandler; dto?: Type<unknown> }
  >();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly servers: ExternalServersService,
  ) {}

  onApplicationBootstrap(): void {
    const scanner = new MetadataScanner();
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as
        | Record<string, unknown>
        | null
        | undefined;
      if (!instance) continue;

      for (const method of scanner.getAllMethodNames(
        Object.getPrototypeOf(instance) as object,
      )) {
        const handler = instance[method];
        if (typeof handler !== 'function') continue;

        const meta = this.reflector.get<TunnelHandlerMetadata>(
          TUNNEL_HANDLER_METADATA,
          handler,
        );
        if (!meta) continue;

        if (this.handlers.has(meta.id))
          this.logger.warn(
            `Tunnel handler "${meta.id}" overridden by ${instance.constructor.name}.${method}`,
          );
        this.handlers.set(meta.id, {
          handler: handler.bind(instance) as TunnelHandler,
          dto: meta.dto,
        });
      }
    }

    this.logger.log(
      `Tunnel handlers: ${[...this.handlers.keys()].sort().join(', ') || 'none'}`,
    );
  }

  /** Whether a handler is registered for `id`. */
  has(id: string): boolean {
    return this.handlers.has(id);
  }

  /** Dispatch an incoming tunnel request to its registered handler. */
  async handle<TResult = unknown>(
    id: string,
    data: unknown,
    context: TunnelContext,
  ): Promise<TResult> {
    const entry = this.handlers.get(id);
    if (!entry)
      throw new ApiException(
        ApiErrorCode.NOT_FOUND,
        null,
        `Tunnel handler (${id})`,
      );
    const payload = entry.dto
      ? await this.validatePayload(id, entry.dto, data)
      : data;
    return (await entry.handler(payload, context)) as TResult;
  }

  /**
   * Validate an incoming tunnel payload against its handler's DTO.
   * Mirrors the global `ValidationPipe`: unknown properties are rejected and the
   * payload is transformed into a DTO instance.
   */
  private async validatePayload(
    id: string,
    dto: Type<unknown>,
    data: unknown,
  ): Promise<unknown> {
    const source = data && typeof data === 'object' ? data : {};
    const instance = plainToInstance(dto, source);
    const errors = await validate(instance as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length === 0) return instance;

    const details = errors
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join('; ');
    throw new ApiException(
      ApiErrorCode.VALIDATION_ERROR,
      null,
      `Tunnel "${id}" payload invalid${details ? `: ${details}` : ''}`,
    );
  }

  /**
   * Send a tunnel request to a remote server and resolve with its response.
   *
   * Throws an {@link ApiException} when the server is unreachable or its handler
   * fails. A local/placeholder address (`::`) is a no-op.
   */
  async send<TRequest = unknown, TResponse = unknown>(
    server: string,
    id: string,
    data: TRequest,
  ): Promise<TResponse> {
    if (!server || server === '::') return undefined as TResponse;

    let target: Awaited<ReturnType<ExternalServersService['discover']>>;
    try {
      target = await this.servers.discover(server);
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.warn(`Tunnel "${id}" → ${server}: discovery failed: ${msg}`);
      throw new ApiException(
        ApiErrorCode.EXTERNAL_SERVER_ERROR,
        null,
        `Tunnel "${id}" to ${server}: ${msg}`,
      );
    }

    const res = await target.fetch<TResponse>('tunnel', {
      method: 'POST',
      body: JSON.stringify({ id, data: data ?? null }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.error) {
      const msg = `[${res.error.code}] ${res.error.message}`;
      this.logger.warn(`Tunnel "${id}" → ${server}: ${msg}`);
      throw new ApiException(
        ApiErrorCode.EXTERNAL_SERVER_ERROR,
        null,
        `Tunnel "${id}" to ${server}: ${msg}`,
      );
    }

    this.logger.log(`Tunnel "${id}" → ${server}: OK`);
    return res.data as TResponse;
  }
}
