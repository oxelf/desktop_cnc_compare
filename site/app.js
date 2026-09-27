// BLUEPRINT design: spec-sheet catalog + comparison sheet on top of the shared core.
import {
  MAX_COMPARE, best, createStore, differs, facets, filterMachines, formatPrice, get, hasData,
  label as valueLabel, loadCatalog, value, workArea,
} from './core/core.js';
import { icon } from './core/icons.js';
import { STYLES, envelope, isoScale, isoSVG, overlay, projectionSymbol, swatch } from './draw.js';

// ---------- small helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const KEYS = 'ABCD';
const nf = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
const pad = (n) => String(n).padStart(2, '0');
const mqMobile = matchMedia('(max-width: 960px)');

const prefs = {
  get(k, d) {
    try { return localStorage.getItem(k) ?? d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* private mode: preference just isn't kept */ }
  },
};

// Leading + trailing throttle: keeps history.replaceState well under browser rate limits.
function throttle(fn, ms) {
  let last = 0;
  let t = null;
  let args = [];
  const run = () => { last = Date.now(); t = null; fn(...args); };
  const th = (...a) => {
    args = a;
    const wait = ms - (Date.now() - last);
    if (wait <= 0 && !t) run();
    else if (!t) t = setTimeout(run, Math.max(wait, 0));
  };
  th.flush = () => { if (t) { clearTimeout(t); run(); } };
  return th;
}

const isTyping = (el) => el instanceof HTMLElement && (el.matches('input, select, textarea') || el.isContentEditable);

// Every image sits in a .media frame that carries a designed placeholder for broken / missing images.
const PH = `<span class="ph" aria-hidden="true">${icon('image-off', { size: 22 })}<span>No image</span></span>`;
function media(url, alt, cls = '', lazy = true) {
  if (!url) return `<span class="media noimg ${cls}">${PH}</span>`;
  return `<span class="media ${cls}"><img src="${esc(url)}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('broken')">${PH}</span>`;
}

// ---------- boot ----------

let cat;
let store;
let ISO_S = 0.3;
let layout = prefs.get('bp-layout', 'grid') === 'list' ? 'list' : 'grid';
let diffOnly = prefs.get('bp-diff', '0') === '1';

const els = {
  layout: $('#layout'),
  sidebar: $('#sidebar'),
  panel: $('#panel'),
  catalog: $('#catalog'),
  compare: $('#compare'),
  results: $('#results'),
  count: $('#count'),
  chips: $('#chips'),
  tools: $('#tools'),
  tray: $('#tray'),
  q: $('#q'),
  theme: $('#theme'),
  drawer: $('#drawer'),
  drawerBody: $('#drawer-body'),
  list: $('#add-list'),
};


function showError(err) {
  console.warn('[blueprint] data load failed', err);
  els.results.removeAttribute('aria-busy');
  els.results.className = 'results';
  els.count.textContent = 'Data unavailable';
  els.panel.querySelector('.skel-lines')?.remove();
  els.q.disabled = true;
  els.panel.insertAdjacentHTML('beforeend', '<p class="panel-foot">Parameters appear once the machine data has loaded.</p>');
  els.results.innerHTML = `<div class="state state-error" role="alert">
    <svg class="state-art" viewBox="0 0 160 100" aria-hidden="true"><path class="hid" d="M30 70 L80 45 L130 70 L80 95 Z M30 70 V35 L80 10 L130 35 V70 M80 45 V10"/><path class="x" d="M62 40 L98 76 M98 40 L62 76"/></svg>
    <p class="eyebrow">Error · E-01</p>
    <h2>Machine data could not be loaded</h2>
    <p class="state-msg"><code>${esc(err?.message ?? err)}</code></p>
    <button class="btn primary" type="button" id="retry">${icon('rotate-3d', { size: 16 })} Try again</button>
  </div>`;
  $('#retry').addEventListener('click', () => location.reload());
}

function start() {
  store = createStore(cat);
  ISO_S = isoScale(cat.machines);
  $('#tb-count').textContent = `${cat.machines.length} machines · ${cat.fields.length} parameters`;
  $('#tb-rev').textContent = latestUpdate();
  buildTools();
  buildFilters();
  bindGlobal();
  els.results.removeAttribute('aria-busy');
  store.subscribe(render);
  render(store.get());
}

function latestUpdate() {
  const ds = cat.machines
    .map((m) => /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(m.last_updated ?? ''))
    .filter(Boolean)
    .map(([, d, mo, y]) => `${y}${mo}${d}`)
    .sort();
  const top = ds.at(-1);
  return top ? `${top.slice(6)}.${top.slice(4, 6)}.${top.slice(0, 4)}` : '—';
}

// ---------- theme ----------

function initTheme() {
  const paint = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    els.theme.innerHTML = icon(dark ? 'sun' : 'moon', { size: 18 });
    els.theme.setAttribute('aria-label', dark ? 'Switch to paper mode' : 'Switch to blueprint mode');
    els.theme.title = dark ? 'Paper mode' : 'Blueprint mode';
    els.theme.setAttribute('aria-pressed', String(dark));
  };
  paint();
  els.theme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    prefs.set('bp-theme', next);
    paint();
  });
  document.querySelectorAll('[data-close-drawer]').forEach((b) => {
    if (!b.textContent.trim()) b.innerHTML = icon('x', { size: 18 });
  });
}

// ---------- rendering ----------

let lastView = null;
let gridScrollY = 0;
let returnFocusId = null;

function render(state) {
  const view = state.view === 'compare' ? 'compare' : 'grid';
  const changed = view !== lastView;
  if (changed && lastView === 'grid') gridScrollY = scrollY;
  els.layout.classList.toggle('is-compare', view === 'compare');
  document.body.classList.toggle('is-compare', view === 'compare');
  els.catalog.hidden = view === 'compare';
  els.compare.hidden = view !== 'compare';
  if (view === 'compare') renderCompare(state);
  else renderCatalog(state);
  renderTray(state, view);
  syncSearch(state);
  const names = view === 'compare' && state.compare.map((id) => cat.machine(id)?.name).join(' vs ');
  document.title = names ? `${names} — CNC Compare` : 'Desktop CNC Compare';
  if (changed && lastView !== null) afterViewChange(view);
  lastView = view;
}

// Restore scroll + move focus sensibly when switching between catalog and comparison.
function afterViewChange(view) {
  if (view === 'compare') {
    scrollTo({ top: 0 });
    $('#h-compare')?.focus({ preventScroll: true });
    return;
  }
  scrollTo({ top: gridScrollY });
  const back = returnFocusId && els.results.querySelector(`[data-cmp="${CSS.escape(returnFocusId)}"]`);
  (back || els.q).focus({ preventScroll: true });
}

function syncSearch(state) {
  if (els.q.value !== state.q && document.activeElement !== els.q) els.q.value = state.q;
}

function renderCatalog(state) {
  const list = filterMachines(cat, state);
  const total = cat.machines.length;
  els.count.innerHTML = `<strong>${pad(list.length)}</strong><span class="of"> / ${pad(total)}</span> machines${list.length !== total ? ' match' : ''}`;
  $('#drawer-show').textContent = list.length ? `Show ${list.length} machine${list.length === 1 ? '' : 's'}` : 'No matches';
  updateTools(state);
  renderChips(state);
  updateFilters(state);
  renderResults(state, list);
}

// ---------- toolbar: sort + layout ----------

