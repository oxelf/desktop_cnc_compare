// Aurora: boot, machine grid, command bar, active filters, compare tray and view switching.
import { createStore, filterMachines, formatPrice, formatValue, get, loadCatalog, MAX_COMPARE, priceEUR, workArea } from '../core/core.js';
import { icon } from '../core/icons.js';
import { initCompare } from './compare.js';
import { formatBound, initFilters } from './filters.js';
import { $, esc, hydrateIcons, MOD, productImage, stageBadge, toast, transition, watchImages } from './ui.js';

const BASE_TITLE = document.title;
const grid = $('#results');
const search = $('#q');

let cat;
let store;
let filters;
let compare;
let diffOnly = false;
let prev = null;
let pendingAnim = null; // set right before a store change that deserves a view transition
let lastOpened = null; // card that opened the comparison, focus returns there

watchImages();
hydrateIcons();
$('#kbd-hint').textContent = MOD === '⌘' ? '⌘K' : 'Ctrl K';
$('#palette-mod').textContent = MOD;
boot();

// ---------- boot ----------

async function boot() {
  grid.setAttribute('aria-busy', 'true');
  try {
    cat = await loadCatalog();
  } catch (err) {
    showError(err);
    return;
  }
  if (!cat.machines.length) {
    showError(new Error('The catalog is empty.'));
    return;
  }
  diffOnly = diffInHash();
  // Registered before createStore so it runs before the store re-renders on back/forward.
  addEventListener('hashchange', () => {
    diffOnly = diffInHash();
  });
  store = createStore(cat);
  filters = initFilters(cat, store);
  compare = initCompare(cat, store, {
    getDiff: () => diffOnly,
    setDiff: (v) => {
      diffOnly = v;
      syncDiffParam();
    },
  });
  setupControls();
  for (const el of document.querySelectorAll('.commandbar :disabled')) el.disabled = false;
  store.subscribe(syncDiffParam);
  store.subscribe(render);
  render(store.get());
}

function showError(err) {
  grid.setAttribute('aria-busy', 'false');
  grid.innerHTML = `<div class="state-card is-error" role="alert">
      <span class="state-icon">${icon('cloud-off', { size: 26 })}</span>
      <h2>Couldn’t load the catalog</h2>
      <p>${esc(err?.message ?? 'Unknown error')}. Check your connection and try again.</p>
      <div class="state-actions"><button type="button" class="btn btn-primary" id="retry">${icon('refresh-cw', { size: 16 })}<span>Try again</span></button></div>
    </div>`;
  $('#stat-line').textContent = 'Catalog unavailable';
  $('#retry').addEventListener('click', () => {
    grid.innerHTML = '<div class="card skeleton" aria-hidden="true"><i></i><i></i><i></i></div>'.repeat(8);
    boot();
  });
}

// "diff=1" lives next to the store's hash keys; the store drops unknown keys, so re-add it.
const diffInHash = () => new URLSearchParams(location.hash.slice(1)).get('diff') === '1';

function syncDiffParam() {
  const p = new URLSearchParams(location.hash.slice(1));
  const want = diffOnly && store.get().view === 'compare';
  if (want === (p.get('diff') === '1')) return;
  if (want) p.set('diff', '1');
  else p.delete('diff');
  const hash = p.toString();
  history.replaceState(history.state, '', hash ? `#${hash}` : location.pathname + location.search);
}

// ---------- render ----------

function render(state) {
  const p = prev;
  prev = state;
  const viewChanged = p != null && p.view !== state.view;
  const anim = pendingAnim;
  pendingAnim = null;
  const results = filterMachines(cat, state);
  const apply = () => {
    renderGrid(results, state);
    renderToolbar(results, state);
    renderTray(state);
    setView(state, viewChanged);
    compare.update(state);
    filters.update(state);
  };
  if (viewChanged || anim) animate(apply, { toCompare: state.view === 'compare', viewChanged, ...anim });
  else apply();
}

