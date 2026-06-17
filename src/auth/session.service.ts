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
}
