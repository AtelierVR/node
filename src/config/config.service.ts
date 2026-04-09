import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { AppConfig, HttpConfig } from './config.schema';
import { CONFIG_REGISTRY, getLabel } from './config.decorators';
import { ConfigDelegate } from 'src/generated/prisma/models';

// Ensure schema classes are evaluated so CONFIG_REGISTRY is populated.
void HttpConfig;

/**
 * Resolved configuration with the following priority (lowest → highest):
 *
 *   Default  <  Env  <  Config (YAML)  <  Database
 *
 * Per-variable DB override: prefix the value with '!' in config.yaml or the env var
 * to lock that key and ignore whatever the database stores for it.
 *
 *   config.yaml:   http: { port: '!8080' }  → forces 8080, ignores DB for http.port
 *   env var:       HTTP_PORT=!8080           → same effect
 */
@Injectable()
export class AppConfigService implements OnModuleInit {
    private readonly logger = new Logger(AppConfigService.name);

    constructor(
        private readonly service: ConfigService<AppConfig>,
        private readonly prisma: PrismaService,
    ) { }

    get configs(): ConfigDelegate {
        return this.prisma.configs;
    }

    onModuleInit() { }

    /**
     * Resolve the value for a config key.
     *
     * Resolution order:
     *   1. Database (unless the key is locked by '!')
     *   2. Static config (YAML > Env > Default), already resolved at boot time
     */
    async get<T>(key: string): Promise<T> {
        let value = this.service.get<T>(key as keyof AppConfig);
        if (value === undefined)
            throw new Error(`Config key "${key}" not found in static config layers`);

        const overriddenKeys = this.service
            .get<string[]>('overriddenKeys' as keyof AppConfig)
            ?? [];

        if (overriddenKeys.includes(key))
            return value;

        const db = await this.configs.findFirst({ where: { key: String(key) } });
        if (!db)
            return value;

        try {
            return this.validate<T>(key, db.value);
        } catch (err) {
            this.logger.warn(`Invalid config value in DB for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
        }

        return value;
    }

    /** Like get(), but returns null instead of throwing when the key has no value. */
    async getOptional<T>(key: string): Promise<T | null> {
        const value = this.service.get<T>(key as keyof AppConfig);
        if (value === undefined) return null;

        const overriddenKeys = this.service
            .get<string[]>('overriddenKeys' as keyof AppConfig)
            ?? [];

        if (overriddenKeys.includes(key))
            return value;

        const db = await this.configs.findFirst({ where: { key: String(key) } });
        if (!db) return value;

        try {
            return this.validate<T>(key, db.value);
        } catch (err) {
            this.logger.warn(`Invalid config value in DB for key "${key}": ${err instanceof Error ? err.message : String(err)}`);
        }

        return value;
    }

    /**
     * Validate and return the object with good typing, or an error message if invalid.
     */
    private validate<T>(key: string, raw: string): T {
        const entry = CONFIG_REGISTRY.get(key);
        if (!entry)
            throw new Error(`Config key "${key}" not registered in CONFIG_REGISTRY`);

        const type = Reflect.getMetadata('design:type', entry.proto, entry.property) as Function | undefined;
        let coerced: unknown = raw;
        if (type === Number) coerced = Number(raw);
        else if (type === Boolean) coerced = raw === 'true';

        const ctor = (entry.proto as any).constructor as new () => object;
        const instance = plainToInstance(
            ctor,
            { [entry.property]: coerced },
            { enableImplicitConversion: false },
        );
        const errors = validateSync(instance as object, { skipMissingProperties: true })
            .filter((e) => e.property === entry.property);

        if (errors.length === 0)
            return coerced as T;

        throw new Error(
            `Validation failed for config key "${key}" (DB value: "${raw}"): ` +
            errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; '),
        );
    }
}