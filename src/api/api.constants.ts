/**
 * Paths always served at the root, regardless of the global prefix.
 * These must match the exclude list in main.ts setGlobalPrefix().
 */
export const ROOT_ONLY_PATHS = [
    '.well-known/webfinger',
    '.well-known/nodeinfo',
    '.well-known/host-meta',
    '.well-known/nox',
    'nodeinfo/2.1',
];
