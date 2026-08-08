import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../cache/cache.service';

const SESSION_CACHE_PREFIX = 'session:';
const SESSION_CACHE_TTL = 300; // 5 minutes — refreshed on access

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  static generateToken(): string {
    return randomBytes(64).toString('base64');
  }

  async createTokenSession(opts: {
    userId: number;
    token?: string;
    expires?: Date;
    publicKeyBase64?: string | null;
  }) {
    const token = opts.token ?? SessionService.generateToken();
    const data: any = {
      token,
      userId: opts.userId,
      expires: opts.expires ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    if (opts.publicKeyBase64) {
      const keyBuf = Buffer.from(opts.publicKeyBase64, 'base64');
      data.publicKey = keyBuf;
      data.fingerprint = createHash('sha256').update(keyBuf).digest('hex');
    }
    const session = await this.prisma.sessions.create({ data });

    // Cache the newly created session
    const ttl = Math.max(60, Math.floor((session.expires.getTime() - Date.now()) / 1000));
    await this.cache.set(`${SESSION_CACHE_PREFIX}${token}`, session, ttl);

    return session;
  }

  async findSessionByToken(token: string) {
    const cacheKey = `${SESSION_CACHE_PREFIX}${token}`;

    // Try cache first
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) {
      // Refresh TTL on access
      const remainingTtl = await this.cache.ttl(cacheKey);
      if (remainingTtl > 0 && remainingTtl < 60) 
        await this.cache.set(cacheKey, cached, SESSION_CACHE_TTL);
      return cached;
    }

    // Cache miss — query database
    const session = await this.prisma.sessions.findFirst({ where: { token } });
    if (session) {
      const ttl = Math.max(60, Math.floor((session.expires.getTime() - Date.now()) / 1000));
      await this.cache.set(cacheKey, session, ttl);
    }

    return session;
  }

  async deleteSessionById(id: string) {
    try {
      const session = await this.prisma.sessions.findUnique({ where: { id } });
      if (session) 
        await this.cache.del(`${SESSION_CACHE_PREFIX}${session.token}`);
      await this.prisma.sessions.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /** List all sessions for a user, with devices included. Optional filters. */
  async listByUser(
    userId: number,
    limit: number,
    offset: number,
    filters?: { ip?: string },
  ) {
    const where: any = { userId };
    if (filters?.ip) {
      where.devices = { some: { ip: { contains: filters.ip } } };
    }
    const [sessions, total] = await Promise.all([
      this.prisma.sessions.findMany({
        where,
        include: { devices: { orderBy: { lastSeen: 'desc' } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.sessions.count({ where }),
    ]);
    return { sessions, total };
  }

  /** Delete all sessions for a user, optionally keeping one (the current session). */
  async deleteAllByUser(userId: number, exceptId?: string) {
    // Clear cache for all deleted sessions
    const sessions = await this.prisma.sessions.findMany({
      where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, token: true },
    });
    for (const s of sessions)
      await this.cache.del(`${SESSION_CACHE_PREFIX}${s.token}`);

    const where = exceptId
      ? { userId, id: { not: exceptId } }
      : { userId };
    const result = await this.prisma.sessions.deleteMany({ where });
    return result.count;
  }
}
