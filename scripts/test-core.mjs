// Self-check for site/core/core.js. Run: node scripts/test-core.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { best, catalog, decodeState, encodeState, facets, filterMachines, formatValue, workArea } from '../site/core/core.js';

const schema = JSON.parse(readFileSync(new URL('../data/schema.json', import.meta.url)));
const cat = catalog(
  [
    { id: 'a', name: 'Alpha', company: 'Acme', price: 1000, stage: 'available', general: { axis: 3, enclosed: true, working_x: 300, working_y: 200, working_z: 100 }, motion: { drive_system: 'ballscrew' }, spindle: { power: 200 } },
    { id: 'b', name: 'Beta', company: 'Bolt', price: 1000, currency: 'USD', stage: 'crowdfunding', general: { axis: 5, enclosed: false }, spindle: { power: 800 } },
    { id: 'c', name: 'Gamma Lathe', company: 'Acme', stage: 'announced', general: { machine_type: 'lathe' }, lathe: { swing_diameter: 210, turning_length: 300 } },
  ],
  schema,
);
const ids = (s) => filterMachines(cat, s).map((m) => m.id);

assert.deepEqual(cat.sections.map((s) => s.key), ['overview', 'general', 'lathe', 'motion', 'spindle', 'coolant', 'probe', 'media', 'accessories']);
assert.equal(cat.sections.find((s) => s.key === 'media').kind, 'links');
assert.equal(cat.field('general.axis').filter, 'multi');
assert.equal(cat.field('name').filter, null);
assert.ok(cat.filterFields.every((f) => f.filter) && !cat.filterFields.includes(cat.field('probe.z_probe')));

assert.deepEqual(ids({ q: 'acme' }), ['a', 'c']);
assert.deepEqual(ids({ q: 'ball screw' }), ['a'], 'search matches display labels');
assert.deepEqual(ids({ filters: { 'general.axis': ['5'] } }), ['b']);
assert.deepEqual(ids({ filters: { 'general.enclosed': false } }), ['b']);
assert.deepEqual(ids({ filters: { price: [null, 900] } }), ['b'], 'USD price normalised to EUR');
assert.deepEqual(ids({ sort: '-spindle.power' }), ['b', 'a', 'c'], 'desc, unknowns last');
assert.deepEqual(ids({ sort: 'price' }), ['b', 'a', 'c']);

assert.deepEqual(facets(cat, cat.field('company')).map((f) => [f.value, f.count]), [['Acme', 2], ['Bolt', 1]]);
assert.deepEqual(facets(cat, cat.field('spindle.power')), { min: 200, max: 800 });
assert.deepEqual([...best(cat.field('spindle.power'), cat.machines)], ['b']);
assert.equal(best(cat.field('general.enclosed'), cat.machines).size, 0);

assert.equal(formatValue(cat.field('price'), 1000, cat.machine('b')), '$1,000');
assert.equal(formatValue(cat.field('motion.drive_system'), 'ballscrew'), 'Ball screw');
assert.equal(formatValue(cat.field('spindle.power'), null), '—');
assert.equal(workArea(cat.machine('a')), '300 × 200 × 100 mm');
assert.equal(workArea(cat.machine('c')), 'Ø 210 × 300 mm');

const s = { q: 'x y', sort: '-price', view: 'compare', compare: ['a', 'b'], filters: { company: ['Acme'], price: [null, 500], 'general.enclosed': true } };
assert.deepEqual(decodeState(cat, `#${encodeState(cat, s)}`), s, 'hash round trip');
assert.deepEqual(decodeState(cat, '#compare=a,zzz,a').compare, ['a'], 'unknown and duplicate ids dropped');

assert.match(encodeState(cat, s), /compare=a,b/, 'commas stay readable');
assert.deepEqual(decodeState(cat, '#f.price=abc..').filters, {}, 'garbage range dropped');

console.log('core ok');