function buildTools() {
  const opts = cat.sections
    .map((sec) => {
      const fs = cat.sortFields.filter((f) => f.section === sec.key);
      return fs.length ? `<optgroup label="${esc(sec.title)}">${fs.map((f) => `<option value="${esc(f.path)}">${esc(f.label)}</option>`).join('')}</optgroup>` : '';
    })
    .join('');
  els.tools.innerHTML = `
    <button class="btn filters-btn" type="button" data-open-drawer aria-haspopup="dialog">${icon('sliders-horizontal', { size: 16 })}<span>Filters</span><span class="n" hidden></span></button>
    <div class="sort">
      <label class="sort-l" for="sort">Sort</label>
      <select id="sort">${opts}</select>
      <button class="btn dir" type="button" id="dir"></button>
    </div>
    <div class="seg" role="group" aria-label="Layout">
      <button type="button" data-layout="grid" aria-label="Spec-sheet grid">${icon('layout-grid', { size: 16 })}</button>
      <button type="button" data-layout="list" aria-label="Dense table">${icon('list', { size: 16 })}</button>
    </div>`;
  els.tools.hidden = false;
  $('#sort').addEventListener('change', (e) => {
    const f = cat.field(e.target.value);
    store.set({ sort: (f?.better === 'higher' ? '-' : '') + e.target.value });
  });
  $('#dir').addEventListener('click', () => {
    const s = store.get().sort;
    store.set({ sort: s.startsWith('-') ? s.slice(1) : `-${s}` });
  });
  els.tools.querySelectorAll('[data-layout]').forEach((b) =>
    b.addEventListener('click', () => {
      layout = b.dataset.layout;
      prefs.set('bp-layout', layout);
      render(store.get());
    }),
  );
}

function updateTools(state) {
  const desc = state.sort.startsWith('-');
  const path = state.sort.replace(/^-/, '');
  const sel = $('#sort');
  sel.value = cat.sortFields.some((f) => f.path === path) ? path : 'name';
  const dir = $('#dir');
  dir.innerHTML = `${icon(desc ? 'chevron-down' : 'chevron-up', { size: 14 })}<span>${desc ? 'Desc' : 'Asc'}</span>`;
  dir.setAttribute('aria-label', `Sort direction: ${desc ? 'descending' : 'ascending'}. Switch to ${desc ? 'ascending' : 'descending'}`);
  els.tools.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === layout)));
  const n = Object.keys(state.filters).length;
  const badge = els.tools.querySelector('.filters-btn .n');
  badge.hidden = !n;
  badge.textContent = n;
}

// ---------- active filter chips ----------

const fmtBound = (f, v) => (f.unit === 'price' ? formatPrice(v, 'EUR') : `${nf.format(v)}${f.unit ? ` ${f.unit}` : ''}`);

function filterText(f, v) {
  if (f.filter === 'multi') return v.map((x) => valueLabel(f, x)).join(', ');
  if (f.filter === 'bool') return v ? 'Yes' : 'No';
  const [lo, hi] = v;
  if (lo != null && hi != null) return `${fmtBound(f, lo)} – ${fmtBound(f, hi)}`;
  return lo != null ? `≥ ${fmtBound(f, lo)}` : `≤ ${fmtBound(f, hi)}`;
}

function renderChips(state) {
  const entries = Object.entries(state.filters).filter(([p]) => cat.field(p));
  if (!entries.length && !state.q) {
    els.chips.hidden = true;
    els.chips.innerHTML = '';
    return;
  }
  els.chips.hidden = false;
  const chip = (k, v, attr, aria) =>
    `<li class="chip"><span class="chip-k">${esc(k)}</span><span class="chip-v">${esc(v)}</span><button type="button" ${attr} aria-label="${esc(aria)}">${icon('x', { size: 14 })}</button></li>`;
  els.chips.innerHTML = `<ul class="chip-list" aria-label="Active filters">
    ${state.q ? chip('Search', `“${state.q}”`, 'data-rm-q', 'Clear search') : ''}
    ${entries.map(([p, v]) => { const f = cat.field(p); const t = filterText(f, v); return chip(f.label, t, `data-rm-filter="${esc(p)}"`, `Remove filter ${f.label}: ${t}`); }).join('')}
  </ul><button class="btn ghost sm" type="button" data-clear>${icon('filter-x', { size: 14 })} Clear all</button>`;
}

// ---------- results: grid + dense table ----------

const cardCache = new Map();
const rowCache = new Map();
let tableEl = null;

function stageBadge(m) {
  if (!m.stage) return '';
  return `<span class="stage st-${esc(m.stage)}">${m.stage === 'available' ? '<i class="led" aria-hidden="true"></i>' : ''}${esc(cat.format(m, 'stage'))}</span>`;
}

function priceBlock(m) {
  const own = formatPrice(m.price, m.currency ?? 'EUR');
  const eur = m.price != null && m.currency && m.currency !== 'EUR' ? `<span class="eur">≈ ${formatPrice(value(m, cat.field('price')), 'EUR')}</span>` : '';
  return m.price == null ? `<strong class="na">—</strong><span class="eur">No price yet</span>` : `<strong>${esc(own)}</strong>${eur}`;
}

const fmt = (m, path) => (cat.field(path) ? cat.format(m, path) : '—');
const dash = (s) => (s === '—' ? '<span class="nil">—</span>' : esc(s));

function buildCard(m) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = m.id;
  const type = get(m, 'general.machine_type');
  const axis = get(m, 'general.axis');
  const meta = [type ? fmt(m, 'general.machine_type') : null, axis ? `${axis}-axis` : null].filter(Boolean).join(' · ');
  const site = get(m, 'media.website');
  const dims = workArea(m);
  el.innerHTML = `
    <header class="c-strip">${stageBadge(m)}<span class="c-meta">${esc(meta)}</span><span class="c-key" aria-hidden="true"></span></header>
    <div class="c-figs">
      <figure class="c-fig c-img">${media(m.image_url, m.name)}<figcaption>Fig. 1</figcaption></figure>
      <figure class="c-fig c-env">${isoSVG(m, ISO_S, `Working envelope ${dims}`)}<figcaption>Fig. 2 · Envelope</figcaption></figure>
    </div>
    <div class="c-title">
      <div class="c-name"><p class="c-co">${esc(m.company)}</p><h3>${esc(m.name)}</h3></div>
      <div class="c-price">${priceBlock(m)}</div>
    </div>
    <dl class="c-specs">
      <div><dt>Work area</dt><dd>${dash(dims)}</dd></div>
      <div><dt>Spindle</dt><dd>${dash(fmt(m, 'spindle.power'))}</dd></div>
      <div><dt>Axes</dt><dd>${dash(fmt(m, 'general.axis'))}</dd></div>
    </dl>
    <footer class="c-foot">
      <span class="c-rev">Rev. ${esc(m.last_updated ?? '—')}</span>
      ${site ? `<a class="c-site" href="${esc(site)}" target="_blank" rel="noopener" aria-label="${esc(m.name)} vendor website (opens in new tab)">${icon('external-link', { size: 15 })}</a>` : ''}
      <button class="cmp-btn" type="button" data-cmp="${esc(m.id)}"></button>
    </footer>`;
  return el;
}

const card = (m) => cardCache.get(m.id) ?? cardCache.set(m.id, buildCard(m)).get(m.id);