function animate(apply, { toCompare, viewChanged, morph, grid: gridAnim }) {
  const root = document.documentElement;
  let src = morph && toCompare ? cardFor(cat.machine(morph))?.querySelector('.pool') : null;
  if (src && !inViewport(src)) src = null;
  if (src) src.style.viewTransitionName = 'morph';
  let dst = null;
  root.dataset.vt = viewChanged ? (toCompare ? 'open' : 'close') : 'grid';
  if (gridAnim) grid.classList.add('vt');
  const vt = transition(() => {
    if (src) src.style.viewTransitionName = '';
    apply();
    if (src) {
      dst = compare.mediaFor(morph);
      if (dst) dst.style.viewTransitionName = 'morph';
    }
  });
  const cleanup = () => {
    grid.classList.remove('vt');
    delete root.dataset.vt;
    if (dst) dst.style.viewTransitionName = '';
  };
  if (vt) vt.finished.finally(cleanup);
  else cleanup();
}

function inViewport(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight;
}

function setView(state, changed) {
  const isCompare = state.view === 'compare';
  document.documentElement.classList.toggle('is-compare', isCompare);
  $('#compare-view').hidden = !isCompare;
  $('#grid-view').inert = isCompare;
  if (!isCompare) document.title = BASE_TITLE;
  if (!changed) return;
  if (isCompare) {
    const v = $('#compare-view');
    v.scrollTop = 0;
    v.scrollLeft = 0;
    $('#cmp-back').focus({ preventScroll: true });
  } else {
    const card = lastOpened && grid.querySelector(`.card[data-id="${CSS.escape(lastOpened)}"] .cmp-btn`);
    (card ?? search).focus({ preventScroll: true });
  }
}

// ---------- grid ----------

const cards = new Map();
let lastOrder = null;
let entered = false;

function cardFor(m) {
  if (!m) return null;
  if (!cards.has(m.id)) cards.set(m.id, buildCard(m));
  return cards.get(m.id);
}

const nil = (text) => (text === '—' ? '<span class="nil" aria-label="No data">—</span>' : esc(text));

function buildCard(m) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = m.id;
  el.style.setProperty('--vtn', `c-${m.id.replace(/[^a-z0-9_-]/gi, '_')}`);
  el.setAttribute('aria-labelledby', `n-${m.id}`);
  const axes = get(m, 'general.axis');
  const power = get(m, 'spindle.power');
  const currency = m.currency ?? 'EUR';
  const approx = m.price != null && currency !== 'EUR' ? `<span class="approx">≈ ${esc(formatPrice(priceEUR(m), 'EUR'))}</span>` : '';
  const price =
    m.price == null ? '<span class="price-tba">Price not announced</span>' : `<span class="price">${esc(formatPrice(m.price, currency))}</span>${approx}`;
  el.innerHTML = `
    <div class="card-media">
      ${productImage(m)}
      <div class="card-badges">${stageBadge(cat, m)}</div>
      ${axes != null ? `<span class="axes">${icon('axis-3d', { size: 13 })}<span>${esc(axes)}-axis</span></span>` : ''}
    </div>
    <button type="button" class="cmp-btn" data-compare="${esc(m.id)}" aria-pressed="false" aria-label="Compare ${esc(m.name)}">
      <span class="cmp-ico">${icon('git-compare-arrows', { size: 16 })}</span><span class="cmp-txt">Compare</span>
    </button>
    <div class="card-body">
      <p class="card-maker">${esc(m.company)}</p>
      <h3 class="card-name" id="n-${esc(m.id)}">${esc(m.name)}</h3>
      <p class="card-price">${price}</p>
      <dl class="card-stats">
        <div><dt>Working area</dt><dd>${nil(workArea(m))}</dd></div>
        <div><dt>Spindle</dt><dd>${nil(power == null ? '—' : formatValue(cat.field('spindle.power'), power))}</dd></div>
      </dl>
    </div>`;
  return el;
}

