import { Controller, Get, Post, Req, UseGuards, Query, Body, ParseArrayPipe, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiWrappedResponse, ApiWrappedArrayResponse, ApiErrorResponse } from '../api/swagger';
import { ServerLogsResponseDto, ServerConfigEntryDto, ConfigPatchResponseDto, InstanceConfigDto } from './dto/server-api-response.dto';
import { UserAuthenticatedRequest } from '../auth/auth.guard';
import { AdminUserGuard } from '../auth/admin-user.guard';
import { AppConfigService } from '../config/config.service';
import { UsersService } from '../users/users.service';
import Logger from '../utils/logger';
import { CONFIG_REGISTRY, getLabel, getDescription, getIsRisky } from '../config/config.decorators';
import { ConfigService } from '@nestjs/config';
import { ConfigPatchItemDto } from './dto/patch-configs.dto';

@ApiTags('Server')
@Controller()
export class ServerController {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly users: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({ summary: 'Get server logs', description: 'Return recent in-memory log entries. Admin only.' })
  @ApiWrappedResponse(ServerLogsResponseDto)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.FORBIDDEN)
  @ApiBearerAuth()
  @UseGuards(AdminUserGuard)
  @Get('logs')
  async getLogs(@Req() req: Request & UserAuthenticatedRequest, @Query('limit') limit?: string, @Query('after') after?: string) {
    let ilimit = parseInt(limit ?? '500', 10);
    if (Number.isNaN(ilimit) || ilimit <= 0) ilimit = 500;
    if (ilimit > 1000) ilimit = 1000;

    const iafter = after ? parseInt(after, 10) : undefined;

    const logs = Logger.getLogs(ilimit, iafter).map((l) => ({
      timestamp: l.timestamp.getTime(),
      level: l.level,
      tag: l.tag ?? null,
      message: l.message,
    }));

    return { items: logs, total: logs.length };
  }

  @ApiOperation({ summary: 'Instance config', description: 'Return public instance configuration (e.g. registration status).' })
  @ApiWrappedResponse(InstanceConfigDto)
  @Get('configs')
  async getInstanceConfig() {
    return {
      allowUserRegistration: await this.appConfig.get<boolean>('instance.registration'),
      allowInstanceCreation: await this.appConfig.get<boolean>('instance.instanceCreation'),
      allowInstanceCreationByExternal: await this.appConfig.get<boolean>('instance.instanceCreationByExternal'),
      allowWorldCreation: await this.appConfig.get<boolean>('instance.worldCreation'),
      allowWorldCreationByExternal: await this.appConfig.get<boolean>('instance.worldCreationByExternal'),
      allowAvatarCreation: await this.appConfig.get<boolean>('instance.avatarCreation'),
      allowAvatarCreationByExternal: await this.appConfig.get<boolean>('instance.avatarCreationByExternal'),
    };
  }

  @ApiOperation({ summary: 'List environment', description: 'Return all registered config keys with their current values, environment overrides and metadata. Admin only.' })
  @ApiWrappedArrayResponse(ServerConfigEntryDto)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.FORBIDDEN)
  @ApiBearerAuth()
  @UseGuards(AdminUserGuard)
  @Get('environment')
  async getConfigs(@Req() req: Request & UserAuthenticatedRequest) {
    const rows = await this.appConfig.configs.findMany();
    const overrideMap = new Map(rows.map((r) => [r.key, r.value]));

    const configs = [] as any[];
    for (const [key, entry] of CONFIG_REGISTRY) {
      const envRaw = (process.env as Record<string, string | undefined>)[entry.env];
      const isForced = envRaw !== undefined && envRaw.startsWith('!');
      const envValue = isForced ? envRaw!.slice(1) : (envRaw ?? null);
      const dbValue = overrideMap.get(key) ?? null;

      // Try to read the resolved static config value via ConfigService (fall back to metadata default)
      let defaultValue: any = null;
      try { defaultValue = this.configService.get(key as any); } catch { defaultValue = null; }

      configs.push({
        key,
        label: getLabel(entry.proto, entry.property) ?? null,
        description: getDescription(entry.proto, entry.property) ?? null,
        default: defaultValue,
        environment: envValue,
        override: dbValue,
        forced: isForced,
        risky: getIsRisky(entry.proto, entry.property),
      });
    }

    return { total: configs.length, items: configs };
  }

  @ApiOperation({ summary: 'Patch environment', description: 'Upsert or delete config overrides. Send an array of { key, value } patches; null value removes the override. Admin only.' })
  @ApiWrappedResponse(ConfigPatchResponseDto, HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.UNAUTHORIZED)
  @ApiErrorResponse(HttpStatus.FORBIDDEN)
  @ApiBearerAuth()
  @UseGuards(AdminUserGuard)
  @Post('environment')
  async patchConfigs(
    @Req() req: Request & UserAuthenticatedRequest,
    @Body(new ParseArrayPipe({ items: ConfigPatchItemDto })) items: ConfigPatchItemDto[],
  ) {
    const validKeys = new Set(Array.from(CONFIG_REGISTRY.keys()));
    const results: { key: string; ok: boolean; error?: string }[] = [];

    for (const item of items) {
      if (!validKeys.has(item.key)) {
        results.push({ key: item.key, ok: false, error: 'unknown key' });
        continue;
      }

      try {
        if (item.value === null) {
          await this.appConfig.configs.deleteMany({ where: { key: item.key } });
        } else {
          await this.appConfig.configs.upsert({
            where: { key: item.key },
            create: { key: item.key, value: item.value },
            update: { value: item.value },
          });
        }
        results.push({ key: item.key, ok: true });
      } catch (err: any) {
        results.push({ key: item.key, ok: false, error: err?.message ?? String(err) });
      }
    }

    return { results };
  }
}