function listColumns() {
  return [
    { label: 'Machine', sort: 'name' },
    { label: 'Status', path: 'stage' },
    { label: 'Price', sort: 'price', num: true },
    { label: 'Work area', num: true },
    { label: 'Spindle', sort: 'spindle.power', num: true },
    { label: 'Axes', sort: 'general.axis', num: true },
    { label: 'Type', path: 'general.machine_type' },
    { label: 'Controller', path: 'general.control_system' },
    { label: 'Enclosure', path: 'general.enclosed' },
  ].filter((c) => !c.sort || cat.field(c.sort));
}

function buildRow(m) {
  const tr = document.createElement('tr');
  tr.dataset.id = m.id;
  const cells = listColumns().map((c) => {
    switch (c.label) {
      case 'Machine':
        return `<th scope="row" class="l-m"><div class="l-mi">${media(m.image_url, '', 'l-th')}<span class="l-nm"><b>${esc(m.name)}</b><small>${esc(m.company)}</small></span></div></th>`;
      case 'Status': return `<td>${stageBadge(m)}</td>`;
      case 'Price': return `<td class="num">${m.price == null ? '<span class="nil">—</span>' : esc(formatPrice(m.price, m.currency ?? 'EUR'))}</td>`;
      case 'Work area': return `<td class="num">${dash(workArea(m))}</td>`;
      case 'Spindle': return `<td class="num">${dash(fmt(m, 'spindle.power'))}</td>`;
      case 'Axes': return `<td class="num">${dash(fmt(m, 'general.axis'))}</td>`;
      case 'Enclosure': {
        const v = get(m, c.path);
        return `<td class="bool">${v == null ? '<span class="nil">—</span>' : v ? icon('check', { size: 16, label: 'Yes' }) : icon('x', { size: 16, label: 'No', cls: 'no' })}</td>`;
      }
      default: return `<td>${dash(fmt(m, c.path))}</td>`;
    }
  });
  tr.innerHTML = `${cells.join('')}<td class="l-act"><button class="cmp-btn sm" type="button" data-cmp="${esc(m.id)}"></button></td>`;
  return tr;
}

const row = (m) => rowCache.get(m.id) ?? rowCache.set(m.id, buildRow(m)).get(m.id);

function buildTable() {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `<table class="dense"><caption class="sr">Machines, dense table</caption><thead><tr>${listColumns()
    .map((c) => `<th scope="col"${c.num ? ' class="num"' : ''}>${c.sort ? `<button type="button" data-sort="${c.sort}">${esc(c.label)}<span class="sort-i" aria-hidden="true"></span></button>` : esc(c.label)}</th>`)
    .join('')}<th scope="col"><span class="sr">Compare</span></th></tr></thead><tbody></tbody></table>`;
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const cur = store.get().sort;
    const path = b.dataset.sort;
    const f = cat.field(path);
    const next = cur.replace(/^-/, '') === path ? (cur.startsWith('-') ? path : `-${path}`) : (f?.better === 'higher' ? '-' : '') + path;
    store.set({ sort: next });
  });
  return wrap;
}

function renderResults(state, list) {
  if (!list.length) {
    els.results.className = 'results';
    els.results.replaceChildren(emptyState(state));
    return;
  }
  if (layout === 'grid') {
    els.results.className = 'results grid';
    els.results.replaceChildren(...list.map(card));
  } else {
    tableEl ??= buildTable();
    els.results.className = 'results list';
    $('tbody', tableEl).replaceChildren(...list.map(row));
    const path = state.sort.replace(/^-/, '');
    tableEl.querySelectorAll('th[scope=col]').forEach((th) => {
      const b = th.querySelector('[data-sort]');
      const on = b && b.dataset.sort === path;
      if (on) th.setAttribute('aria-sort', state.sort.startsWith('-') ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
      if (b) b.querySelector('.sort-i').innerHTML = on ? icon(state.sort.startsWith('-') ? 'chevron-down' : 'chevron-up', { size: 12 }) : '';
    });
    els.results.replaceChildren(tableEl);
  }
  markSelected(state);
}

function markSelected(state) {
  const paint = (el, id) => {
    const i = state.compare.indexOf(id);
    const on = i >= 0;
    const m = cat.machine(id);
    el.classList.toggle('sel', on);
    const key = el.querySelector('.c-key');
    if (key) key.innerHTML = on ? `${icon('check', { size: 11 })}${KEYS[i]}` : '';
    const b = el.querySelector('.cmp-btn');
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? `${m.name} is in the comparison (${KEYS[i]}). Open comparison` : `Compare ${m.name}`);
    b.title = on ? 'In comparison · open sheet' : 'Add to comparison';
    b.innerHTML = `${icon(on ? 'check' : 'git-compare-arrows', { size: 16 })}${b.classList.contains('sm') ? '' : `<span>${on ? `In sheet` : 'Compare'}</span>`}`;
  };
  for (const [id, el] of cardCache) paint(el, id);
  for (const [id, el] of rowCache) paint(el, id);
}

function emptyState(state) {
  const div = document.createElement('div');
  div.className = 'state state-empty';
  const n = Object.keys(state.filters).length;
  div.innerHTML = `
    <svg class="state-art" viewBox="0 0 160 100" aria-hidden="true"><path class="hid" d="M40 62 L80 42 L120 62 L80 82 Z M40 62 V32 L80 12 L120 32 V62 M80 42 V12 M40 32 L80 52 L120 32 M80 52 V82"/><path class="ext" d="M40 62 L35 72 M80 82 L75 92"/><path class="dimline" d="M36.5 69 L76.5 89 M34 71 l5 -4 M74 91 l5 -4"/><text class="dimtext" x="52" y="86" transform="rotate(26.6 52 86)" text-anchor="middle">0 mm</text></svg>
    <p class="eyebrow">Result · 00</p>
    <h2>No machine fits this envelope</h2>
    <p class="state-msg">${state.q ? `Nothing matches “<b>${esc(state.q)}</b>”` : 'Nothing matches'}${n ? ` with ${n} active parameter${n === 1 ? '' : 's'}` : ''}. Loosen a constraint or start over.</p>
    <button class="btn primary" type="button" data-clear>${icon('filter-x', { size: 16 })} Reset search &amp; filters</button>`;
  return div;
}

// ---------- compare tray ----------

function renderTray(state, view) {
  const show = view === 'grid' && state.compare.length > 0;
  els.tray.hidden = !show;
  document.body.classList.toggle('has-tray', show);
  if (!show) return;
  const ms = state.compare.map((id) => cat.machine(id));
  const slots = Array.from({ length: MAX_COMPARE }, (_, i) => {
    const m = ms[i];
    if (!m) return `<li class="slot empty" aria-hidden="true"><span class="k">${KEYS[i]}</span><span class="slot-n">Empty slot</span></li>`;
    return `<li class="slot"><span class="k">${KEYS[i]}</span>${media(m.image_url, '', 'slot-img', false)}<span class="slot-n">${esc(m.name)}</span><button type="button" class="slot-x" data-rm="${esc(m.id)}" aria-label="Remove ${esc(m.name)} from comparison">${icon('x', { size: 14 })}</button></li>`;
  }).join('');
  els.tray.innerHTML = `<div class="tray-in">
    <p class="tray-l">${icon('git-compare-arrows', { size: 16 })}<span>Compare</span><span class="tray-n">${ms.length}/${MAX_COMPARE}</span></p>
    <ol class="tray-slots">${slots}</ol>
    <div class="tray-act">
      <button type="button" class="btn ghost icon-only" data-clear-compare aria-label="Clear comparison" title="Clear comparison">${icon('trash-2', { size: 16 })}</button>
      <button type="button" class="btn primary" data-open-compare>Open sheet ${icon('arrow-up-right', { size: 16 })}</button>
    </div>
  </div>`;
}

