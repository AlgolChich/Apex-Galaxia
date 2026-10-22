import { z } from 'zod';
import { SCHEMA_REGISTRY } from './schemas.js';

/** Render every registered schema as a stable JSON Schema string (draft 2020-12). */
export function renderJsonSchemas(): Array<[name: string, json: string]> {
  const out: Array<[string, string]> = [];
  for (const [name, schema] of Object.entries(SCHEMA_REGISTRY)) {
    const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
    const withId = {
      $id: `https://apex-galaxia.dev/schemas/${name}.schema.json`,
      title: name,
      ...json,
    };
    out.push([name, JSON.stringify(withId, null, 2) + '\n']);
  }
  return out;
}
