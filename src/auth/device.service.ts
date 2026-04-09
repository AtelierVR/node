import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DeviceService {
  constructor(private readonly prisma: PrismaService) {}

  async createDevice(opts: { sessionId: string; ip: string; userAgent: string }) {
    // Use unchecked create to provide sessionId directly
    return this.prisma.devices.create({
      data: {
        sessionId: opts.sessionId,
        ip: opts.ip,
        userAgent: opts.userAgent,
        lastSeen: new Date(),
      },
    });
  }

  async upsertDevice(sessionId: string, ip: string, userAgent: string) {
    const now = new Date();
    return this.prisma.devices.upsert({
      where: { unique_device: { sessionId, ip, userAgent } as any },
      update: { lastSeen: now },
      create: { sessionId, ip, userAgent, lastSeen: now },
    });
  }

  async findDevicesBySessionId(sessionId: string) {
    return this.prisma.devices.findMany({ where: { sessionId } });
  }

  async updateDevice(sessionId: string, ip: string, userAgent: string) {
    const now = new Date();
    try {
      await this.prisma.devices.updateMany({ where: { sessionId, ip, userAgent }, data: { lastSeen: now } });
      return true;
    } catch {
      return false;
    }
  }
}