// ---------- filters (built once, updated in place) ----------

const controls = [];
const groups = [];
let openGroups;

function buildFilters() {
  const panel = els.panel;
  panel.innerHTML = `<div class="panel-head">
      <h2 class="panel-title">Parameters <span class="panel-n" hidden></span></h2>
      <button class="btn ghost sm" type="button" data-clear disabled>Reset</button>
    </div>
    <div class="panel-body"></div>
    <p class="panel-foot">Filters are generated from <code>schema.json</code>: every filterable field with data appears here.</p>`;
  const body = $('.panel-body', panel);
  openGroups = loadOpenGroups();
  const secs = cat.sections
    .map((sec) => ({ sec, fields: cat.filterFields.filter((f) => f.section === sec.key) }))
    .filter((g) => g.fields.length);
  secs.forEach(({ sec, fields }, i) => body.append(filterGroup(sec, fields, i + 1)));
}

function loadOpenGroups() {
  try {
    return new Set(JSON.parse(prefs.get('bp-groups', 'null')) ?? ['overview', 'general']);
  } catch {
    return new Set(['overview', 'general']);
  }
}

const CONTROL = { multi: (f) => multiControl(f), range: (f) => rangeControl(f), bool: (f) => boolControl(f) };

// One collapsible section group (schema section → icon + title + its filterable fields).
function filterGroup(sec, fields, no) {
  const det = document.createElement('details');
  det.className = 'fgroup';
  det.open = openGroups.has(sec.key);
  det.innerHTML = `<summary><span class="fg-no">${pad(no)}</span>${icon(sec.icon ?? 'info', { size: 16, cls: 'fg-i' })}<span class="fg-t">${esc(sec.title)}</span><span class="fg-n" hidden></span>${icon('chevron-down', { size: 16, cls: 'chev' })}</summary><div class="fg-body"></div>`;
  const fb = $('.fg-body', det);
  for (const c of fields.map((f) => CONTROL[f.filter]?.(f)).filter(Boolean)) {
    fb.append(c.el);
    controls.push(c);
  }
  det.addEventListener('toggle', () => {
    openGroups[det.open ? 'add' : 'delete'](sec.key);
    prefs.set('bp-groups', JSON.stringify([...openGroups]));
  });
  groups.push({ det, fields });
  return det;
}

function updateFilters(state) {
  for (const c of controls) {
    const others = { ...state.filters };
    delete others[c.f.path];
    c.update(state.filters[c.f.path], filterMachines(cat, { q: state.q, filters: others }));
  }
  for (const g of groups) {
    const n = g.fields.filter((f) => f.path in state.filters).length;
    const b = $('.fg-n', g.det);
    b.hidden = !n;
    b.textContent = n;
    if (n && !g.det.open && !g.det.dataset.auto) { g.det.open = true; g.det.dataset.auto = '1'; }
  }
  const n = Object.keys(state.filters).length;
  const pn = $('.panel-n', els.panel);
  pn.hidden = !n;
  pn.textContent = `${n} active`;
  $('.panel-head [data-clear]', els.panel).disabled = !n && !state.q;
}

const fid = (f) => `f-${f.path.replace(/[^a-z0-9]+/gi, '-')}`;
const unitTag = (f) => (f.unit === 'price' ? 'EUR' : f.unit ?? '');

function multiControl(f) {
  let all = facets(cat, f);
  if (f.enum) all = [...all].sort((a, b) => f.enum.indexOf(a.value) - f.enum.indexOf(b.value));
  if (f.type === 'integer') all = [...all].sort((a, b) => a.value - b.value);
  const LIMIT = 6;
  const many = all.length > LIMIT + 2;
  const el = document.createElement('fieldset');
  el.className = 'fc fc-multi';
  el.innerHTML = `<legend class="fc-l">${esc(f.label)}</legend>
    <ul class="opts">${all
      .map((o, i) => `<li${many && i >= LIMIT ? ' class="more"' : ''}><label class="opt"><input type="checkbox" value="${esc(o.value)}"><span class="box" aria-hidden="true">${icon('check', { size: 12 })}</span><span class="opt-l">${f.path === 'stage' ? `<i class="st-dot st-${esc(o.value)}"></i>` : ''}${esc(o.label)}</span><span class="opt-n"></span></label></li>`)
      .join('')}</ul>
    ${many ? `<button type="button" class="more-btn" aria-expanded="false">${icon('plus', { size: 12 })}<span>Show all ${all.length}</span></button>` : ''}`;
  el.addEventListener('change', () => {
    const vals = [...el.querySelectorAll('input:checked')].map((i) => i.value);
    store.setFilter(f.path, vals.length ? vals : null);
  });
  const more = $('.more-btn', el);
  more?.addEventListener('click', () => {
    const open = el.classList.toggle('expanded');
    more.setAttribute('aria-expanded', String(open));
    more.innerHTML = `${icon(open ? 'minus' : 'plus', { size: 12 })}<span>${open ? 'Show fewer' : `Show all ${all.length}`}</span>`;
  });
  const inputs = [...el.querySelectorAll('input')];
  return {
    f,
    el,
    update(v, pool) {
      const counts = new Map(facets(cat, f, pool).map((o) => [o.value, o.count]));
      for (const inp of inputs) {
        const on = !!v?.includes(inp.value);
        inp.checked = on;
        const n = counts.get(inp.value) ?? 0;
        const li = inp.closest('li');
        li.querySelector('.opt-n').textContent = n;
        li.classList.toggle('zero', !n && !on);
        if (on && li.classList.contains('more') && !el.classList.contains('expanded')) more?.click();
      }
    },
  };
}

function niceStep(x) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const k = x / p;
  return (k < 1.5 ? 1 : k < 3.5 ? 2 : k < 7.5 ? 5 : 10) * p;
}
const decimals = (s) => Math.max(0, -Math.floor(Math.log10(s)));

