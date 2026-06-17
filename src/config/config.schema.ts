import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { join } from 'path';
import { Label, Description, ConfigVar, Default, IsRisky } from './config.decorators';
import { randomUUID } from 'crypto';

/**
 * Parses the `key=url,key=url` socials config format into a Record.
 * Duplicate keys are merged into an array; single values remain a string.
 * Handles leading/trailing whitespace around keys and values.
 * If the input is already an object it is returned as-is.
 *
 * @example
 * parseSocialsString('github=https://github.com/org,github=https://github.com/repo,mastodon=https://mastodon.social/@me')
 * // → { github: ['https://github.com/org', 'https://github.com/repo'], mastodon: 'https://mastodon.social/@me' }
 */
export function parseSocialsString(value: unknown): Record<string, string | string[]> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object') return value as Record<string, string | string[]>;
  if (typeof value !== 'string' || !value.trim()) return {};

  const acc: Record<string, string[]> = {};
  for (const entry of value.split(',')) {
    const idx = entry.indexOf('=');
    if (idx < 1) continue;
    const key = entry.slice(0, idx).trim();
    const url = entry.slice(idx + 1).trim();
    if (!key || !url) continue;
    (acc[key] ??= []).push(url);
  }
  return Object.fromEntries(
    Object.entries(acc).map(([k, v]) => [k, v.length === 1 ? v[0] : v]),
  );
}

/**
 * Parses the icons config string into a theme-keyed Record.
 * Format: comma-separated `key=url` pairs. Known keys: default, dark.
 *
 * @example
 * parseIconsRecord('default=https://example.com/icon.png,dark=https://example.com/icon.dark.png')
 * // → { default: 'https://example.com/icon.png', dark: 'https://example.com/icon.dark.png' }
 */
export function parseIconsRecord(value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, string>;
  if (typeof value !== 'string' || !value.trim()) return {};

  const result: Record<string, string> = {};
  for (const entry of value.split(',')) {
    const idx = entry.indexOf('=');
    if (idx < 1) continue;
    const key = entry.slice(0, idx).trim();
    const url = entry.slice(idx + 1).trim();
    if (key && url) result[key] = url;
  }
  return result;
}

/**
 * Parses a value that may be a plain string, a JSON-encoded locale map, or already an object.
 * Returns the string as-is if it is not a JSON object literal.
 *
 * @example
 * parseLocalizedString('{"en":"My Server","fr":"Mon Serveur"}')
 * // → { en: 'My Server', fr: 'Mon Serveur' }
 * parseLocalizedString('My Server')
 * // → 'My Server'
 */
export function parseLocalizedString(value: unknown): string | Record<string, string> {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return value as Record<string, string>;
  if (typeof value !== 'string') return String(value);
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
        return parsed as Record<string, string>;
    } catch { /* fall through */ }
  }
  return value;
}

export class HttpConfig {
  @Label('HTTP Host')
  @Description('Hostname or IP address the HTTP server binds to.')
  @Default('localhost')
  @ConfigVar({ key: 'http.host', env: 'HTTP_HOST' })
  @IsString()
  @IsNotEmpty()
  host: string;

  @Label('HTTP Port')
  @Description('TCP port the HTTP server listens on (1024–49151).')
  @Default(3000)
  @ConfigVar({ key: 'http.port', env: 'HTTP_PORT' })
  @IsInt()
  @Min(1024)
  @Max(49151)
  port: number;

  @Label('HTTP Domain')
  @Description('Public-facing domain (and port) used to build URLs. Defaults to localhost:{port}.')
  @Default((r) => r.get('address') ?? `localhost:${r.get('http.port') ?? '3000'}`)
  @ConfigVar({ key: 'http.domain', env: 'HTTP_DOMAIN' })
  @IsString()
  @IsNotEmpty()
  domain: string;

  @Label('HTTP Secure (Reverse Proxy)')
  @Description('Set to true when the server sits behind an HTTPS reverse proxy but is itself plain HTTP.')
  @Default(false)
  @ConfigVar({ key: 'http.secure', env: 'HTTP_SECURE' })
  @IsBoolean()
  secure: boolean;

