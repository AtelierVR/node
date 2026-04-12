import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { join } from 'path';
import { Label, Description, ConfigVar, Default, IsRisky } from './config.decorators';

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
    const address = r.get('address') ?? 'localhost:3000';
    return `http${secure || ssl ? 's' : ''}://${address}/`;
  })
  @ConfigVar({ key: 'gateway.web', env: 'GATEWAY_WEB' })
  @IsString()
  @IsNotEmpty()
  web: string
}

export class InstanceConfig {
  @Label('Instance Name')
  @Description('Display name of this Nox instance.')
  @Default('Nox')
  @ConfigVar({ key: 'instance.name', env: 'INSTANCE_NAME' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @Label('Instance Description')
  @Description('Short description of this Nox instance.')
  @ConfigVar({ key: 'instance.description', env: 'INSTANCE_DESCRIPTION' })
  @IsString()
  @IsOptional()
  description?: string;

  @Label('Instance Contact')
  @Description('Contact email address for the instance administrator.')
  @ConfigVar({ key: 'instance.contact', env: 'INSTANCE_CONTACT' })
  @IsString()
  @IsOptional()
  contact?: string;

  @Label('Instance Icon')
  @Description('Public URL to the instance icon/logo.')
  @ConfigVar({ key: 'instance.icon', env: 'INSTANCE_ICON' })
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  @Default(r => {
    const secure = r.get('http.secure') === 'true';
    const ssl = r.get('http.ssl') === 'true';
    const domain = r.get('http.domain') ?? 'localhost:3000';
    return `http${secure || ssl ? 's' : ''}://${domain}/api/icon.png`;
  })
  icon: string;

  @Label('Instance Features')
  @Description('List of enabled feature modules on this instance (e.g. user, world, avatar, instance, server).')
  @Default('user,world,avatar,instance,server')
  @ConfigVar({ key: 'instance.features', env: 'INSTANCE_FEATURES' })
  @IsString()
  @IsNotEmpty()
  /** Comma-separated list — split at runtime via instanceFeatures getter in WellKnownService. */
  features: string;
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

  /**
   * Dot-notation keys locked by a '!' prefix in YAML/Env.
   * Locked keys ignore the database layer regardless of what is stored there.
   */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  overriddenKeys: string[];
}