function rangeControl(f) {
  const b = facets(cat, f);
  if (!b) return null;
  const el = document.createElement('fieldset');
  el.className = 'fc fc-range';
  const unit = unitTag(f);
  const legend = `<legend class="fc-l">${esc(f.label)}${unit ? `<span class="fc-u">${esc(unit)}</span>` : ''}</legend>`;
  if (b.min === b.max) {
    el.innerHTML = `${legend}<p class="fc-single">All listed machines: <b>${esc(fmtBound(f, b.min))}</b></p>`;
    return { f, el, update() {} };
  }
  const step = f.type === 'integer' ? 1 : niceStep((b.max - b.min) / 100);
  const dp = decimals(step);
  const lo0 = +(Math.floor(b.min / step) * step).toFixed(dp);
  const hi0 = +(Math.ceil(b.max / step) * step).toFixed(dp);
  const BINS = 18;
  const vals = cat.machines.map((m) => value(m, f)).filter((v) => typeof v === 'number');
  const bin = (v) => Math.min(BINS - 1, Math.floor(((v - lo0) / (hi0 - lo0)) * BINS));
  const binCounts = (vs) => vs.reduce((a, v) => (a[bin(v)]++, a), Array(BINS).fill(0));
  const allBins = binCounts(vals);
  const maxBin = Math.max(...allBins);
  const id = fid(f);
  el.innerHTML = `${legend}
    <div class="hist" aria-hidden="true">${allBins.map((c) => `<i style="--a:${c / maxBin}"><b></b></i>`).join('')}</div>
    <div class="dual">
      <div class="track"><div class="fill"></div></div>
      <input type="range" class="lo" min="${lo0}" max="${hi0}" step="${step}" value="${lo0}" aria-label="Minimum ${esc(f.label)}">
      <input type="range" class="hi" min="${lo0}" max="${hi0}" step="${step}" value="${hi0}" aria-label="Maximum ${esc(f.label)}">
    </div>
    <div class="rng-scale" aria-hidden="true"><span>${esc(fmtBound(f, b.min))}</span><span>${esc(fmtBound(f, b.max))}</span></div>
    <div class="rng-in">
      <label for="${id}-lo"><span>Min<b class="sr"> ${esc(f.label)}</b></span><input id="${id}-lo" type="number" inputmode="decimal" step="any" placeholder="${+b.min.toFixed(dp)}"></label>
      <span class="to" aria-hidden="true">→</span>
      <label for="${id}-hi"><span>Max<b class="sr"> ${esc(f.label)}</b></span><input id="${id}-hi" type="number" inputmode="decimal" step="any" placeholder="${+b.max.toFixed(dp)}"></label>
    </div>`;
  const [sLo, sHi] = el.querySelectorAll('input[type=range]');
  const [nLo, nHi] = el.querySelectorAll('input[type=number]');
  const dual = $('.dual', el);
  const bars = [...el.querySelectorAll('.hist i')];
  const frac = (v) => (v - lo0) / (hi0 - lo0);
  let cur = [null, null];
  const paint = (lo, hi) => {
    dual.style.setProperty('--lo', frac(lo));
    dual.style.setProperty('--hi', frac(hi));
    bars.forEach((bar, i) => {
      const a = lo0 + ((hi0 - lo0) * i) / BINS;
      const z = lo0 + ((hi0 - lo0) * (i + 1)) / BINS;
      bar.classList.toggle('out', z <= lo || a > hi);
    });
    sLo.setAttribute('aria-valuetext', fmtBound(f, lo));
    sHi.setAttribute('aria-valuetext', fmtBound(f, hi));
  };
  const commit = throttle((lo, hi) => store.setFilter(f.path, [lo <= lo0 ? null : lo, hi >= hi0 ? null : hi]), 180);
  const onSlide = (which) => {
    let lo = +sLo.value;
    let hi = +sHi.value;
    if (lo > hi) {
      if (which === 'lo') lo = hi;
      else hi = lo;
      sLo.value = lo;
      sHi.value = hi;
    }
    paint(lo, hi);
    nLo.value = lo <= lo0 ? '' : lo;
    nHi.value = hi >= hi0 ? '' : hi;
    commit(lo, hi);
  };
  sLo.addEventListener('input', () => onSlide('lo'));
  sHi.addEventListener('input', () => onSlide('hi'));
  sLo.addEventListener('change', () => commit.flush());
  sHi.addEventListener('change', () => commit.flush());
  const onNum = () => {
    const lo = nLo.value === '' ? null : +nLo.value;
    const hi = nHi.value === '' ? null : +nHi.value;
    if (Number.isNaN(lo) || Number.isNaN(hi)) return;
    store.setFilter(f.path, [lo, hi]);
  };
  nLo.addEventListener('change', onNum);
  nHi.addEventListener('change', onNum);
  return {
    f,
    el,
    update(v, pool) {
      cur = v ?? [null, null];
      const lo = cur[0] ?? lo0;
      const hi = cur[1] ?? hi0;
      if (document.activeElement !== sLo && document.activeElement !== sHi) {
        sLo.value = lo;
        sHi.value = hi;
      }
      if (document.activeElement !== nLo) nLo.value = cur[0] ?? '';
      if (document.activeElement !== nHi) nHi.value = cur[1] ?? '';
      paint(lo, hi);
      const pb = binCounts(pool.map((m) => value(m, f)).filter((x) => typeof x === 'number'));
      bars.forEach((bar, i) => bar.style.setProperty('--p', pb[i] / maxBin));
      el.classList.toggle('on', v != null);
    },
  };
}

function boolControl(f) {
  const el = document.createElement('fieldset');
  el.className = 'fc fc-bool';
  const name = fid(f);
  el.innerHTML = `<legend class="fc-l">${esc(f.label)}</legend>
    <div class="seg3">${[['any', 'Any'], ['1', 'Yes'], ['0', 'No']]
      .map(([v, t]) => `<label><input type="radio" name="${name}" value="${v}"><span>${t}<em></em></span></label>`)
      .join('')}</div>`;
  el.addEventListener('change', (e) => {
    const v = e.target.value;
    store.setFilter(f.path, v === 'any' ? null : v === '1');
  });
  const radios = [...el.querySelectorAll('input')];
  return {
    f,
    el,
    update(v, pool) {
      const c = facets(cat, f, pool);
      const cur = v == null ? 'any' : v ? '1' : '0';
      for (const r of radios) {
        r.checked = r.value === cur;
        r.nextElementSibling.querySelector('em').textContent = r.value === 'any' ? pool.length : r.value === '1' ? c.true : c.false;
      }
      el.classList.toggle('on', v != null);
    },
  };
}

// ---------- comparison sheet ----------

let cmpSig = '';
let focusAddAfterRender = false;

function renderCompare(state) {
  const ms = state.compare.map((id) => cat.machine(id)).filter(Boolean);
  const sig = `${ms.map((m) => m.id).join(',')}|${diffOnly}|${mqMobile.matches}`;
  if (sig === cmpSig) return;
  cmpSig = sig;
  const refocus = focusAddAfterRender || document.activeElement?.id === 'add-q';
  focusAddAfterRender = false;
  comboClose();
  const slot = ms.length < MAX_COMPARE;
  const cols = 1 + ms.length + (slot ? 1 : 0);
  const keyed = ms.map((m, i) => ({ m, key: KEYS[i], style: STYLES[i] }));
  const ctx = { keyed, ms, slot, cols, hidden: 0 };
  const body = ms.length ? envelopeBlock(ctx) + sectionsHTML(ctx) : emptySheet(ctx); // fills ctx.hidden
  els.compare.innerHTML = sheetBar(ctx) + sheetTable(ctx, body);
  if (refocus) $('#add-q')?.focus();
  const sc = $('#sheet-scroll');
  sc.addEventListener('scroll', () => requestAnimationFrame(paintPager), { passive: true });
  paintPager();
}

function sheetBar({ ms, hidden }) {
  const few = ms.length < 2;
  return `<div class="sheet-bar">
    <button class="btn ghost" type="button" data-close-compare>${icon('arrow-left', { size: 16 })}<span>Catalog</span></button>
    <div class="sheet-t">
      <p class="eyebrow">Sheet 02 · Comparison${ms.length ? ` · ${ms.map((_, i) => KEYS[i]).join(' / ')}` : ''}</p>
      <h1 id="h-compare" tabindex="-1">${ms.length ? esc(ms.map((m) => m.name).join(' vs ')) : 'Comparison sheet'}</h1>
    </div>
    <div class="sheet-tools">
      <label class="switch${few ? ' off' : ''}"><input type="checkbox" id="diff"${diffOnly ? ' checked' : ''}${few ? ' disabled' : ''}><span class="sw" aria-hidden="true"></span><span>Differences<span class="wide-only"> only</span></span></label>
      ${diffOnly && hidden ? `<span class="hidden-n">${hidden} identical row${hidden === 1 ? '' : 's'} hidden</span>` : ''}
      <button class="btn ghost" type="button" data-clear-compare aria-label="Clear comparison"${ms.length ? '' : ' disabled'}>${icon('trash-2', { size: 16 })}<span>Clear</span></button>
    </div>
  </div>`;
}

