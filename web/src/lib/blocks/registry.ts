/**
 * blocks/registry.ts — The insert-palette registry (P5-1).
 *
 * A module-level list of {@link InsertBlockDef}s the palette renders. Block types
 * (FE-A: text/table/shape/embed; FE-B: image/code/math) register themselves here;
 * the palette never hard-codes a list.
 *
 * See types.ts for the full REGISTRY CONTRACT. In short, to add a block type:
 *   1. write a pure builder in your own blocks/ file,
 *   2. call `registerBlock({ id, label, group, icon, build })`,
 *   3. make sure your module is imported (add it to blocks/index.ts).
 *
 * Registration is IDEMPOTENT by `id`: re-importing a module (HMR, test re-runs)
 * updates the existing entry in place instead of duplicating it. Order in the
 * palette is stable: entries keep first-registration order within their `group`,
 * and groups appear in first-seen order.
 */

import type { InsertBlockDef } from './types';

/** Backing store. Insertion order is preserved; de-duped by id. */
const _registry: InsertBlockDef[] = [];
const _index = new Map<string, number>();

/**
 * Register (or replace) a block type. Idempotent by `def.id` so a module that is
 * imported more than once never lists a block twice.
 */
export function registerBlock(def: InsertBlockDef): void {
  const existing = _index.get(def.id);
  if (existing !== undefined) {
    _registry[existing] = def; // replace in place — keeps palette order stable
    return;
  }
  _index.set(def.id, _registry.length);
  _registry.push(def);
}

/**
 * Snapshot of all registered block types in registration order. Returns a copy
 * so callers (the palette) can iterate without risk of mutating the registry.
 */
export function getInsertRegistry(): InsertBlockDef[] {
  return [..._registry];
}

/**
 * Block types bucketed by `group`, groups in first-seen order. Convenience for
 * the palette which renders one section per group.
 */
export function getInsertRegistryByGroup(): { group: string; blocks: InsertBlockDef[] }[] {
  const order: string[] = [];
  const buckets = new Map<string, InsertBlockDef[]>();
  for (const def of _registry) {
    let bucket = buckets.get(def.group);
    if (!bucket) {
      bucket = [];
      buckets.set(def.group, bucket);
      order.push(def.group);
    }
    bucket.push(def);
  }
  return order.map((group) => ({ group, blocks: buckets.get(group)! }));
}

/** Look up a single registered block by id (or undefined). */
export function getBlockDef(id: string): InsertBlockDef | undefined {
  const i = _index.get(id);
  return i === undefined ? undefined : _registry[i];
}

/**
 * Remove all registrations. Test-only hook so a test can register a known set in
 * isolation without inheriting the app defaults.
 */
export function clearRegistry(): void {
  _registry.length = 0;
  _index.clear();
}
