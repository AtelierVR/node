import {
    Controller, Get, Post, Param, Req, Res, Query,
    HttpCode, HttpStatus, Header, Inject, forwardRef,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ActivityPubService } from './activitypub.service';
import { UsersService } from '../../users/users.service';
import { WellKnownService } from '../well-known.service';
import { ACTIVITYPUB_CONTENT_TYPE, AP_CONTEXT } from './activitypub.types';
import type { APObject } from './activitypub.types';

@Controller('ap')
export class ActivityPubController {
    constructor(
        private readonly ap: ActivityPubService,
        @Inject(forwardRef(() => UsersService))
        private readonly users: UsersService,
        private readonly wellKnown: WellKnownService,
    ) { }

    // ── Actor ───────────────────────────────────────────────────────────────

    @Get('u/:username')
    @Header('Content-Type', ACTIVITYPUB_CONTENT_TYPE)
    async getActor(
        @Param('username') username: string,
        @Res() res: Response,
    ) {
        const user = await this.users.findByUsername(username);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const actor = await user.buildActor();
        return res.json(actor);
    }

    // ── Inbox ───────────────────────────────────────────────────────────────

    @Post('u/:username/inbox')
    @Header('Content-Type', ACTIVITYPUB_CONTENT_TYPE)
    @HttpCode(HttpStatus.ACCEPTED)
    async postInbox(
        @Param('username') username: string,
        @Req() req: Request,
    ) {
        const activity = req.body as APObject;
        if (!activity || !activity.type) {
            return { error: 'Invalid ActivityPub activity' };
        }
        await this.ap.processInbox(username, activity);
        return { status: 'accepted' };
    }

    @Get('u/:username/inbox')
    @Header('Content-Type', ACTIVITYPUB_CONTENT_TYPE)
    async getInbox(@Param('username') username: string) {
        const actorUrl = `${await this.wellKnown.activityPubUrl()}u/${username}`;
        return {
            '@context': AP_CONTEXT,
            id: `${actorUrl}/inbox`,
            type: 'OrderedCollection',
            totalItems: 0,
        };
    }

    // ── Outbox ──────────────────────────────────────────────────────────────

    @Get('u/:username/outbox')
    @Header('Content-Type', ACTIVITYPUB_CONTENT_TYPE)
    async getOutbox(
        @Param('username') username: string,
        @Query('page') page?: string,
    ) {
        const pageNum = page !== undefined ? parseInt(page, 10) : undefined;
        return this.ap.getOutbox(username, isNaN(pageNum as any) ? undefined : pageNum);
    }

    // ── Followers ───────────────────────────────────────────────────────────

    @Get('u/:username/followers')
    @Header('Content-Type', ACTIVITYPUB_CONTENT_TYPE)
    async getFollowers(
        @Param('username') username: string,
    ) {
        return this.ap.getFollowers(username);
    }

    // ── Following ───────────────────────────────────────────────────────────

    @Get('u/:username/following')
    @Header('Content-Type', ACTIVITYPUB_CONTENT_TYPE)
    async getFollowing(
        @Param('username') username: string,
    ) {
        return this.ap.getFollowing(username);
    }

    // ── WebFinger (discovery) ───────────────────────────────────────────────
    // Note: WebFinger is already handled by WellKnownController
}
