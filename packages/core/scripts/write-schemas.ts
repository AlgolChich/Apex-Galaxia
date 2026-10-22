/**
 * Export every Zod schema in SCHEMA_REGISTRY as a JSON Schema file into packages/core/schemas/.
 * Run with `pnpm schemas`. A test asserts the committed files match the code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderJsonSchemas } from '../src/project/json-schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'schemas');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, json] of renderJsonSchemas()) {
  const file = path.join(outDir, `${name}.schema.json`);
  fs.writeFileSync(file, json);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
