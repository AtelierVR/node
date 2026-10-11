import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * How long a device is considered "already seen" before its `last_seen` is
 * written again. A session browsed from the same IP and User-Agent during that
 * window costs a single write.
 */
const TOUCH_INTERVAL_MS = 5 * 60_000;

/** Upper bound of the in-memory touch registry before stale entries are dropped. */
const TOUCH_CACHE_LIMIT = 2048;

/**
 * Normalizes a User-Agent: `null` when the client sends none, an empty string,
 * or nothing but whitespace.
 */
function normalizeUserAgent(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

@Injectable()
export class DeviceService {
  /**
   * Last device recorded per session, so a burst of requests from the same
   * browser does not write `devices` on every call.
   */
  private readonly touched = new Map<
    string,
    { ip: string; userAgent: string | null; at: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async createDevice(opts: {
    sessionId: string;
    ip: string;
    userAgent: string | null;
  }) {
    // Use unchecked create to provide sessionId directly
    return this.prisma.devices.create({
      data: {
        sessionId: opts.sessionId,
        ip: opts.ip,
        userAgent: normalizeUserAgent(opts.userAgent),
        lastSeen: new Date(),
      },
    });
  }

  /**
   * Records `(session, ip, user-agent)` as a device, or refreshes its
   * `last_seen`. A missing or empty User-Agent is stored as `null`.
   *
   * The lookup is a `findFirst` rather than a compound `upsert`: the key is
   * nullable and Prisma cannot express `user_agent IS NULL` in a unique input.
   * The `NULLS NOT DISTINCT` unique index still guarantees one row per device,
   * so a race at worst loses a single `last_seen` update.
   */
  async upsertDevice(
    sessionId: string,
    ip: string,
    userAgent: string | null,
  ) {
    const agent = normalizeUserAgent(userAgent);
    const now = new Date();

    const existing = await this.prisma.devices.findFirst({
      where: { sessionId, ip, userAgent: agent },
    });
    if (existing)
      return this.prisma.devices.update({
        where: { id: existing.id },
        data: { lastSeen: now },
      });

    return this.prisma.devices.create({
      data: { sessionId, ip, userAgent: agent, lastSeen: now },
    });
  }

  async findDevicesBySessionId(sessionId: string) {
    return this.prisma.devices.findMany({ where: { sessionId } });
  }

  /**
   * Records the device of an authenticated request: `last_seen` moves forward,
   * and using the session from another IP or User-Agent adds a device to it.
   * `userAgent` may be `null` — the device is still recorded.
   *
   * Throttled per session — a request from the same `(ip, userAgent)` pair
   * within {@link TOUCH_INTERVAL_MS} is not written again, so a page loading
   * twenty resources still costs one write. Never throws: authentication must
   * not depend on device bookkeeping.
   */
  async touchDevice(
    sessionId: string,
    ip: string,
    userAgent: string | null,
  ): Promise<void> {
    const agent = normalizeUserAgent(userAgent);
    const now = Date.now();
    const previous = this.touched.get(sessionId);
    if (
      previous &&
      previous.ip === ip &&
      previous.userAgent === agent &&
      now - previous.at < TOUCH_INTERVAL_MS
    )
      return;

    if (this.touched.size >= TOUCH_CACHE_LIMIT)
      for (const [id, entry] of this.touched)
        if (now - entry.at >= TOUCH_INTERVAL_MS) this.touched.delete(id);
    this.touched.set(sessionId, { ip, userAgent: agent, at: now });

    try {
      await this.upsertDevice(sessionId, ip, agent);
    } catch {
      // The session was revoked between the guard and this write, or two
      // requests raced on the same new device: both are harmless.
      this.touched.delete(sessionId);
    }
  }

  async updateDevice(
    sessionId: string,
    ip: string,
    userAgent: string | null,
  ) {
    const now = new Date();
    try {
      await this.prisma.devices.updateMany({
        where: { sessionId, ip, userAgent: normalizeUserAgent(userAgent) },
        data: { lastSeen: now },
      });
      return true;
    } catch {
      return false;
    }
  }
}
