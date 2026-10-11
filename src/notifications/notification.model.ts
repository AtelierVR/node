import { NotificationModel } from 'src/generated/prisma/models/Notification';
import { UsersService } from '../users/users.service';
import { NoxIdentifier } from '../common/identifier';

export type NotificationWithMethods = NotificationModel & {
  manager: UsersService;
  /** Sender identifier (by field) — null when the notification has no sender. */
  by(): NoxIdentifier | null;
  /** Receiver identifier (to field). */
  to(): NoxIdentifier;
};

export class Notification {
  static attach(model: NotificationModel, manager: UsersService): NotificationWithMethods {
    const obj = model as unknown as NotificationWithMethods;
    Object.defineProperty(obj, 'manager', {
      value: manager,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    Object.setPrototypeOf(obj, Notification.prototype as any);
    return obj;
  }

  by(): NoxIdentifier | null {
    const value = (this as unknown as NotificationModel).by;
    return value ? NoxIdentifier.parse(value) : null;
  }

  to(): NoxIdentifier {
    return NoxIdentifier.parse((this as unknown as NotificationModel).to);
  }
}