import { ActivityEvent as PrismaInstance } from 'src/generated/prisma/client';
import { ActivityService } from './activity.service';
import { ApiActivityDto } from './dto/response.dto';
import { NoxIdentifier } from 'src/common/identifier';

export type ActivityWithMethods = PrismaInstance & {
  manager: ActivityService;
  sanitize(): Promise<ApiActivityDto>;
};

export class Activity {
  // Attach the getters to a plain ActivityEvent row and return it as ActivityWithMethods.
  static attach(
    model: PrismaInstance,
    manager: ActivityService,
  ): ActivityWithMethods {
    const obj = model as unknown as ActivityWithMethods;
    Object.defineProperty(obj, 'manager', {
      value: manager,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    Object.setPrototypeOf(obj, Activity.prototype as any);
    return obj;
  }

  async sanitize(this: ActivityWithMethods): Promise<ApiActivityDto> {
    return {
      id: this.id,
      type: this.type,
      message: this.message,
      details: this.details ?? null,
      author: this.authorRef
        ? NoxIdentifier.type(
            null,
            NoxIdentifier.parse(this.authorRef),
          ).toString(await this.manager.domain())
        : null,
      created_at: this.createdAt.toISOString(),
    };
  }
}