function setSelected(el, on) {
  if (el.classList.contains('is-selected') === on && el.dataset.sel) return;
  el.dataset.sel = '1';
  el.classList.toggle('is-selected', on);
  const b = el.querySelector('.cmp-btn');
  b.setAttribute('aria-pressed', String(on));
  b.querySelector('.cmp-ico').innerHTML = icon(on ? 'check' : 'git-compare-arrows', { size: 16 });
  b.querySelector('.cmp-txt').textContent = on ? 'Added' : 'Compare';
}

function renderGrid(list, state) {
  grid.setAttribute('aria-busy', 'false');
  if (!list.length) {
    lastOrder = null;
    grid.replaceChildren(emptyState(state));
    return;
  }
  const selected = new Set(state.compare);
  const nodes = list.map((m) => {
    const el = cardFor(m);
    setSelected(el, selected.has(m.id));
    return el;
  });
  const order = list.map((m) => m.id).join(',');
  if (order !== lastOrder) {
    grid.replaceChildren(...nodes);
    lastOrder = order;
  }
  if (!entered) {
    entered = true;
    nodes.forEach((n, i) => n.style.setProperty('--i', Math.min(i, 11)));
    grid.classList.add('is-entering');
    setTimeout(() => grid.classList.remove('is-entering'), 1400);
  }
}

function emptyState(state) {
  const el = document.createElement('div');
  el.className = 'state-card';
  const nf = Object.keys(state.filters).length;
  const why = state.q
    ? `Nothing matches “${esc(state.q)}”${nf ? ` with ${nf} active filter${nf === 1 ? '' : 's'}` : ''}.`
    : 'No machine satisfies all active filters.';
  el.innerHTML = `<span class="state-icon">${icon(state.q ? 'search' : 'filter-x', { size: 26 })}</span>
    <h2>No machines match</h2>
    <p>${why} Try a broader search or loosen a filter.</p>
    <div class="state-actions">
      <button type="button" class="btn btn-primary" data-reset>${icon('refresh-cw', { size: 16 })}<span>Reset search &amp; filters</span></button>
      ${nf ? `<button type="button" class="btn btn-glass" data-open-filters>${icon('sliders-horizontal', { size: 16 })}<span>Adjust filters</span></button>` : ''}
    </div>`;
  return el;
}

// ---------- toolbar ----------

function describe(f, v) {
  if (f.filter === 'multi') return v.map((x) => formatValue(f, x)).join(', ');
  if (f.filter === 'bool') return v ? 'Yes' : 'No';
  const [a, z] = v;
  if (a != null && z != null) return a === z ? formatBound(f, a) : `${formatBound(f, a)} – ${formatBound(f, z)}`;
  return a != null ? `≥ ${formatBound(f, a)}` : `≤ ${formatBound(f, z)}`;
}

function renderToolbar(list, state) {
  const total = cat.machines.length;
  $('#result-count').innerHTML =
    list.length === total ? `<strong>${total}</strong> machines` : `<strong>${list.length}</strong> of ${total} machines`;
  renderChips(state);
  renderSortControl(state.sort);
  if (search.value !== state.q && document.activeElement !== search) search.value = state.q;
  $('.search').classList.toggle('has-value', !!search.value);
}

function renderChips(state) {
  const chips = state.q ? [{ key: 'q', k: 'Search', v: `“${state.q}”` }] : [];
  for (const [path, v] of Object.entries(state.filters)) {
    const f = cat.field(path);
    if (f) chips.push({ key: path, k: f.label, v: describe(f, v) });
  }
  const box = $('#active-chips');
  const hadFocus = box.contains(document.activeElement);
  const clearAll = chips.length ? `<button type="button" class="clear-all" data-clear>${icon('filter-x', { size: 14 })}<span>Clear all</span></button>` : '';
  box.innerHTML =
    chips
      .map(
        (c) => `<span class="fchip"><span class="fchip-k">${esc(c.k)}</span><span class="fchip-v">${esc(c.v)}</span>
          <button type="button" data-unset="${esc(c.key)}" aria-label="Remove ${esc(c.k)} filter ${esc(c.v)}">${icon('x', { size: 12 })}</button></span>`,
      )
      .join('') + clearAll;
  // a removed chip took focus with it: hand it to the next chip, or back to search
  if (hadFocus) (box.querySelector('[data-unset]') ?? search).focus({ preventScroll: true });

  const nf = Object.keys(state.filters).length;
  const badge = $('#filter-count');
  badge.hidden = !nf;
  badge.textContent = nf;
  $('#open-filters').setAttribute('aria-label', nf ? `Filters, ${nf} active` : 'Filters');
}

