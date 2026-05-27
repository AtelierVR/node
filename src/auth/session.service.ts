import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

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
    return session;
  }

  async findSessionByToken(token: string) {
    return this.prisma.sessions.findFirst({ where: { token } });
  }

  async deleteSessionById(id: string) {
    try {
      await this.prisma.sessions.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}
