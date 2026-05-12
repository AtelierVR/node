
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { cwd } from 'node:process';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CONFIG_REGISTRY, DefaultFactory, getDefault, getNestedValue, setNestedValue } from './config.decorators';
import { AppConfig } from './config.schema';

// Importing config.schema.ts triggers @ConfigVar decorators, populating CONFIG_REGISTRY.
void AppConfig;

const YAML_CONFIG_FILENAME = 'config.yaml';

/** Resolved raw string for one key + whether the '!' lock is active. */
interface Slot {
  /** null = no static default and no explicit value set yet */
  value: string | null;
  locked: boolean;
}

/**
 * Apply a raw string from Env or YAML to a slot.
 * A leading '!' locks the slot — the DB layer will be skipped for this key.
 * The last call wins (YAML > Env > Default).
 */
function applyRaw(slot: Slot, raw: string | undefined): void {
  if (raw === undefined || raw === '') return;
  slot.locked = raw.startsWith('!');
  slot.value = slot.locked ? raw.slice(1) : raw;
}

/**
 * Builds the static config layer with the following priority (lowest → highest):
 *   Default < Env < Config (YAML)
 *
 * The database layer is applied at runtime inside AppConfigService.
 * A value prefixed with '!' locks that key and prevents DB from overriding it.
 *
 * All variables are declared via @ConfigVar in config.schema.ts.
 * This function is fully generic — no hardcoded field names.
 */
export default (): AppConfig => {
  // ── Layer 1: Static defaults (function defaults are deferred) ─────────────────
  const slots = new Map<string, Slot>();
  for (const [key, entry] of CONFIG_REGISTRY) {
    const def = getDefault(entry.proto, entry.property);
    const value = (def !== undefined && typeof def !== 'function') ? String(def) : null;
    slots.set(key, { value, locked: false });
  }

  // ── Layer 2: Environment variables ──────────────────────────────────────────
  for (const [key, entry] of CONFIG_REGISTRY) {
    applyRaw(slots.get(key)!, process.env[entry.env]);
  }

  // ── Layer 3: YAML config file (highest static priority) ─────────────────────
  const filename = process.env.CONFIG_FILE || YAML_CONFIG_FILENAME;
  const filePath = join(cwd(), filename);

  if (!existsSync(filePath))
    throw new Error(`Configuration file not found: ${filePath}`);

  const yamlCfg = yaml.load(readFileSync(filePath, 'utf8')) as Record<string, any>;

  for (const [key, entry] of CONFIG_REGISTRY) {
    const yamlVal = getNestedValue(yamlCfg, entry.yaml ?? key);
    if (yamlVal !== undefined) {
      const raw = typeof yamlVal === 'object' && yamlVal !== null
        ? JSON.stringify(yamlVal)
        : String(yamlVal);
      applyRaw(slots.get(key)!, raw);
    }
  }

  // ── Deferred function defaults ───────────────────────────────────────────────
  // Computed after all explicit layers so that deps (e.g. http.port) are already resolved.
  // Iterates in registration order so earlier entries (e.g. http.domain) are available
  // to later ones (e.g. gateway.api) via a fresh resolved-map computed per entry.
  const getResolved = (): ReadonlyMap<string, string> =>
    new Map(
      [...slots.entries()]
        .filter(([, s]) => s.value !== null)
        .map(([k, s]) => [k, s.value as string]),
    );

  for (const [key, entry] of CONFIG_REGISTRY) {
    const slot = slots.get(key)!;
    if (slot.value !== null) continue;
    const def = getDefault(entry.proto, entry.property);
    if (typeof def === 'function') slot.value = (def as DefaultFactory)(getResolved());
  }

  // ── Build & validate via class-validator ───────────────────────────────────
  const overriddenKeys: string[] = [];
  const raw: Record<string, any> = { overriddenKeys };

  for (const [key, slot] of slots) {
    if (slot.locked) overriddenKeys.push(key);
    if (slot.value === null) continue; // no default, no explicit value — let class-validator catch missing required fields

    // class-transformer's enableImplicitConversion uses Boolean(value) which maps
    // any non-empty string (including 'false') to true. Coerce to the correct primitive
    // using reflect-metadata design:type before passing to plainToInstance.
    const entry = CONFIG_REGISTRY.get(key)!;
    const type = Reflect.getMetadata('design:type', entry.proto, entry.property) as Function | undefined;
    let value: unknown = slot.value;
    if (type === Number)  value = Number(slot.value);
    else if (type === Boolean) value = slot.value === 'true';

    setNestedValue(raw, key, value);
  }

  const config = plainToInstance(AppConfig, raw, { enableImplicitConversion: true });
  const errors = validateSync(config, { skipMissingProperties: false });

  if (errors.length > 0)
    throw new Error(`Configuration validation failed:\n${errors.toString()}`);

  return config;
};