function sheetTable({ ms, keyed, slot, cols }, body) {
  const names = ms.map((m) => m.name).join(', ');
  return `<div class="sheet-scroll" id="sheet-scroll">
    <table class="sheet n${ms.length}${slot ? ' has-add' : ''}" style="--cols:${cols - 1}">
      <caption class="sr">Specification comparison${names ? ` of ${esc(names)}` : ''}</caption>
      <colgroup><col class="c-lab">${keyed.map(() => '<col class="c-m">').join('')}${slot ? '<col class="c-m c-add">' : ''}</colgroup>
      <thead><tr><td class="corner"><span class="corner-t">Spec</span><span class="corner-n">${ms.length} / ${MAX_COMPARE}</span>${pager(keyed, slot)}<span class="corner-legend">${icon('check', { size: 12, cls: 'tick' })} best value</span></td>${keyed.map(headCell).join('')}${slot ? addCell(ms) : ''}</tr></thead>
      ${body}
    </table>
  </div>`;
}

// Mobile only: jump buttons for the horizontally snapped machine columns.
function pager(keyed, slot) {
  if (!keyed.length) return '';
  const b = keyed.map(({ m, key, style }, i) => `<button type="button" class="pg ${style}" data-jump="${i}" aria-label="Scroll to ${esc(m.name)}">${key}</button>`);
  if (slot) b.push(`<button type="button" class="pg pg-add" data-jump="${keyed.length}" aria-label="Scroll to add machine">${icon('plus', { size: 12 })}</button>`);
  return `<span class="pager" role="group" aria-label="Machine columns">${b.join('')}</span>`;
}

function jumpTo(i) {
  const sc = $('#sheet-scroll');
  const th = sc?.querySelectorAll('thead th')[i];
  if (!th) return;
  const lab = sc.querySelector('thead .corner').offsetWidth;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  sc.scrollTo({ left: th.offsetLeft - lab, behavior: smooth ? 'smooth' : 'auto' });
}

function paintPager() {
  const sc = $('#sheet-scroll');
  if (!sc || !mqMobile.matches) return;
  const lab = sc.querySelector('thead .corner')?.offsetWidth ?? 0;
  const ths = sc.querySelectorAll('thead th');
  sc.querySelectorAll('.pg').forEach((b, i) => {
    const th = ths[i];
    const x = th.offsetLeft - sc.scrollLeft;
    b.classList.toggle('on', x >= lab - 8 && x + th.offsetWidth <= sc.clientWidth + 8);
  });
}

function headCell({ m, key, style }) {
  const site = get(m, 'media.website');
  return `<th class="mh" scope="col">
    <div class="mh-in">
      <div class="mh-top"><span class="key ${style}">${key}</span>${swatch(style)}<button type="button" class="icon-btn sm mh-x" data-rm="${esc(m.id)}" aria-label="Remove ${esc(m.name)} from comparison" title="Remove">${icon('x', { size: 16 })}</button></div>
      <div class="mh-body">
        ${media(m.image_url, m.name, 'mh-img', false)}
        <div class="mh-t"><span class="mh-co">${esc(m.company)}</span><span class="mh-name">${esc(m.name)}</span><span class="mh-price">${priceBlock(m)}</span></div>
      </div>
      <div class="mh-foot">${stageBadge(m)}${site ? `<a class="lnk" href="${esc(site)}" target="_blank" rel="noopener">Website${icon('arrow-up-right', { size: 14 })}<span class="sr"> of ${esc(m.name)} (opens in new tab)</span></a>` : ''}</div>
    </div>
  </th>`;
}

function addCell(ms) {
  const free = MAX_COMPARE - ms.length;
  return `<th class="mh add" scope="col">
    <div class="add-in">
      <label class="add-l" for="add-q">${icon('plus', { size: 16 })}<span>Add machine</span></label>
      <div class="combo">
        ${icon('search', { size: 16, cls: 'combo-i' })}
        <input id="add-q" type="text" role="combobox" aria-expanded="false" aria-controls="add-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search…">
      </div>
      <p class="add-hint">Slot ${KEYS[ms.length]} · ${free} of ${MAX_COMPARE} free</p>
    </div>
  </th>`;
}

const secHead = (ctx, no, ic, title, extra = '') =>
  `<tr class="sec"><th colspan="${ctx.cols}" scope="colgroup"><span class="sec-in">${icon(ic ?? 'info', { size: 16 })}<span class="sec-no">${pad(no)}</span><span class="sec-t">${esc(title)}</span>${extra}</span></th></tr>`;

const addTd = (ctx) => (ctx.slot ? '<td class="addcol" aria-hidden="true"></td>' : '');

function envVolume(m) {
  const e = envelope(m);
  if (e.kind === 'box' && e.x && e.y && e.z) return (e.x * e.y * e.z) / 1e6;
  if (e.kind === 'lathe' && e.L && e.D) return (Math.PI * (e.D / 2) ** 2 * e.L) / 1e6;
  return null;
}

function envText(m) {
  const e = envelope(m);
  if (e.kind === 'none') return 'not published';
  return workArea(m);
}

function envelopeBlock(ctx) {
  const ov = overlay(
    ctx.keyed,
    mqMobile.matches ? { maxW: Math.min(560, (innerWidth - 24) / 0.94), maxH: 300, k: 0.94 } : { maxW: 540, maxH: 260, k: 1.08 },
  );
  const vols = ctx.keyed.map(({ m }) => envVolume(m));
  const vmax = Math.max(0, ...vols.filter((v) => v != null));
  const legend = ctx.keyed
    .map(({ m, key, style }, i) => {
      const v = vols[i];
      return `<li class="lg"><span class="key ${style}">${key}</span>${swatch(style)}<span class="lg-n">${esc(m.name)}</span><span class="lg-d">${esc(envText(m))}</span><span class="lg-v">${v == null ? '<span class="nil">—</span>' : `${nf.format(Math.round(v * 10) / 10)} L`}</span><span class="meter"><i style="width:${v == null || !vmax ? 0 : Math.max(2, (v / vmax) * 100)}%"></i></span></li>`;
    })
    .join('');
  const views = ov
    ? `${ov.top ? `<figure class="ev ev-top"><figcaption><span>Top view</span><span>X × Y</span></figcaption>${ov.top}</figure>` : ''}${ov.front ? `<figure class="ev ev-front"><figcaption><span>Front view</span><span>X × Z</span></figcaption>${ov.front}</figure>` : ''}`
    : `<p class="env-na">None of these machines publishes its working envelope yet.</p>`;
  return `<tbody class="env-b">${secHead(ctx, 1, 'axis-3d', 'Work envelope', `<span class="sec-sub">to scale · mm</span>${projectionSymbol}`)}
    <tr class="env-row"><td colspan="${ctx.cols}"><div class="env-in">${views}
      <div class="env-side"><p class="env-cap">Legend · envelope volume</p><ol class="legend">${legend}</ol>
      <p class="env-note">All views share one scale; origin at the machine’s home corner. Lathes project as turning length × swing Ø.</p></div>
    </div></td></tr></tbody>`;
}

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const NA_CELL = `<td class="na"><span class="nil" title="Not specified">—</span><span class="sr">not specified</span></td>`;
const boolCell = (v) => `<td class="bool ${v ? 'yes' : 'no'}">${v ? icon('check', { size: 16, label: 'Yes' }) : icon('x', { size: 16, label: 'No' })}</td>`;