  @Label('HTTP SSL')
  @Description('Enable native HTTPS on the server. Requires cert_path and private_path.')
  @Default(false)
  @ConfigVar({ key: 'http.ssl', env: 'HTTP_SSL' })
  @IsBoolean()
  ssl: boolean;

  @Label('SSL Public Key Path')
  @Description('Absolute path to the SSL public key (.pem / .crt). Required when ssl is true.')
  @ConfigVar({ key: 'http.public_path', env: 'HTTP_PUBLIC_PATH' })
  @Default(() => join(process.cwd(), 'certs', 'public.pem'))
  @IsString()
  @IsNotEmpty()
  public_path?: string;

  @Label('SSL Private Key Path')
  @Description('Absolute path to the SSL private key (.pem / .key). Required when ssl is true.')
  @ConfigVar({ key: 'http.private_path', env: 'HTTP_PRIVATE_PATH' })
  @Default(() => join(process.cwd(), 'certs', 'private.pem'))
  @IsString()
  @IsNotEmpty()
  private_path?: string;

  @Label('HTTP Global Prefix')
  @Description('Global route prefix for all API endpoints (e.g. "api", "v1", or "" for none). Note: well-known and nodeinfo routes are always served at the root regardless of this setting. Requires restart to take effect.')
  @Default('api')
  @ConfigVar({ key: 'http.prefix', env: 'HTTP_PREFIX' })
  @IsString()
  @IsOptional()
  prefix?: string;
}

export class CorsConfig {
  @Label('CORS Enabled')
  @Description('Enable CORS support.')
  @Default(true)
  @ConfigVar({ key: 'cors.enabled', env: 'CORS_ENABLED' })
  @IsBoolean()
  enabled: boolean;

  @Label('CORS Origins')
  @Description('Comma-separated list of allowed origins. Defaults to the public web URL derived from http.domain.')
  @Default((r) => {
    const secure = r.get('http.secure') === 'true';
    const ssl = r.get('http.ssl') === 'true';
    const address = r.get('address') ?? `localhost:${r.get('http.port') ?? '3000'}`;
    const domain = r.get('http.domain') ?? address;
    return [domain, address]
      .reduce((acc, d) => (acc.includes(d) ? acc : [...acc, d]), [] as string[])
      .map(d => `http${secure || ssl ? 's' : ''}://${d}`)
      .join(',');
  })
  @ConfigVar({ key: 'cors.origins', env: 'CORS_ORIGINS' })
  @IsString()
  @IsNotEmpty()
  /** Comma-separated list — split at runtime in main.ts. */
  origins: string;

  @Label('CORS Credentials')
  @Description('Allow credentials (cookies, authorization headers) in cross-origin requests.')
  @Default(true)
  @ConfigVar({ key: 'cors.credentials', env: 'CORS_CREDENTIALS' })
  @IsBoolean()
  credentials: boolean;
}

export class GatewayConfig {
  @Label('API Gateway URL')
  @Description('Public base URL for the API, inferred from http.domain, http.secure, and http.ssl.')
  @Default((r) => {
    const secure = r.get('http.secure') === 'true';
    const ssl = r.get('http.ssl') === 'true';
    const domain = r.get('http.domain') ?? 'localhost:3000';
    return new URL(`http${secure || ssl ? 's' : ''}://${domain}/api/`).toString();
  })
  @ConfigVar({ key: 'gateway.api', env: 'GATEWAY_API' })
  @IsString()
  @IsNotEmpty()
  api: string;

  @Label('WebSocket Gateway URL')
  @Description('WebSocket endpoint for real-time communication. Defaults to ws(s)://{domain}/api/ws.')
  @Default((r) => {
    const secure = r.get('http.secure') === 'true';
    const ssl = r.get('http.ssl') === 'true';
    const domain = r.get('http.domain') ?? 'localhost:3000';
    return new URL(`ws${secure || ssl ? 's' : ''}://${domain}/api/ws`).toString();
  })
  @ConfigVar({ key: 'gateway.ws', env: 'GATEWAY_WS' })
  @IsString()
  @IsNotEmpty()
  ws: string;

