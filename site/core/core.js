// Shared core: data loading, schema-driven field
// metadata, search / filter / sort, formatting and URL-hash state.
// Everything is a pure function except loadCatalog (fetch) and createStore (location/history).

export const MAX_COMPARE = 4;

// ponytail: static FX rates, only used to rank and filter mixed-currency prices; refresh now and then.
const EUR_RATES = { EUR: 1, USD: 0.86, GBP: 1.16, CHF: 1.07, CNY: 0.12, HKD: 0.11 };

// Fields a design renders in the machine header (card / compare column), not as spec rows.
const HEADER = new Set(['name', 'image_url', 'currency']);

export async function loadCatalog(base = new URL('../data/', import.meta.url)) {
  const load = async (file) => {
    const res = await fetch(new URL(file, base));
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    return res.json();
  };
  const [machines, schema] = await Promise.all([load('machines.json'), load('schema.json')]);
  return catalog(machines, schema);
}

export function catalog(machines, schema) {
  const sections = buildSections(schema);
  const fields = sections.flatMap((s) => s.fields);
  const byPath = new Map(fields.map((f) => [f.path, f]));
  const byId = new Map(machines.map((m) => [m.id, m]));
  const cat = {
    machines,
    schema,
    sections,
    fields,
    field: (path) => byPath.get(path),
    machine: (id) => byId.get(id),
    format: (m, path) => formatValue(byPath.get(path), get(m, path), m),
  };
  // Filters worth showing: filterable and at least one machine has a value.
  cat.filterFields = fields.filter((f) => f.filter && machines.some((m) => get(m, f.path) != null));
  cat.sortFields = fields.filter((f) => f.path === 'name' || f.type === 'number' || f.type === 'integer');
  return cat;
}

function buildSections(schema) {
  const overview = { key: 'overview', title: 'Overview', icon: 'info', kind: 'fields', fields: [] };
  const sections = [overview];
  for (const [key, p] of Object.entries(schema.properties)) {
    if (key === '$schema') continue;
    const meta = { key, title: p.title ?? key, icon: p['x-icon'], description: p.description };
    if (p.type === 'object') {
      const fields = Object.entries(p.properties).map(([k, q]) => toField(`${key}.${k}`, k, key, q));
      const links = fields.every((f) => f.type === 'url' || f.type === 'urls');
      sections.push({ ...meta, kind: links ? 'links' : 'fields', fields });
    } else if (p.type === 'array') {
      sections.push({ ...meta, kind: 'list', fields: [] }); // accessories
    } else {
      overview.fields.push(toField(key, key, 'overview', p));
    }
  }
  return sections;
}

function toField(path, key, section, p) {
  let type = [].concat(p.type).find((t) => t !== 'null');
  if (p.format === 'uri') type = 'url';
  if (type === 'array' && p.items?.format === 'uri') type = 'urls';
  const auto = { boolean: 'bool', number: 'range', integer: 'range', string: 'multi' }[type] ?? null;
  return {
    path,
    key,
    section,
    type, // string | number | integer | boolean | url | urls
    label: p.title ?? key,
    description: p.description,
    unit: p['x-unit'], // 'price' means: format with the machine's currency
    better: p['x-better'], // 'higher' | 'lower' | undefined
    labels: p['x-labels'] ?? {},
    enum: p.enum?.filter((v) => v !== null),
    filter: p['x-filter'] === false ? null : (p['x-filter'] ?? auto), // multi | range | bool | null
    row: !HEADER.has(path), // false: shown in the header, skip as a spec row
  };
}

export const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

const priceEUR = (m) => (m.price == null ? null : m.price * (EUR_RATES[m.currency ?? 'EUR'] ?? 1));

// Comparable value: prices normalised to EUR, everything else raw.
export const value = (m, field) => (field.unit === 'price' ? priceEUR(m) : get(m, field.path));

// ---------- formatting ----------

const num = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });

export function formatPrice(amount, currency = 'EUR') {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export const label = (field, v) =>
  field.labels[v] ?? (/^[a-z0-9_]+$/.test(v) ? String(v).charAt(0).toUpperCase() + String(v).slice(1).replaceAll('_', ' ') : String(v));

export function formatValue(field, v, m) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (field?.unit === 'price') return formatPrice(v, m?.currency);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return field?.unit ? `${num.format(v)} ${field.unit}` : num.format(v);
  if (Array.isArray(v)) return v.join(', ');
  return field ? label(field, v) : String(v);
}

// Card helper: "300 × 180 × 80 mm", lathes "Ø 210 × 300 mm".
export function workArea(m) {
  const g = m.general ?? {};
  if (g.machine_type === 'lathe' && m.lathe && (m.lathe.swing_diameter ?? m.lathe.turning_length) != null) {
    return `Ø ${num.format(m.lathe.swing_diameter ?? 0)} × ${num.format(m.lathe.turning_length ?? 0)} mm`;
  }
  const dims = [g.working_x, g.working_y, g.working_z];
  if (dims.every((d) => d == null)) return '—';
  return `${dims.map((d) => (d == null ? '?' : num.format(d))).join(' × ')} mm`;
}

// ---------- search / filter / sort ----------

const strings = (v) =>
  typeof v === 'string' ? (/^https?:/.test(v) ? [] : [v]) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

const hay = new WeakMap();
function haystack(cat, m) {
  if (!hay.has(m)) {
    const labels = cat.fields.filter((f) => f.type === 'string').map((f) => cat.format(m, f.path));
    hay.set(m, [...strings(m), ...labels].join(' ').toLowerCase());
  }
  return hay.get(m);
}

function matches(m, field, v) {
  const x = value(m, field);
  if (field.filter === 'multi') return !v.length || v.includes(String(x));
  if (field.filter === 'bool') return x === v;
  if (field.filter === 'range') return x != null && (v[0] == null || x >= v[0]) && (v[1] == null || x <= v[1]);
  return true;
}

// state: { q, filters: { path: string[] | [min, max] | boolean }, sort: 'path' | '-path' }
export function filterMachines(cat, { q = '', filters = {}, sort = 'name' } = {}) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const active = Object.entries(filters)
    .map(([path, v]) => [cat.field(path), v])
    .filter(([f]) => f);
  const hits = cat.machines.filter(
    (m) => tokens.every((t) => haystack(cat, m).includes(t)) && active.every(([f, v]) => matches(m, f, v)),
  );
  return sortMachines(cat, hits, sort);
}

function sortMachines(cat, list, sort = 'name') {
  const desc = sort.startsWith('-');
  const field = cat.field(sort.replace(/^-/, '')) ?? cat.field('name');
  return [...list].sort((a, b) => {
    const x = value(a, field);
    const y = value(b, field);
    if (x == null || y == null) return (x == null) - (y == null); // unknowns always last
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true });
    return desc ? -c : c;
  });
}