// Numbers: formatted value, EUR hint for foreign prices, bar relative to the row maximum, winner tick.
function numCell(f, m, { win, max, bars }) {
  const v = value(m, f);
  const w = win.has(m.id);
  const eur = f.unit === 'price' && m.currency && m.currency !== 'EUR' ? `<span class="eur">≈ ${esc(formatPrice(v, 'EUR'))}</span>` : '';
  const meter = bars ? `<span class="meter" aria-hidden="true"><i style="width:${Math.max(1.5, (v / max) * 100)}%"></i></span>` : '';
  return `<td class="num${w ? ' win' : ''}"><span class="v">${esc(cat.format(m, f.path))}${w ? icon('check', { size: 14, cls: 'tick', label: 'best' }) : ''}</span>${eur}${meter}</td>`;
}

function textCell(f, m) {
  const text = cat.format(m, f.path);
  if (f.path !== 'notes') return `<td class="txt">${esc(text)}</td>`;
  if (text.length <= 260) return `<td class="txt note">${esc(text)}</td>`;
  return `<td class="txt note long"><div class="note-t">${esc(text)}</div><button type="button" class="note-more" data-note aria-expanded="false">Read full note</button></td>`;
}

function cellValue(f, m, meter) {
  const raw = get(m, f.path);
  if (isEmpty(raw)) return NA_CELL;
  if (typeof raw === 'boolean') return boolCell(raw);
  if (f.path === 'stage') return `<td>${stageBadge(m)}</td>`;
  return typeof raw === 'number' ? numCell(f, m, meter) : textCell(f, m);
}

function fieldRow(f, ctx) {
  const win = best(f, ctx.ms);
  const nums = ctx.ms.map((m) => value(m, f)).filter((v) => typeof v === 'number');
  const max = Math.max(0, ...nums);
  const meter = { win, max, bars: nums.length > 1 && max > 0 && new Set(nums).size > 1 }; // meters only when they say something
  const unit = f.unit && f.unit !== 'price' ? `<span class="unit">${esc(f.unit)}</span>` : '';
  const hint = f.better ? `<span class="better">${icon(f.better === 'higher' ? 'chevron-up' : 'chevron-down', { size: 12 })}${f.better} is better</span>` : '';
  return `<tr class="${ctx.ms.length > 1 && !differs(f, ctx.ms) ? 'same' : ''}"><th scope="row"><span class="rl">${esc(f.label)}</span>${unit || hint ? `<span class="rmeta">${unit}${hint}</span>` : ''}</th>${ctx.ms
    .map((m) => cellValue(f, m, meter))
    .join('')}${addTd(ctx)}</tr>`;
}

const LINK_ICON = { website: 'external-link', youtube: 'circle-play', discord: 'message-circle' };
function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'Link'; }
}

function linkRow(f, ctx) {
  const cells = ctx.ms.map((m) => {
    const urls = [].concat(get(m, f.path) ?? []).filter(Boolean);
    if (!urls.length) return NA_CELL;
    const btns = urls.map((u, i) => {
      const text = f.type === 'urls' ? `${f.label.replace(/s$/, '')} ${i + 1}` : f.key === 'website' ? host(u) : f.label;
      return `<a class="lbtn" href="${esc(u)}" target="_blank" rel="noopener">${icon(LINK_ICON[f.key] ?? 'link', { size: 14 })}<span>${esc(text)}</span><span class="sr"> for ${esc(m.name)} (opens in new tab)</span></a>`;
    });
    return `<td class="links">${btns.join('')}</td>`;
  });
  return `<tr><th scope="row"><span class="rl">${esc(f.label)}</span></th>${cells.join('')}${addTd(ctx)}</tr>`;
}

const ACC_VISIBLE = 3;