  @Label('Web Base URL')
  @Description('Public base URL for web access, used in metadata and links. Defaults to http(s)://{domain}/.')
  @Default((r) => {
    const secure = r.get('http.secure') === 'true';
    const ssl = r.get('http.ssl') === 'true';
    const domain = r.get('http.domain') ?? 'localhost:3000';
    return `http${secure || ssl ? 's' : ''}://${domain}/`;
  })
  @ConfigVar({ key: 'gateway.web', env: 'GATEWAY_WEB' })
  @IsString()
  @IsNotEmpty()
  web: string;

  @Label('ActivityPub Base URL')
  @Description('Public base URL for ActivityPub actor/profile endpoints. Defaults to gateway.web with /ap/ suffix.')
  @Default((r) => {
    const secure = r.get('http.secure') === 'true';
    const ssl = r.get('http.ssl') === 'true';
    const domain = r.get('http.domain') ?? 'localhost:3000';
    return `http${secure || ssl ? 's' : ''}://${domain}/ap/`;
  })
  @ConfigVar({ key: 'gateway.activitypub', env: 'GATEWAY_ACTIVITYPUB' })
  @IsString()
  @IsNotEmpty()
  activitypub: string;
}

export class InstanceConfig {
  @Label('Instance Name')
  @Description('Display name of this Nox instance. Can be a plain string or a JSON locale map, e.g. {"en":"My Server","fr":"Mon Serveur"}. When the YAML value is a nested object (name: { en: ... }) it is automatically converted.')
  @Default('Nox')
  @ConfigVar({ key: 'instance.name', env: 'INSTANCE_NAME' })
  @Transform(({ value }) => parseLocalizedString(value))
  @IsOptional()
  name: string | Record<string, string>;

  @Label('Instance Description')
  @Description('Short description of this Nox instance. Can be a plain string or a JSON locale map, e.g. {"en":"A VR platform","fr":"Une plateforme VR"}. When the YAML value is a nested object it is automatically converted.')
  @ConfigVar({ key: 'instance.description', env: 'INSTANCE_DESCRIPTION' })
  @Transform(({ value }) => parseLocalizedString(value))
  @IsOptional()
  description?: string | Record<string, string>;

  @Label('Instance Contact')
  @Description('Contact email address for the instance administrator.')
  @ConfigVar({ key: 'instance.contact', env: 'INSTANCE_CONTACT' })
  @IsString()
  @IsOptional()
  contact?: string;

  @Label('Instance Icons')
  @Description('Comma-separated list of "key=url" pairs for theme-specific icons. Known keys: default, light. Example: default=https://example.com/icon.png,light=https://example.com/icon.light.png')
  @ConfigVar({ key: 'instance.icons', env: 'INSTANCE_ICONS' })
  @Transform(({ value }) => parseIconsRecord(value))
  @Default(r => {
    const api = r.get('gateway.api') ?? (() => {
      const secure = r.get('http.secure') === 'true';
      const ssl = r.get('http.ssl') === 'true';
      const domain = r.get('http.domain') ?? 'localhost:3000';
      return `http${secure || ssl ? 's' : ''}://${domain}/`;
    })();
    return `default=${api}icon.png,light=${api}icon.light.png`;
  })
  icons: Record<string, string>;

  @Label('Instance Socials')
  @Description('Comma-separated list of "platform=url" pairs. The same platform key can appear multiple times and will be merged into an array. Known keys: mastodon, discord, twitter, youtube, github. Example: github=https://github.com/org,mastodon=https://mastodon.social/@me,github=https://github.com/repo')
  @ConfigVar({ key: 'instance.socials', env: 'INSTANCE_SOCIALS' })
  @Transform(({ value }) => parseSocialsString(value))
  @IsOptional()
  socials?: Record<string, string | string[]>;

