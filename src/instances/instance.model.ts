import { Instance as PrismaInstance } from 'src/generated/prisma/client';
import type { ApiInstanceLifecycle } from './lifecycle/lifecycle.types';
import type { InstanceLifecycle } from './lifecycle/lifecycle.registry';
import type { RelayWithMethods } from '../relay/relay.model';
import type { InstancesService } from './instances.service';
import { NoxIdentifier } from 'src/common/identifier';
import { Tags } from 'src/common/tags';
import { ApiInstanceConnectionDto, ApiInstanceDto } from './dto/response.dto';
import { UserWithMethods } from 'src/users/user.model';

export type InstanceWithMethods = PrismaInstance & {
  manager: InstancesService;
  sanitize(viewer?: UserWithMethods | null): Promise<ApiInstanceDto>;
  getRelay(): Promise<RelayWithMethods | null>;
  getLifecycle(): ApiInstanceLifecycle | null;
  getConnectionInfo(): Promise<ApiInstanceConnectionDto | null>;
};

export class Instance {
  // Attach the getters to a plain Instance row and return it as InstanceWithMethods.
  static attach(
    model: PrismaInstance,
    manager: InstancesService,
  ): InstanceWithMethods {
    const obj = model as unknown as InstanceWithMethods;
    Object.defineProperty(obj, 'manager', {
      value: manager,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    Object.setPrototypeOf(obj, Instance.prototype as any);
    return obj;
  }

  /**
   * The relay hosting this instance, or null while it is unassigned.
   *
   * `prisma.relayInstance` is a relation the queries do not always include, so this reads the link
   * through the manager rather than expecting `this.relayId` to be there.
   */
  async getRelay(this: InstanceWithMethods): Promise<RelayWithMethods | null> {
    const link = await this.manager.prisma.relayInstance.findUnique({
      where: { instanceId: this.id },
    });
    if (!link) return null;
    return this.manager.relayService.findById(link.relayId);
  }

  /**
   * This instance's cleanup state: `persistent`, `grace`, `removal`, or nothing to say.
   *
   * The state itself lives in the shared `InstanceLifecycle` (one per app, keyed by instance id), so
   * this is a *view* over it with `serialize` already bound to this instance — hence the
   * `instance.lifecycle.serialize()` call, with no id and tags to pass again.
   */
  getLifecycle(this: InstanceWithMethods): ApiInstanceLifecycle | null {
    return this.manager.instanceLifecycleService.serialize(this.id, this.tags);
  }

  async getConnectionInfo(
    this: InstanceWithMethods,
  ): Promise<ApiInstanceConnectionDto | null> {
    const link = await this.manager.prisma.relayInstance.findUnique({
      where: { instanceId: this.id },
    });
    const relayId = link?.relayId;
    if (!relayId) {
      this.manager.logger.debug(
        `[getConnectionInfo] Instance ${this.id} has no relayId`,
      );
      return null;
    }

    // Request status from relay to get address map and region
    const status = await this.manager.wsGateway.requestStatus(relayId);
    if (!status || !status.a) {
      this.manager.logger.debug(
        `[getConnectionInfo] No status/address from relay ${relayId} for instance ${this.id}`,
      );
      return null;
    }

    // Check if instance exists on relay
    const instancesResult = await this.manager.wsGateway.requestInstances(
      relayId,
      1000,
      0,
    );
    if (!instancesResult || !instancesResult.instances) {
      this.manager.logger.debug(
        `[getConnectionInfo] No instances list from relay ${relayId} for instance ${this.id}`,
      );
      return null;
    }

    const hasInstance = instancesResult.instances.some((i) => i.n === this.id);
    if (!hasInstance) {
      this.manager.logger.debug(
        `[getConnectionInfo] Instance ${this.id} not found in relay ${relayId} instances list`,
      );
      return null;
    }

    // Build connection data
    const addresses = Object.entries(status.a).map(
      ([proto, addr]) => `${proto}://${addr}`,
    );
    const connectionData = {
      a: addresses,
      i: this.id,
      p: status.p ?? 0,
    };

    // Region comes from the provider, not the relay binary
    const runnerInfo = await this.manager.relayService
      .getRunnerInfo(relayId)
      .catch(() => null);

    this.manager.logger.debug(
      `[getConnectionInfo] Successfully built connection for instance ${this.id} on relay ${relayId}`,
    );

    return {
      method: 'relay',
      data: Buffer.from(JSON.stringify(connectionData)).toString('base64'),
      region: runnerInfo?.region ?? null,
    };
  }

  async sanitize(
    this: InstanceWithMethods,
    viewer?: UserWithMethods | null,
  ): Promise<ApiInstanceDto> {
    const domain = await this.manager.domain();
    const apiBase = await this.manager.wellKnown.apiBaseUrl();
    const owner = NoxIdentifier.parse(this.ownerRef);
    const world = NoxIdentifier.parse(this.worldRef);

    // Get connection info automatically
    const connection = await this.getConnectionInfo();

    // ── Player list ──────────────────────────────────────────────────────────
    let count = 0;
    const players: { user: string | null; display: string }[] = [];
    const relayLink = await this.manager.prisma.relayInstance.findUnique({
      where: { instanceId: this.id },
    });
    const relayId = relayLink?.relayId;
    if (relayId) {
      // 1. Fetch instances list to resolve internal_id (i) from node master_id (n)
      const instancesResp = await this.manager.wsGateway.requestInstances(
        relayId,
        100,
        0,
      );
      const relayInstance = instancesResp?.instances?.find(
        (ri: { n: number }) => ri.n === this.id,
      ) as { i: number; p: number } | undefined;

      if (relayInstance) {
        count = relayInstance.p;
        // 2. Fetch the first 20 visible players using the internal_id
        const result = await this.manager.wsGateway.requestPlayers(
          relayId,
          relayInstance.i,
          20,
          0,
          false,
        );
        for (const p of result?.i ?? [])
          players.push({
            user: p.u ?? null,
            display: p.d,
          });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    return {
      id: this.id,
      name: this.name,
      title: this.title ?? null,
      description: this.description ?? null,
      thumbnail: this.thumbnail ?? null,
      capacity: this.capacity,
      server: domain,
      owner: owner.toString(domain),
      world: world.toString(domain),
      tags: [
        ...this.tags,
        ...(this.capacity === 0 ? [Tags.build(Tags.SYSTEM, 'unlimited')] : []),
        ...(this.useWhitelist ? [Tags.build(Tags.SYSTEM, 'whitelist')] : []),
        ...(this.password && this.usePassword
          ? [Tags.build(Tags.SYSTEM, 'password')]
          : []),
      ],
      connection,
      count,
      players,
      lifecycle: viewer?.isAdmin() ? this.getLifecycle() : null,
      alias: [
        { key: 'api', value: `${apiBase}instances/${this.id}` },
        { key: 'iid', value: `${this.id}@${domain}` },
        { key: 'nid', value: `${this.name}@${domain}` },
      ],
    };
  }
}