function renderSortControl(sort) {
  const desc = sort.startsWith('-');
  const f = cat.field(sort.replace(/^-/, '')) ?? cat.field('name');
  $('#sort-field').value = f.path;
  const words = f.type === 'string' ? ['A–Z', 'Z–A'] : ['Low–high', 'High–low'];
  const dir = $('#sort-dir');
  dir.innerHTML = `${icon(desc ? 'chevron-down' : 'chevron-up', { size: 14 })}<span>${words[+desc]}</span>`;
  dir.setAttribute('aria-label', `Sort direction: ${desc ? 'descending' : 'ascending'}. Activate to reverse.`);
}

// ---------- compare tray ----------

let trayKey = null;

function renderTray(state) {
  const tray = $('#tray');
  tray.hidden = !(state.view === 'grid' && state.compare.length);
  const key = state.compare.join(',');
  if (key === trayKey) return;
  trayKey = key;
  const ms = state.compare.map((id) => cat.machine(id)).filter(Boolean);
  const hadFocus = tray.contains(document.activeElement);
  tray.innerHTML = `
    <div class="tray-label"><span class="tray-kicker">Compare</span><span class="tray-count"><strong>${ms.length}</strong>/${MAX_COMPARE}</span></div>
    <ul class="tray-items">${ms
      .map(
        (m) => `<li class="tray-item">${productImage(m, 'pool-tray', { ambient: false })}<span class="tray-name">${esc(m.name)}</span>
          <button type="button" class="tray-x" data-tray-remove="${esc(m.id)}" aria-label="Remove ${esc(m.name)} from comparison">${icon('x', { size: 12 })}</button></li>`,
      )
      .join('')}${'<li class="tray-slot" aria-hidden="true"></li>'.repeat(MAX_COMPARE - ms.length)}</ul>
    <button type="button" class="btn btn-primary tray-go" data-tray-open><span>Compare</span><span class="tray-go-n">${ms.length}</span>${icon('arrow-up-right', { size: 16 })}</button>
    <button type="button" class="icon-btn tray-clear" data-tray-clear aria-label="Clear comparison">${icon('trash-2', { size: 16 })}</button>`;
  if (hadFocus) (tray.querySelector('[data-tray-remove]') ?? search).focus({ preventScroll: true });
}

// ---------- controls ----------

