import { ExternalUserModel } from 'src/generated/prisma/internal/prismaNamespaceBrowser';
import { ExternalUsersService } from './external-users.service';
import { NoxIdentifier } from 'src/common/identifier';
import { ExternalServerWithMethods } from './external-server.model';
import { ApiUser } from 'src/users/users.types';
import { ApiUserDto } from '../users/dto/user-response.dto';
import { UserWithMethods } from 'src/users/user.model';

export type ExternalUserWithMethods = ExternalUserModel & {
  manager: ExternalUsersService;
  identifier(): Promise<NoxIdentifier>;
  server(): Promise<ExternalServerWithMethods>;
  isAdmin(): boolean;
  fetch(): Promise<ApiUser>;
  isLocal(): this is UserWithMethods;
};

export class ExternalUser {
  // Attach methods to a plain ExternalUserModel instance and return it as ExternalUserWithMethods
  static attach(model: ExternalUserModel, manager: ExternalUsersService): ExternalUserWithMethods {
    const obj = model as unknown as ExternalUserWithMethods;
    Object.defineProperty(obj, 'manager', {
      value: manager,
      enumerable: false,
      configurable: true,
      writable: true,
    });

    // Ensure prototype methods are available
    Object.setPrototypeOf(obj, ExternalUser.prototype as any);
    return obj;
  }

  async server(this: ExternalUserWithMethods): Promise<ExternalServerWithMethods> {
    const serv = await this.manager.externalServers.findById(this.serverId);
    if (!serv) throw new Error(`Server with ID ${this.serverId} not found`);
    return serv;
  }

  async identifier(this: ExternalUserWithMethods): Promise<NoxIdentifier> {
    return new NoxIdentifier(null, this.id.toString(), (await this.server()).address);
  }

  async fetch(this: ExternalUserWithMethods): Promise<ApiUser> {
    const server = await this.server();
    const resp = await server.fetch<ApiUser>(`users/${this.id}`, { responseClass: ApiUserDto });
    if (resp.error || !resp.data)
      throw new Error(`Remote server returned an error for user ${this.id}@${server.address}: ${resp.error?.message ?? 'no data'}`);
    return resp.data;
  }

  isAdmin(this: ExternalUserWithMethods): boolean {
    return false;
  }

  isLocal(this: ExternalUserWithMethods): this is UserWithMethods {
    return false;
  }
}
