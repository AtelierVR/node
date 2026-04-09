const LABEL_KEY = Symbol('config:label');
const DESCRIPTION_KEY = Symbol('config:description');
const CONFIG_VAR_KEY = Symbol('config:var');
const DEFAULT_KEY = Symbol('config:default');
const IS_RISKY_KEY = Symbol('config:isRisky');

/**
 * Wiring metadata for a config variable: how to find its value across
 * the different layers (env, yaml, db).
 *
 * Validation rules live on class-validator decorators.
 * Default value lives on @Default.
 * Conversion from raw string is handled by class-transformer (emitDecoratorMetadata).
 */
export interface ConfigVarMeta {
    /** Dot-notation key — used as DB key and YAML path by default (e.g. 'http.port') */
    key: string;
    /** Environment variable name (e.g. 'HTTP_PORT') */
    env: string;
    /** YAML path override — defaults to key */
    yaml?: string;
    /** DB table key override — defaults to key */
    db?: string;
    // Set internally by the decorator:
    /** Class prototype the property belongs to */
    proto: object;
    /** Property name on that class */
    property: string;
}

/** Runtime registry: dot-notation key → full metadata. Populated by @ConfigVar. */
export const CONFIG_REGISTRY = new Map<string, ConfigVarMeta>();

export function Label(text: string): PropertyDecorator {
    return Reflect.metadata(LABEL_KEY, text);
}

export function Description(text: string): PropertyDecorator {
    return Reflect.metadata(DESCRIPTION_KEY, text);
}

/** Factory that computes the default value from already-resolved slot values. */
export type DefaultFactory = (resolved: ReadonlyMap<string, string>) => string;

/** Lowest-priority fallback value. May be a static value or a factory function. */
export function Default<T>(value: T | DefaultFactory): PropertyDecorator {
    return Reflect.metadata(DEFAULT_KEY, value);
}

/**
 * Marks a config property as sensitive/risky to override at runtime.
 * An optional human-readable reason can be provided.
 *
 * @example
 * @IsRisky()
 */
export function IsRisky(): PropertyDecorator {
    return Reflect.metadata(IS_RISKY_KEY, true);
}

export function ConfigVar(meta: Omit<ConfigVarMeta, 'proto' | 'property'>): PropertyDecorator {
    return (target, propertyKey) => {
        const full: ConfigVarMeta = {
            yaml: meta.key,
            db: meta.key,
            ...meta,
            proto: target as object,
            property: String(propertyKey),
        };
        CONFIG_REGISTRY.set(meta.key, full);
        Reflect.defineMetadata(CONFIG_VAR_KEY, full, target, String(propertyKey));
    };
}

export function getLabel(target: object, propertyKey: string): string | undefined {
    return Reflect.getMetadata(LABEL_KEY, target, propertyKey);
}

export function getDescription(target: object, propertyKey: string): string | undefined {
    return Reflect.getMetadata(DESCRIPTION_KEY, target, propertyKey);
}

export function getIsRisky(target: object, propertyKey: string): boolean {
    return Reflect.getMetadata(IS_RISKY_KEY, target, propertyKey) as boolean | undefined ?? false;
}

export function getDefault<T = unknown>(target: object, propertyKey: string): T | DefaultFactory | undefined {
    return Reflect.getMetadata(DEFAULT_KEY, target, propertyKey) as T | DefaultFactory | undefined;
}

/**
 * Navigate a nested object using a dot-notation path.
 * Returns undefined if any segment is missing.
 */
export function getNestedValue(obj: Record<string, any>, dotPath: string): unknown {
    return dotPath.split('.').reduce<unknown>((cur, key) => {
        if (cur !== null && typeof cur === 'object') return (cur as Record<string, unknown>)[key];
        return undefined;
    }, obj);
}

/**
 * Set a value on a nested object using a dot-notation path.
 * Intermediate objects are created if they do not exist.
 */
export function setNestedValue(obj: Record<string, any>, dotPath: string, value: unknown): void {
    const parts = dotPath.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === undefined || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}