function setupControls() {
  const machines = cat.machines;
  const makers = new Set(machines.map((m) => m.company)).size;
  const latest = machines
    .map((m) => /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(m.last_updated ?? ''))
    .filter(Boolean)
    .map(([, d, mo, y]) => new Date(Date.UTC(+y, +mo - 1, +d)))
    .sort((a, b) => b - a)[0];
  const when = latest
    ? `<span class="hide-sm"> · checked ${latest.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span>`
    : '';
  $('#stat-line').innerHTML = `${machines.length} machines · ${makers} manufacturers${when}`;

  // Sort options grouped by section.
  $('#sort-field').innerHTML = cat.sections
    .map((s) => {
      const opts = s.fields
        .filter((f) => cat.sortFields.includes(f))
        .map((f) => `<option value="${esc(f.path)}">${esc(f.label)}</option>`)
        .join('');
      if (!opts) return '';
      return s.key === 'overview' ? opts : `<optgroup label="${esc(s.title)}">${opts}</optgroup>`;
    })
    .join('');
  $('#sort-field').addEventListener('change', (e) => {
    const f = cat.field(e.target.value);
    pendingAnim = { grid: true };
    store.set({ sort: `${f.better === 'higher' ? '-' : ''}${f.path}` });
  });
  $('#sort-dir').addEventListener('click', () => {
    const s = store.get().sort;
    pendingAnim = { grid: true };
    store.set({ sort: s.startsWith('-') ? s.slice(1) : `-${s}` });
  });

  // Search: instant, no transition while typing.
  search.addEventListener('input', () => store.set({ q: search.value }));
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (search.value) {
      search.value = '';
      store.set({ q: '' });
    } else search.blur();
  });
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'search-clear';
  clear.setAttribute('aria-label', 'Clear search');
  clear.innerHTML = icon('x', { size: 14 });
  clear.addEventListener('click', () => {
    search.value = '';
    store.set({ q: '' });
    search.focus();
  });
  search.after(clear);

  $('#open-filters').addEventListener('click', () => filters.open());

  // Active filter chips.
  $('#active-chips').addEventListener('click', (e) => {
    const unset = e.target.closest('[data-unset]');
    if (unset) {
      pendingAnim = { grid: true };
      if (unset.dataset.unset === 'q') store.set({ q: '' });
      else store.setFilter(unset.dataset.unset, null);
    } else if (e.target.closest('[data-clear]')) {
      pendingAnim = { grid: true };
      store.clearFilters();
      search.focus({ preventScroll: true });
    }
  });

  // Grid: compare buttons, empty-state actions, pointer spotlight.
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-compare]');
    if (b) {
      const id = b.dataset.compare;
      const st = store.get();
      const m = cat.machine(id);
      if (st.compare.includes(id)) {
        store.removeCompare(id);
        toast(`Removed ${m.name} from comparison`, 'minus');
        return;
      }
      const dropped = st.compare.length >= MAX_COMPARE ? cat.machine(st.compare[0]) : null;
      lastOpened = id;
      pendingAnim = { morph: id };
      store.openCompare(id);
      if (dropped) toast(`Up to ${MAX_COMPARE} machines — replaced ${dropped.name}`, 'info');
      return;
    }
    if (e.target.closest('[data-reset]')) {
      pendingAnim = { grid: true };
      store.clearFilters();
      search.focus({ preventScroll: true });
    }
    if (e.target.closest('[data-open-filters]')) filters.open();
  });

  let raf = 0;
  let px = 0;
  let py = 0;
  grid.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    px = e.clientX;
    py = e.clientY;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      for (const c of grid.children) {
        const r = c.getBoundingClientRect();
        c.style.setProperty('--mx', `${px - r.left}px`);
        c.style.setProperty('--my', `${py - r.top}px`);
      }
    });
  });

  // Tray.
  $('#tray').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-tray-remove]');
    if (rm) {
      store.removeCompare(rm.dataset.trayRemove);
      return;
    }
    if (e.target.closest('[data-tray-open]')) {
      lastOpened = null;
      store.openCompare();
    }
    if (e.target.closest('[data-tray-clear]')) {
      store.set({ compare: [] });
      toast('Comparison cleared', 'trash-2');
      search.focus({ preventScroll: true });
    }
  });

  $('#cmp-back').addEventListener('click', () => store.closeCompare());

  // Sticky command bar gets its glass once it leaves the hero.
  const wrap = $('.commandbar-wrap');
  const sentinel = document.createElement('div');
  sentinel.className = 'sentinel';
  wrap.before(sentinel);
  new IntersectionObserver(([en]) => wrap.classList.toggle('is-stuck', !en.isIntersecting)).observe(sentinel);

  addEventListener('keydown', onKey);
}

// ⌘K / Ctrl+K and "/" focus search (or open the add palette in compare); Escape leaves compare.
function onKey(e) {
  if (document.querySelector('dialog[open]')) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') e.preventDefault();
    return;
  }
  const inCompare = store.get().view === 'compare';
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (inCompare) compare.openPalette();
    else focusSearch();
  } else if (e.key === '/' && !inCompare && !isEditable(e.target)) {
    e.preventDefault();
    focusSearch();
  } else if (e.key === 'Escape' && inCompare) {
    e.preventDefault();
    store.closeCompare();
  }
}

const isEditable = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function focusSearch() {
  search.focus();
  search.select();
}
