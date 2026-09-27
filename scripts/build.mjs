// Merges data/cnc/*.json into site/data/machines.json (id = file name) and copies the schema.
// Run from anywhere: node scripts/build.mjs
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dir = new URL('data/cnc/', root);
const out = new URL('site/data/', root);

const machines = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => {
    try {
      const { $schema, ...m } = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      return { id: f.slice(0, -5), ...m };
    } catch (e) {
      throw new Error(`data/cnc/${f}: ${e.message}`);
    }
  });

mkdirSync(out, { recursive: true });
writeFileSync(new URL('machines.json', out), JSON.stringify(machines));
copyFileSync(new URL('data/schema.json', root), new URL('schema.json', out));
console.log(`${machines.length} machines -> site/data/machines.json`);
