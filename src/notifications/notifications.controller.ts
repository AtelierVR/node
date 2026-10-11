import {
  Controller,
  Get,
  Query,
  Param,
  Post,
  Req,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import {
  ApiWrappedResponse,
  ApiWrappedArrayResponse,
  ApiWrappedSuccessResponse,
  ApiErrorResponse,
} from '../api/swagger';
import { NotificationsService } from './notifications.service';
import { Notification } from './notification.model';
import { UserAuthenticatedRequest, AuthUserGuard } from '../auth/auth.guard';
import { ApiErrorCode } from '../api/api-error.factory';
import { ApiException } from '../api/api-exception';
import type { NotificationWithMethods } from './notification.model';

export interface NotificationListItem {
  id: number;
  type: string;
  key: string | null;
  from: string | null;
  to: string;
  data: any;
  label?: string;
  delivered: boolean;
  isReceived: boolean;
  expiresAt: string;
}

export class NotificationListResponseDto {
  @ApiWrappedArrayResponse(Notification)
  items!: NotificationWithMethods[];
  @ApiWrappedResponse(Notification)
  single?: NotificationWithMethods;
}

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @ApiOperation({
    summary: 'List my notifications',
    description: 'Return all pending notifications where the user is the receiver.',
  })
  @ApiWrappedArrayResponse(Notification)
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Get()
  async listMyNotifications(
    @Req() req: Request & UserAuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const lim = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 100);
    const off = Math.max(parseInt(offset ?? '0', 10) || 0, 0);

    // The user receives notifications targeted at their identifier (local).
    const userIdentifier = req.user.identifier().toString(
      await this.notifications.wellKnown.address(),
    );

    const rawItems = await this.notifications.prisma.notifications.findMany({
      where: { to: userIdentifier, isReceived: false },
      orderBy: { createdAt: 'desc' },
      take: lim,
      skip: off,
    });

    return rawItems.map((item) => Notification.attach(item, this.notifications.users));
  }

  @ApiOperation({
    summary: 'Get a single notification by key',
    description: 'Return a specific notification identified by its unique key.',
  })
  @ApiWrappedResponse(Notification)
  @ApiErrorResponse(HttpStatus.NOT_FOUND)
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Get(':key')
  async getNotification(
    @Param('key') key: string,
    @Req() req: Request & UserAuthenticatedRequest,
  ) {
    const item = await this.notifications.prisma.notifications.findFirst({
      where: { key },
    });
    if (!item)
      throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Notification (${key})`);

    const userIdentifier = req.user.identifier().toString(
      await this.notifications.wellKnown.address(),
    );
    if (item.to !== userIdentifier)
      throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Notification (${key})`);

    return Notification.attach(item, this.notifications.users);
  }

  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Mark a notification as seen by the authenticated user.',
  })
  @ApiWrappedResponse(Notification)
  @ApiErrorResponse(HttpStatus.NOT_FOUND)
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Post(':key/read')
  async markRead(
    @Param('key') key: string,
    @Req() req: Request & UserAuthenticatedRequest,
  ) {
    const item = await this.notifications.prisma.notifications.findFirst({
      where: { key },
    });
    if (!item)
      throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Notification (${key})`);

    const userIdentifier = req.user.identifier().toString(
      await this.notifications.wellKnown.address(),
    );
    if (item.to !== userIdentifier)
      throw new ApiException(ApiErrorCode.NOT_FOUND, null, `Notification (${key})`);

    await this.notifications.prisma.notifications.update({
      where: { id: item.id },
      data: { isReceived: true },
    });

    return Notification.attach(item, this.notifications.users);
  }

  @ApiOperation({
    summary: 'Mark all notifications as read',
    description: 'Mark all unread notifications for the authenticated user as seen.',
  })
  @ApiWrappedSuccessResponse()
  @ApiBearerAuth()
  @UseGuards(AuthUserGuard)
  @Post('read-all')
  async markAllRead(@Req() req: Request & UserAuthenticatedRequest) {
    const userIdentifier = req.user.identifier().toString(
      await this.notifications.wellKnown.address(),
    );

    await this.notifications.prisma.notifications.updateMany({
      where: {
        to: userIdentifier,
        isReceived: false,
      },
      data: { isReceived: true },
    });
    return { success: true };
  }
}