import { resolve, sep } from 'node:path';

export function isChildPath(parent: string, child: string): boolean {
  const parentPath = resolve(parent);
  const childPath = resolve(child);

  return childPath !== parentPath && childPath.startsWith(parentPath + sep);
}

export function resolveSafe(root: string, target: string): string | null {
  const resolved = resolve(root, target);

  return isChildPath(root, resolved) || resolved === resolve(root)
    ? resolved
    : null;
}