function accessoriesRow(ctx) {
  const cells = ctx.ms.map((m) => {
    const acc = m.accessories ?? [];
    if (!acc.length) return `<td class="na acc"><span class="nil">None listed</span></td>`;
    const item = (a) => `<li class="acc-item">
        ${media(a.image_url, '', 'acc-img')}
        <div class="acc-t">
          <h4>${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}<span class="sr"> (opens in new tab)</span></a>` : esc(a.name)}</h4>
          <span class="acc-p">${a.price == null ? '<span class="nil">price n/a</span>' : esc(formatPrice(a.price, m.currency ?? 'EUR'))}</span>
          ${a.description ? `<p>${esc(a.description)}</p>` : ''}
        </div>
        ${a.url ? `<span class="acc-go" aria-hidden="true">${icon('arrow-up-right', { size: 14 })}</span>` : ''}
      </li>`;
    const head = acc.slice(0, ACC_VISIBLE).map(item).join('');
    const rest = acc.slice(ACC_VISIBLE);
    return `<td class="acc"><ul class="acc-list">${head}</ul>${rest.length ? `<details class="acc-more"><summary>${icon('plus', { size: 12 })}<span>${rest.length} more add-on${rest.length === 1 ? '' : 's'}</span></summary><ul class="acc-list">${rest.map(item).join('')}</ul></details>` : ''}</td>`;
  });
  const n = ctx.ms.reduce((s, m) => s + (m.accessories?.length ?? 0), 0);
  return `<tr class="acc-row"><th scope="row"><span class="rl">Add-ons</span><span class="rmeta"><span class="unit">${n} item${n === 1 ? '' : 's'}</span></span></th>${cells.join('')}${addTd(ctx)}</tr>`;
}

function sectionsHTML(ctx) {
  let no = 1;
  const diff = diffOnly && ctx.ms.length > 1;
  return cat.sections
    .map((sec) => {
      let rows = '';
      if (sec.kind === 'fields') {
        const fields = sec.fields.filter((f) => f.row && hasData(f, ctx.ms));
        const shown = diff ? fields.filter((f) => differs(f, ctx.ms)) : fields;
        ctx.hidden += fields.length - shown.length;
        rows = shown.map((f) => fieldRow(f, ctx)).join('');
      } else if (sec.kind === 'links') {
        rows = sec.fields.filter((f) => hasData(f, ctx.ms) && ctx.ms.some((m) => [].concat(get(m, f.path) ?? []).length)).map((f) => linkRow(f, ctx)).join('');
      } else if (sec.kind === 'list') {
        if (ctx.ms.some((m) => m.accessories?.length)) rows = accessoriesRow(ctx);
      }
      if (!rows) return '';
      no++;
      return `<tbody class="sec-b">${secHead(ctx, no, sec.icon, sec.title)}${rows}</tbody>`;
    })
    .join('');
}

function emptySheet(ctx) {
  return `<tbody><tr><td colspan="${ctx.cols}" class="cmp-empty"><div class="state">
    <svg class="state-art" viewBox="0 0 160 100" aria-hidden="true"><path class="hid" d="M20 20h50v60H20zM90 20h50v60H90z"/><path class="plus" d="M45 42v16M37 50h16M115 42v16M107 50h16"/></svg>
    <p class="eyebrow">Sheet empty</p>
    <h2>Nothing to compare yet</h2>
    <p class="state-msg">Use <b>Add machine</b> above, or pick machines from the catalog with the compare button on each card.</p>
    <button class="btn primary" type="button" data-close-compare>${icon('layout-grid', { size: 16 })} Browse catalog</button>
  </div></td></tr></tbody>`;
}

// ---------- add-machine combobox ----------

let comboItems = [];
let comboActive = -1;

function comboOpen() {
  const input = $('#add-q');
  if (!input) return comboClose();
  const st = store.get();
  comboItems = filterMachines(cat, { q: input.value, sort: 'name' }).filter((m) => !st.compare.includes(m.id));
  if (comboActive >= comboItems.length) comboActive = comboItems.length - 1;
  els.list.innerHTML = comboItems.length
    ? comboItems
        .map((m, i) => `<li role="option" id="opt-${esc(m.id)}" data-id="${esc(m.id)}" aria-selected="${i === comboActive}">${media(m.image_url, '', 'o-img', false)}<span class="o-t"><span class="o-n">${esc(m.name)}</span><span class="o-c">${esc(m.company)} · ${esc(formatPrice(m.price, m.currency ?? 'EUR'))}</span></span>${m.stage && m.stage !== 'available' ? stageBadge(m) : ''}</li>`)
        .join('')
    : `<li class="o-empty" role="option" aria-disabled="true" aria-selected="false">No machine matches “${esc(input.value)}”</li>`;
  els.list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  const act = comboActive >= 0 ? comboItems[comboActive] : null;
  if (act) input.setAttribute('aria-activedescendant', `opt-${act.id}`);
  else input.removeAttribute('aria-activedescendant');
  comboPosition();
  els.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function comboClose() {
  els.list.hidden = true;
  comboActive = -1;
  const input = $('#add-q');
  if (input) {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
}

function comboPosition() {
  const box = $('#add-q')?.closest('.combo');
  if (!box || els.list.hidden) return;
  const r = box.getBoundingClientRect();
  const w = Math.min(Math.max(r.width, 320), innerWidth - 16);
  const left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  const below = innerHeight - r.bottom - 12;
  const up = below < 220 && r.top > below;
  els.list.style.width = `${w}px`;
  els.list.style.left = `${left}px`;
  els.list.style.maxHeight = `${Math.min(380, up ? r.top - 16 : below)}px`;
  els.list.style.top = up ? '' : `${r.bottom + 4}px`;
  els.list.style.bottom = up ? `${innerHeight - r.top + 4}px` : '';
}

function comboPick(id) {
  if (!id) return;
  focusAddAfterRender = true;
  comboClose();
  const ok = store.addCompare(id);
  if (!ok) focusAddAfterRender = false;
  const m = cat.machine(id);
  announce(`${m?.name} added to comparison`);
}

function announce(msg) {
  let live = $('#live');
  if (!live) {
    live = document.createElement('div');
    live.id = 'live';
    live.className = 'sr';
    live.setAttribute('aria-live', 'polite');
    document.body.append(live);
  }
  live.textContent = msg;
}

// ---------- global events ----------

function openDrawer() {
  els.drawerBody.append(els.panel);
  els.drawer.showModal();
}

function toggleNote(t) {
  const tr = t.closest('tr');
  const open = tr.classList.toggle('open');
  tr.querySelectorAll('[data-note]').forEach((b) => {
    b.setAttribute('aria-expanded', String(open));
    b.textContent = open ? 'Show less' : 'Read full note';
  });
}

// Delegated click actions, keyed by the data-* attribute on the clicked control.
const ACTIONS = {
  cmp(t) {
    returnFocusId = t.dataset.cmp;
    store.openCompare(t.dataset.cmp);
  },
  rm(t) {
    const inSheet = t.closest('.mh');
    store.removeCompare(t.dataset.rm);
    if (inSheet) $('#h-compare')?.focus({ preventScroll: true });
  },
  rmFilter: (t) => store.setFilter(t.dataset.rmFilter, null),
  rmQ: () => store.set({ q: '' }),
  clear: () => store.clearFilters(),
  openCompare: () => store.openCompare(),
  closeCompare: () => store.closeCompare(),
  clearCompare: () => store.set({ compare: [] }),
  openDrawer: () => openDrawer(),
  closeDrawer: () => els.drawer.close(),
  id: (t) => t.matches('li[role=option]') && comboPick(t.dataset.id),
  jump: (t) => jumpTo(+t.dataset.jump),
  note: toggleNote,
};

function comboMove(delta) {
  if (els.list.hidden) comboOpen(); // opens and moves in one keypress
  const n = comboItems.length;
  if (!n) return;
  comboActive = comboActive < 0 ? (delta > 0 ? 0 : n - 1) : (comboActive + delta + n) % n;
  comboOpen();
}

// Combobox keys; a handler returning false lets the browser keep the default behaviour.
const COMBO_KEYS = {
  ArrowDown: () => comboMove(1),
  ArrowUp: () => comboMove(-1),
  Enter() {
    const m = comboItems[comboActive] ?? (comboItems.length === 1 ? comboItems[0] : null);
    if (m) comboPick(m.id);
  },
  Escape(e) {
    if (els.list.hidden) return false;
    e.stopPropagation();
    comboClose();
  },
};

function bindGlobal() {
  const setQ = throttle((q) => {
    const st = store.get();
    if (st.view === 'compare') store.set({ q, view: 'grid' }, { push: true });
    else store.set({ q });
  }, 120);
  els.q.addEventListener('input', () => setQ(els.q.value));
  els.q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.q.value) {
      e.preventDefault();
      els.q.value = '';
      setQ('');
    }
    if (e.key === 'Enter') setQ.flush();
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a, li[role=option]');
    const key = t && Object.keys(ACTIONS).find((k) => k in t.dataset);
    if (key) ACTIONS[key](t);
  });

  els.list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input

  els.compare.addEventListener('change', (e) => {
    if (e.target.id === 'diff') {
      diffOnly = e.target.checked;
      prefs.set('bp-diff', diffOnly ? '1' : '0');
      cmpSig = '';
      renderCompare(store.get());
      $('#diff')?.focus();
    }
  });
  els.compare.addEventListener('focusin', (e) => {
    if (e.target.id === 'add-q') comboOpen();
  });
  els.compare.addEventListener('focusout', (e) => {
    if (e.target.id === 'add-q') setTimeout(() => document.activeElement?.id !== 'add-q' && comboClose(), 0);
  });
  els.compare.addEventListener('input', (e) => {
    if (e.target.id === 'add-q') {
      comboActive = e.target.value ? 0 : -1;
      comboOpen();
    }
  });
  els.compare.addEventListener('keydown', (e) => {
    const fn = e.target.id === 'add-q' && COMBO_KEYS[e.key];
    if (fn && fn(e) !== false) e.preventDefault();
  });
  addEventListener('resize', comboPosition);
  document.addEventListener('scroll', comboPosition, { capture: true, passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !isTyping(e.target) && !els.drawer.open) {
      e.preventDefault();
      els.q.focus();
      els.q.select();
    } else if (e.key === 'Escape' && !els.drawer.open && !isTyping(e.target) && store.get().view === 'compare') {
      store.closeCompare();
    }
  });

  els.drawer.addEventListener('close', () => els.sidebar.append(els.panel));
  els.drawer.addEventListener('click', (e) => {
    if (e.target === els.drawer) els.drawer.close();
  });
  mqMobile.addEventListener('change', () => {
    if (!mqMobile.matches && els.drawer.open) els.drawer.close();
    cmpSig = '';
    render(store.get());
  });
}

// ---------- boot (last, so every module-level binding above is initialised) ----------

initTheme();
try {
  cat = await loadCatalog();
} catch (err) {
  showError(err);
}
if (cat) start();