// range → { min, max } | null, bool → { true: n, false: n }, multi → [{ value, label, count }]
export function facets(cat, field, machines = cat.machines) {
  const vals = machines.map((m) => value(m, field)).filter((v) => v != null);
  if (field.filter === 'range') return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  if (field.filter === 'bool') return { true: vals.filter((v) => v === true).length, false: vals.filter((v) => v === false).length };
  const counts = new Map();
  for (const v of vals) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  return [...counts]
    .map(([v, count]) => ({ value: v, label: label(field, v), count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
}

// ---------- comparison helpers ----------

// Ids holding the best value of a field with x-better; empty when there is no clear winner.
export function best(field, machines) {
  if (!field.better) return new Set();
  const vals = machines.map((m) => [m.id, value(m, field)]).filter(([, v]) => typeof v === 'number');
  if (vals.length < 2) return new Set();
  const target = (field.better === 'higher' ? Math.max : Math.min)(...vals.map(([, v]) => v));
  const winners = vals.filter(([, v]) => v === target);
  return new Set(winners.length === vals.length ? [] : winners.map(([id]) => id));
}

export const hasData = (field, machines) => machines.some((m) => get(m, field.path) != null);

export const differs = (field, machines) => new Set(machines.map((m) => JSON.stringify(get(m, field.path) ?? null))).size > 1;

// ---------- URL hash state ----------
// #q=carvera&sort=-spindle.power&view=compare&compare=a,b&f.company=Makera,Lunyee&f.price=..2000&f.general.enclosed=1

export function encodeState(cat, s) {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.sort && s.sort !== 'name') p.set('sort', s.sort);
  if (s.view && s.view !== 'grid') p.set('view', s.view);
  if (s.compare?.length) p.set('compare', s.compare.join(','));
  for (const [path, v] of Object.entries(s.filters ?? {})) {
    const f = cat.field(path);
    // ponytail: multi values are comma-joined, so a raw value containing a comma would split.
    const enc =
      f?.filter === 'multi' ? v.join(',') : f?.filter === 'range' ? `${v[0] ?? ''}..${v[1] ?? ''}` : f?.filter === 'bool' ? (v ? '1' : '0') : '';
    if (enc && enc !== '..') p.set(`f.${path}`, enc);
  }
  return p.toString().replaceAll('%2C', ','); // readable share links; URLSearchParams decodes raw commas
}

export function decodeState(cat, hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const filters = {};
  for (const [k, raw] of p) {
    const f = k.startsWith('f.') && cat.field(k.slice(2));
    if (!f) continue;
    if (f.filter === 'multi') filters[f.path] = raw.split(',').filter(Boolean);
    if (f.filter === 'range') {
      const r = raw.split('..').map((x) => (x === '' || !Number.isFinite(+x) ? null : +x));
      if (r.some((x) => x != null)) filters[f.path] = r;
    }
    if (f.filter === 'bool') filters[f.path] = raw === '1';
  }
  return {
    q: p.get('q') ?? '',
    sort: p.get('sort') ?? 'name',
    view: p.get('view') ?? 'grid',
    compare: [...new Set((p.get('compare') ?? '').split(','))].filter((id) => cat.machine(id)).slice(0, MAX_COMPARE),
    filters,
  };
}

// Hash-backed store. set() accepts a patch object or fn(state) → patch; { push: true } adds a history entry.
export function createStore(cat) {
  let state = decodeState(cat, location.hash);
  const subs = new Set();
  const emit = () => subs.forEach((fn) => fn(state));
  addEventListener('hashchange', () => {
    state = decodeState(cat, location.hash);
    emit();
  });
  const store = {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(patch, { push = false } = {}) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      const hash = encodeState(cat, state);
      history[push ? 'pushState' : 'replaceState'](null, '', hash ? `#${hash}` : location.pathname + location.search);
      emit();
    },
    // v: string[] (multi) | [min, max] (range, either may be null) | boolean (bool) | null to clear
    setFilter(path, v) {
      const filters = { ...state.filters };
      if (v == null || (Array.isArray(v) && v.every((x) => x == null))) delete filters[path];
      else filters[path] = v;
      store.set({ filters });
    },
    clearFilters: () => store.set({ filters: {}, q: '' }),
    addCompare(id) {
      if (state.compare.includes(id) || state.compare.length >= MAX_COMPARE || !cat.machine(id)) return false;
      store.set({ compare: [...state.compare, id] });
      return true;
    },
    removeCompare: (id) => store.set({ compare: state.compare.filter((c) => c !== id) }),
    toggleCompare: (id) => (state.compare.includes(id) ? store.removeCompare(id) : store.addCompare(id)),
    openCompare(id) {
      const compare = id && !state.compare.includes(id) ? [...state.compare, id].slice(-MAX_COMPARE) : state.compare;
      store.set({ compare, view: 'compare' }, { push: true });
    },
    closeCompare: () => store.set({ view: 'grid' }, { push: true }),
  };
  return store;
}
