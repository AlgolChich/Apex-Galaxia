import { ApexError } from '../util/errors.js';
import { ChronicleStateSchema, type ChronicleState, type StateOp } from '../project/schemas.js';

type Container = Record<string, unknown> | unknown[];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitPath(path: string): string[] {
  const parts = path.split('.').map((p) => p.trim());
  if (parts.some((p) => p.length === 0)) {
    throw new ApexError('INVALID_ARGUMENT', `Invalid state path: ${path}`, { path });
  }
  return parts;
}

/** Walk to the parent of the last segment, creating objects on the way when `create` is set. */
function resolveParent(root: Record<string, unknown>, parts: string[], create: boolean): { parent: Container; key: string } | undefined {
  let current: unknown = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isObject(current)) return undefined;
    if (current[key] === undefined) {
      if (!create) return undefined;
      current[key] = {};
    }
    current = current[key];
  }
  if (!isObject(current) && !Array.isArray(current)) return undefined;
  return { parent: current, key: parts[parts.length - 1]! };
}

function getAt(parent: Container, key: string): unknown {
  if (Array.isArray(parent)) {
    return parent[Number(key)];
  }
  return parent[key];
}

function setAt(parent: Container, key: string, value: unknown): void {
  if (Array.isArray(parent)) {
    parent[Number(key)] = value;
  } else {
    parent[key] = value;
  }
}

function matches(item: unknown, where: Record<string, unknown>): boolean {
  if (!isObject(item)) return false;
  return Object.entries(where).every(([k, v]) => item[k] === v);
}

/**
 * Apply a list of ops to a state and return the new, validated state. The input is not
 * mutated. Any op that cannot be applied, or a result that fails the schema, throws so the
 * caller can show the model's proposal to the Author instead of silently corrupting state.
 */
export function applyOps(state: ChronicleState, ops: StateOp[]): ChronicleState {
  const draft = structuredClone(state) as Record<string, unknown>;
  for (const op of ops) {
    const parts = splitPath(op.path);
    switch (op.op) {
      case 'set': {
        const target = resolveParent(draft, parts, true);
        if (!target) throw bad(op, 'path does not resolve');
        setAt(target.parent, target.key, structuredClone(op.value));
        break;
      }
      case 'unset': {
        const target = resolveParent(draft, parts, false);
        if (!target) break;
        if (Array.isArray(target.parent)) {
          target.parent.splice(Number(target.key), 1);
        } else {
          delete target.parent[target.key];
        }
        break;
      }
      case 'merge': {
        const target = resolveParent(draft, parts, true);
        if (!target) throw bad(op, 'path does not resolve');
        const existing = getAt(target.parent, target.key);
        if (existing !== undefined && !isObject(existing)) throw bad(op, 'merge target is not a mapping');
        setAt(target.parent, target.key, { ...(existing ?? {}), ...structuredClone(op.value) });
        break;
      }
      case 'append': {
        const target = resolveParent(draft, parts, true);
        if (!target) throw bad(op, 'path does not resolve');
        const existing = getAt(target.parent, target.key);
        if (existing === undefined) {
          setAt(target.parent, target.key, [structuredClone(op.value)]);
        } else if (Array.isArray(existing)) {
          const value = structuredClone(op.value);
          const duplicate = isObject(value) && typeof value['id'] === 'string' && existing.some((e) => isObject(e) && e['id'] === value['id']);
          if (duplicate) {
            const index = existing.findIndex((e) => isObject(e) && e['id'] === value['id']);
            existing[index] = { ...(existing[index] as Record<string, unknown>), ...value };
          } else {
            existing.push(value);
          }
        } else {
          throw bad(op, 'append target is not a list');
        }
        break;
      }
      case 'remove': {
        const target = resolveParent(draft, parts, false);
        if (!target) break;
        const existing = getAt(target.parent, target.key);
        if (!Array.isArray(existing)) throw bad(op, 'remove target is not a list');
        if (op.index !== undefined) {
          existing.splice(op.index, 1);
        } else if (op.where) {
          const where = op.where;
          const kept = existing.filter((item) => !matches(item, where));
          setAt(target.parent, target.key, kept);
        } else {
          throw bad(op, 'remove needs where or index');
        }
        break;
      }
    }
  }
  const parsed = ChronicleStateSchema.safeParse(draft);
  if (!parsed.success) {
    throw new ApexError('INVALID_ARGUMENT', `Proposed state is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function bad(op: StateOp, why: string): ApexError {
  return new ApexError('INVALID_ARGUMENT', `Cannot apply ${op.op} at ${op.path}: ${why}`, { op });
}

/** Human-readable one-liners for a diff log or a confirmation prompt. */
export function describeOps(ops: StateOp[]): string[] {
  return ops.map((op) => {
    switch (op.op) {
      case 'set':
        return `set ${op.path} = ${JSON.stringify(op.value)}`;
      case 'merge':
        return `merge into ${op.path}: ${JSON.stringify(op.value)}`;
      case 'append':
        return `append to ${op.path}: ${JSON.stringify(op.value)}`;
      case 'remove':
        return `remove from ${op.path} ${op.where ? `where ${JSON.stringify(op.where)}` : `index ${op.index}`}`;
      case 'unset':
        return `unset ${op.path}`;
    }
  });
}