  @Label('Instance Features')
  @Description('List of enabled feature modules on this instance (e.g. user, world, avatar, instance, server).')
  @Default('user,world,avatar,instance,server')
  @ConfigVar({ key: 'instance.features', env: 'INSTANCE_FEATURES' })
  @IsString()
  @IsNotEmpty()
  /** Comma-separated list — split at runtime via instanceFeatures getter in WellKnownService. */
  features: string;

  @Label('Registration Enabled')
  @Description('Whether new account registration is open on this instance.')
  @Default(true)
  @ConfigVar({ key: 'instance.registration', env: 'INSTANCE_REGISTRATION' })
  @IsBoolean()
  registration: boolean;

  @Label('Instance Creation Enabled')
  @Description('Whether local users can create world instances on this node.')
  @Default(true)
  @ConfigVar({ key: 'instance.instanceCreation', env: 'INSTANCE_CREATION' })
  @IsBoolean()
  instanceCreation: boolean;

  @Label('Instance Creation by External Users')
  @Description('Whether external (federated) users can create world instances on this node.')
  @Default(false)
  @ConfigVar({ key: 'instance.instanceCreationByExternal', env: 'INSTANCE_CREATION_BY_EXTERNAL' })
  @IsBoolean()
  instanceCreationByExternal: boolean;

  @Label('World Creation Enabled')
  @Description('Whether local users can create worlds on this node.')
  @Default(true)
  @ConfigVar({ key: 'instance.worldCreation', env: 'WORLD_CREATION' })
  @IsBoolean()
  worldCreation: boolean;

  @Label('World Creation by External Users')
  @Description('Whether external (federated) users can create worlds on this node.')
  @Default(false)
  @ConfigVar({ key: 'instance.worldCreationByExternal', env: 'WORLD_CREATION_BY_EXTERNAL' })
  @IsBoolean()
  worldCreationByExternal: boolean;

  @Label('Avatar Creation Enabled')
  @Description('Whether local users can create avatars on this node.')
  @Default(true)
  @ConfigVar({ key: 'instance.avatarCreation', env: 'AVATAR_CREATION' })
  @IsBoolean()
  avatarCreation: boolean;

  @Label('Avatar Creation by External Users')
  @Description('Whether external (federated) users can create avatars on this node.')
  @Default(false)
  @ConfigVar({ key: 'instance.avatarCreationByExternal', env: 'AVATAR_CREATION_BY_EXTERNAL' })
  @IsBoolean()
  avatarCreationByExternal: boolean;

  @Label('Instance Regions')
  @Description('List of ISO 3166-1 alpha-2 region codes (lowercase) available for hosting instances, provided by relay providers. Use null as fallback when a provider has no region.')
  @Default([])
  @ConfigVar({ key: 'instance.regions', env: 'INSTANCE_REGIONS' })
  @Transform(({ value }) => Array.isArray(value) 
    ? value 
    : typeof value === 'string' 
      ? value.split(',').map((s: string) => s.trim()).filter(Boolean) 
      : value
  )
  @IsArray()
  @IsString({ each: true })
  regions: string[];

  @Label('Default Region')
  @Description('Default region to pre-select when creating an instance. Must be one of the values in instance.regions, or null for no default.')
  @ConfigVar({ key: 'instance.defaultRegion', env: 'INSTANCE_DEFAULT_REGION' })
  @IsOptional()
  @IsString()
  defaultRegion: string | null;
}

export class AdminConfig {
  @Label('Admin User ID')
  @Description('Numeric database ID of the admin user. Created on first start.')
  @Default(1)
  @ConfigVar({ key: 'admin.id', env: 'ADMIN_ID' })
  @IsInt()
  @Min(1)
  id: number;

