import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { PrismaService } from '../database/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AppConfigService } from '../config/config.service';
import { ApiException } from '../api/api-exception';
import { ApiErrorCode } from '../api/api-error.factory';
import type { UserWithMethods } from 'src/users/user.model';

/** Public representation of a registered passkey (never exposes key material). */
export interface PasskeySummary {
  id: string;
  name: string | null;
  device_type: string;
  backed_up: boolean;
  discoverable: boolean;
  transports: string[];
  created_at: number;
  last_used_at: number | null;
}

export interface RegistrationOptionsResult {
  /** Opaque handle for the challenge — pass it back to `verifyRegistration`. */
  ceremony_id: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface AuthenticationOptionsResult {
  ceremony_id: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export interface RegisteredPasskey {
  verified: boolean;
  passkey: PasskeySummary;
}

export interface AuthenticatedPasskey {
  userId: number;
  credentialId: string;
}

/**
 * The ceremony kind a challenge was issued for. A challenge can only be consumed
 * by the ceremony it was created for (no cross-protocol replay).
 */
type CeremonyKind = 'registration' | 'authentication';

interface StoredChallenge {
  kind: CeremonyKind;
  challenge: string;
  /** For registration: the owner. For authentication: the account the login was started for (absent for usernameless). */
  userId?: number;
}

const CHALLENGE_PREFIX = 'passkey:challenge:';
const DEFAULT_CHALLENGE_TTL = 300;
const MAX_NAME_LENGTH = 64;

/**
 * WebAuthn (passkey) ceremonies.
 *
 * A ceremony is always two round-trips: the server issues a challenge, the
 * authenticator signs it, the server verifies the signature. Challenges are
 * single-use, short-lived, and stored server-side behind an opaque `ceremony_id`
 * so the client never has to keep state.
 *
 * Covers three use cases:
 *  - registration — adding a passkey to an account;
 *  - passwordless login — assertion without a prior password check;
 *  - second factor — the same assertion, started after a successful password check.
 */
@Injectable()
export class PasskeyService {
  private readonly logger = new Logger(PasskeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: AppConfigService,
  ) {}

  // ── Settings ─────────────────────────────────────────────────────────────────

  private async settings() {
    const [rpName, rpId, origins, ttl] = await Promise.all([
      this.config.get<string>('passkey.rp_name').catch(() => 'Nox'),
      this.config.get<string>('passkey.rp_id').catch(() => 'localhost'),
      this.config.get<string>('passkey.origins').catch(() => ''),
      this.config
        .get<number>('passkey.challenge_ttl')
        .catch(() => DEFAULT_CHALLENGE_TTL),
    ]);

    return {
      rpName: rpName || 'Nox',
      rpId: rpId || 'localhost',
      origins: (origins ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_CHALLENGE_TTL,
    };
  }

  // ── Challenge storage ────────────────────────────────────────────────────────

  private async putChallenge(
    payload: StoredChallenge,
    ttl: number,
  ): Promise<string> {
    const ceremonyId = randomUUID();
    await this.cache.set(`${CHALLENGE_PREFIX}${ceremonyId}`, payload, ttl);
    return ceremonyId;
  }

  /** Reads a challenge and deletes it — challenges are strictly single-use. */
  private async takeChallenge(
    ceremonyId: string,
    kind: CeremonyKind,
  ): Promise<StoredChallenge> {
    const key = `${CHALLENGE_PREFIX}${ceremonyId}`;
    const stored = await this.cache.get<StoredChallenge>(key);
    if (!stored || stored.kind !== kind)
      throw new ApiException(
        ApiErrorCode.BAD_REQUEST,
        null,
        'Passkey ceremony expired — please restart',
      );
    await this.cache.del(key);
    return stored;
  }

  // ── Serialisation ────────────────────────────────────────────────────────────

  private toSummary(row: {
    id: string;
    name: string | null;
    deviceType: string;
    backedUp: boolean;
    discoverable: boolean;
    transports: string[];
    createdAt: Date;
    lastUsedAt: Date | null;
  }): PasskeySummary {
    return {
      id: row.id,
      name: row.name,
      device_type: row.deviceType,
      backed_up: row.backedUp,
      discoverable: row.discoverable,
      transports: row.transports,
      created_at: row.createdAt.getTime(),
      last_used_at: row.lastUsedAt ? row.lastUsedAt.getTime() : null,
    };
  }

  // ── Management ───────────────────────────────────────────────────────────────

  /** All passkeys registered by a user (newest first). */
  async list(userId: number): Promise<PasskeySummary[]> {
    const rows = await this.prisma.passkeys.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toSummary(r));
  }

  /** True when the user has at least one passkey registered. */
  async hasPasskeys(userId: number): Promise<boolean> {
    return (await this.prisma.passkeys.count({ where: { userId } })) > 0;
  }

  /** Removes one of the user's passkeys. Returns false when it does not exist. */
  async remove(userId: number, id: string): Promise<boolean> {
    const row = await this.prisma.passkeys.findFirst({ where: { id, userId } });
    if (!row) return false;
    await this.prisma.passkeys.delete({ where: { id: row.id } });
    return true;
  }

  /** Renames one of the user's passkeys. */
  async rename(
    userId: number,
    id: string,
    name: string | null,
  ): Promise<PasskeySummary | null> {
    const row = await this.prisma.passkeys.findFirst({ where: { id, userId } });
    if (!row) return null;
    const updated = await this.prisma.passkeys.update({
      where: { id: row.id },
      data: { name: name ? name.trim().slice(0, MAX_NAME_LENGTH) : null },
    });
    return this.toSummary(updated);
  }

  // ── Registration ─────────────────────────────────────────────────────────────

  async registrationOptions(
    user: UserWithMethods,
  ): Promise<RegistrationOptionsResult> {
    const { rpName, rpId, ttl } = await this.settings();

    const existing = await this.prisma.passkeys.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
    });

    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      // Stable per-account handle — never the username (it can change).
      userID: isoUint8Array.fromUTF8String(String(user.id)),
      userName: user.username,
      userDisplayName: user.display ?? user.username,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      extensions: { credProps: true },
    });

    const ceremony_id = await this.putChallenge(
      { kind: 'registration', challenge: options.challenge, userId: user.id },
      ttl,
    );

    return { ceremony_id, options };
  }

  async verifyRegistration(
    user: UserWithMethods,
    ceremonyId: string,
    response: RegistrationResponseJSON,
    name?: string,
  ): Promise<RegisteredPasskey> {
    const { rpId, origins } = await this.settings();
    const stored = await this.takeChallenge(ceremonyId, 'registration');

    if (stored.userId !== user.id)
      throw new ApiException(
        ApiErrorCode.UNAUTHORIZED,
        null,
        'Passkey ceremony belongs to another account',
      );

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: stored.challenge,
        expectedOrigin: origins,
        expectedRPID: rpId,
        requireUserVerification: false,
      });
    } catch (err) {
      this.logger.warn(
        `Registration verification failed for user ${user.id}: ${(err as Error).message}`,
      );
      throw new ApiException(
        ApiErrorCode.VALIDATION_ERROR,
        null,
        'Passkey registration could not be verified',
      );
    }

    if (!verification.verified || !verification.registrationInfo)
      throw new ApiException(
        ApiErrorCode.VALIDATION_ERROR,
        null,
        'Passkey registration could not be verified',
      );

    const info = verification.registrationInfo;
    const credential = info.credential;

    const existing = await this.prisma.passkeys.findUnique({
      where: { credentialId: credential.id },
    });
    if (existing)
      throw new ApiException(
        ApiErrorCode.CONFLICT,
        null,
        'This passkey is already registered',
      );

    const row = await this.prisma.passkeys.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        discoverable:
          info.authenticatorExtensionResults?.credProps?.rk ?? false,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        aaguid: info.aaguid ?? null,
        name: name ? name.trim().slice(0, MAX_NAME_LENGTH) : null,
      },
    });

    this.logger.log(`Passkey registered for user ${user.id} (${row.id})`);

    return { verified: true, passkey: this.toSummary(row) };
  }

  // ── Authentication ───────────────────────────────────────────────────────────

  /**
   * Issues an authentication challenge.
   *
   * With a `user`, the challenge is bound to that account and only its passkeys
   * are offered. Without one, the browser is asked for any discoverable passkey
   * (usernameless / passwordless login).
   */
  async authenticationOptions(
    user?: UserWithMethods | null,
  ): Promise<AuthenticationOptionsResult> {
    const { rpId, ttl } = await this.settings();

    let userId: number | undefined;
    let allowCredentials: { id: string; transports?: string[] }[] | undefined;

    if (user) {
      const credentials = await this.prisma.passkeys.findMany({
        where: { userId: user.id },
        select: { credentialId: true, transports: true },
      });

      userId = user.id;
      allowCredentials = credentials.map((c) => ({
        id: c.credentialId,
        transports: c.transports,
      }));
    }

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials,
      userVerification: 'preferred',
    });

    const ceremony_id = await this.putChallenge(
      { kind: 'authentication', challenge: options.challenge, userId },
      ttl,
    );

    return { ceremony_id, options };
  }

  async verifyAuthentication(
    ceremonyId: string,
    response: AuthenticationResponseJSON,
  ): Promise<AuthenticatedPasskey> {
    const { rpId, origins } = await this.settings();
    const stored = await this.takeChallenge(ceremonyId, 'authentication');

    const row = await this.prisma.passkeys.findUnique({
      where: { credentialId: response.id },
    });
    if (!row)
      throw new ApiException(
        ApiErrorCode.UNAUTHORIZED,
        null,
        'Unknown passkey',
      );

    // When the ceremony was started for a specific account, the credential must
    // belong to it — otherwise a user could sign in with someone else's passkey.
    if (stored.userId !== undefined && stored.userId !== row.userId)
      throw new ApiException(
        ApiErrorCode.UNAUTHORIZED,
        null,
        'Passkey does not belong to this account',
      );

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: stored.challenge,
        expectedOrigin: origins,
        expectedRPID: rpId,
        credential: {
          id: row.credentialId,
          publicKey: isoBase64URL.toBuffer(row.publicKey),
          counter: Number(row.counter),
          transports: row.transports,
        },
        requireUserVerification: false,
      });
    } catch (err) {
      this.logger.warn(
        `Authentication verification failed for passkey ${row.id}: ${(err as Error).message}`,
      );
      throw new ApiException(
        ApiErrorCode.UNAUTHORIZED,
        null,
        'Passkey authentication failed',
      );
    }

    if (!verification.verified)
      throw new ApiException(
        ApiErrorCode.UNAUTHORIZED,
        null,
        'Passkey authentication failed',
      );

    await this.prisma.passkeys.update({
      where: { id: row.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        backedUp: verification.authenticationInfo.credentialBackedUp,
        lastUsedAt: new Date(),
      },
    });

    return { userId: row.userId, credentialId: row.credentialId };
  }

  /**
   * Verifies an assertion as a second factor for an already-authenticated user.
   * Throws when the assertion is invalid or belongs to someone else.
   */
  async verifyAssertionForUser(
    userId: number,
    ceremonyId: string,
    response: AuthenticationResponseJSON,
  ): Promise<void> {
    const { userId: owner } = await this.verifyAuthentication(
      ceremonyId,
      response,
    );
    if (owner !== userId)
      throw new ApiException(
        ApiErrorCode.UNAUTHORIZED,
        null,
        'Passkey does not belong to this account',
      );
  }
}