  @Label('Admin Username')
  @Description('Username of the admin account created on first start.')
  @Default('admin')
  @ConfigVar({ key: 'admin.username', env: 'ADMIN_USERNAME' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @Label('Admin Display Name')
  @Description('Display name of the admin account.')
  @Default('Admin')
  @ConfigVar({ key: 'admin.display', env: 'ADMIN_DISPLAY' })
  @IsString()
  @IsNotEmpty()
  display: string;

  @Label('Admin Password')
  @Description('Plain-text password for the admin account — stored as SHA-256 hash. Ignored after creation.')
  @Default('')
  @IsRisky()
  @ConfigVar({ key: 'admin.password', env: 'ADMIN_PASSWORD' })
  @IsString()
  @IsOptional()
  password?: string;
}

export class SessionConfig {
  @Label('Session Expiration')
  @Description('Default session token lifetime in milliseconds')
  @Default(30 * 24 * 60 * 60 * 1000)
  @ConfigVar({ key: 'session.expiration', env: 'SESSION_EXPIRATION' })
  @IsInt()
  @Min(0)
  expiration: number;
}

export class StorageLocalConfig {
  @Label('Local storage directory')
  @Description('Absolute path to the directory used for local file storage (assets).')
  @Default(() => join(process.cwd(), 'assets'))
  @ConfigVar({ key: 'storage.local.dir', env: 'STORAGE_LOCAL_DIR' })
  @IsString()
  @IsNotEmpty()
  dir: string;
}

export class StorageConfig {
  @ValidateNested()
  @Type(() => StorageLocalConfig)
  local: StorageLocalConfig;
}

export class RelayConfig {
  @Label('Relay Docker Image')
  @Description('Docker image used to spawn relay containers.')
  @Default('nox/relay:latest')
  @ConfigVar({ key: 'relay.docker_image', env: 'RELAY_DOCKER_IMAGE' })
  @IsString()
  @IsNotEmpty()
  docker_image: string;

  @Label('Relay Docker Network')
  @Description('Docker network that relay containers are attached to.')
  @Default('nox')
  @ConfigVar({ key: 'relay.docker_network', env: 'RELAY_DOCKER_NETWORK' })
  @IsString()
  @IsNotEmpty()
  docker_network: string;

  @Label('Relay Docker Address')
  @Description('Host address reachable by relay containers (maps 0.0.0.0 / ::1 port bindings).')
  @Default('127.0.0.1')
  @ConfigVar({ key: 'relay.docker_address', env: 'RELAY_DOCKER_ADDRESS' })
  @IsString()
  @IsNotEmpty()
  docker_address: string;

  @Label('Relay Docker Options')
  @Description('JSON options string passed to dockerode (e.g. \'{"socketPath":"/var/run/docker.sock"}\').')
  @Default('{"socketPath":"/var/run/docker.sock"}')
  @ConfigVar({ key: 'relay.docker_options', env: 'RELAY_DOCKER_OPTIONS' })
  @IsString()
  @IsNotEmpty()
  docker_options: string;

  @Label('Relay Docker Auto Pull')
  @Description('Whether to pull the Docker image before starting a relay container. Disable when using local builds.')
  @Default(true)
  @ConfigVar({ key: 'relay.docker_auto_pull', env: 'RELAY_DOCKER_AUTO_PULL' })
  @IsBoolean()
  docker_auto_pull: boolean;

  @Label('Relay Docker Region')
  @Description('ISO 3166-1 alpha-2 region code assigned to Docker-managed relays (e.g. "fr", "eu").')
  @Default('')
  @ConfigVar({ key: 'relay.docker_region', env: 'RELAY_DOCKER_REGION' })
  @IsString()
  docker_region: string;

  @Label('Relay Min Port')
  @Description('Minimum UDP port used for relay QUIC endpoints.')
  @Default(8000)
  @ConfigVar({ key: 'relay.min_port', env: 'RELAY_MIN_PORT' })
  @IsInt()
  @Min(1024)
  @Max(65535)
  min_port: number;

  @Label('Relay Max Port')
  @Description('Maximum UDP port used for relay QUIC endpoints.')
  @Default(9000)
  @ConfigVar({ key: 'relay.max_port', env: 'RELAY_MAX_PORT' })
  @IsInt()
  @Min(1024)
  @Max(65535)
  max_port: number;

  @Label('Relay Group')
  @Description('Unique group identifier used to scope relay containers to this Nox instance. Prevents multiple Nox instances sharing the same Docker daemon from interfering with each other. Defaults to a random UUID generated at first start and persisted in the database.')
  @Default('default')
  @ConfigVar({ key: 'relay.group', env: 'RELAY_GROUP' })
  @IsString()
  @IsNotEmpty()
  group: string;
}

export class RedisConfig {
  @Label('Redis URL')
  @Description('Redis connection URL (e.g. redis://redis:6379). Used by Cache, Queue, and Session modules.')
  @Default('redis://127.0.0.1:6379')
  @ConfigVar({ key: 'redis.url', env: 'REDIS_URL' })
  @IsString()
  @IsNotEmpty()
  url: string;
}

export class QueueConfig {
  @Label('Queue Provider')
  @Description('Active job queue provider: "sync" (in-process, default) or "bullmq" (Redis-backed).')
  @Default('sync')
  @ConfigVar({ key: 'queue.provider', env: 'QUEUE_PROVIDER' })
  @IsString()
  @IsNotEmpty()
  provider: string;
}

export class CacheConfig {
  @Label('Cache Provider')
  @Description('Active cache provider: "memory" (in-process, default) or "redis" (Redis-backed).')
  @Default('memory')
  @ConfigVar({ key: 'cache.provider', env: 'CACHE_PROVIDER' })
  @IsString()
  @IsNotEmpty()
  provider: string;
}

export class SearchConfig {
  @Label('Search Provider')
  @Description('Active search provider: "postgres" (built-in tsvector, default) or "noop" (empty results).')
  @Default('postgres')
  @ConfigVar({ key: 'search.provider', env: 'SEARCH_PROVIDER' })
  @IsString()
  @IsNotEmpty()
  provider: string;
}

export class AppConfig {
  @Label('Instance Identifier')
  @Description('Unique identifier for this specific node. In a cluster where multiple nodes share the same domain behind a load balancer, this distinguishes which node responded. Defaults to the public domain.')
  @Default((r) => '0')
  @ConfigVar({ key: 'identifier', env: 'IDENTIFIER' })
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @Label('Minimal Public Domain')
  @Description('Minimal public domain for this instance.')
  @ConfigVar({ key: 'address', env: 'ADDRESS' })
  @Default((r) => `localhost:${r.get('http.port') ?? '3000'}`)
  @IsString()
  @IsNotEmpty()
  address: string;

  @ValidateNested()
  @Type(() => CorsConfig)
  @IsOptional()
  cors?: CorsConfig;

  @ValidateNested()
  @Type(() => HttpConfig)
  http: HttpConfig;

  @ValidateNested()
  @Type(() => GatewayConfig)
  gateway: GatewayConfig;

  @ValidateNested()
  @Type(() => InstanceConfig)
  instance: InstanceConfig;

  @ValidateNested()
  @Type(() => AdminConfig)
  admin: AdminConfig;

  @ValidateNested()
  @Type(() => SessionConfig)
  @IsOptional()
  session?: SessionConfig;

  @ValidateNested()
  @Type(() => StorageConfig)
  @IsOptional()
  storage?: StorageConfig;

  @ValidateNested()
  @Type(() => RelayConfig)
  @IsOptional()
  relay?: RelayConfig;

  @ValidateNested()
  @Type(() => RedisConfig)
  @IsOptional()
  redis?: RedisConfig;

  @ValidateNested()
  @Type(() => QueueConfig)
  @IsOptional()
  queue?: QueueConfig;

  @ValidateNested()
  @Type(() => CacheConfig)
  @IsOptional()
  cache?: CacheConfig;

  @ValidateNested()
  @Type(() => SearchConfig)
  @IsOptional()
  search?: SearchConfig;

  /**
   * Dot-notation keys locked by a '!' prefix in YAML/Env.
   * Locked keys ignore the database layer regardless of what is stored there.
   */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  overriddenKeys: string[];
}

