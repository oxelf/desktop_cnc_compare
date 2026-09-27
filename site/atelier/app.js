// Atelier: editorial design on top of the shared core (site/core). No framework, no build.
import {
  MAX_COMPARE, best, createStore, differs, facets, filterMachines, formatPrice, get, hasData, label, loadCatalog, priceEUR, workArea,
} from '../core/core.js';
import { ICONS, icon } from '../core/icons.js';

// Two Lucide icons (ISC) this design needs that the shared subset lacks; registered locally, core stays untouched.
ICONS['arrow-right'] ??= '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>';
ICONS['rotate-ccw'] ??= '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const ico = (name, size = 18, lbl) => icon(name, { size, label: lbl && esc(lbl) });
const num = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const NA = '<span class="na"><span aria-hidden="true">—</span><span class="sr-only">Not specified</span></span>';

// Tone + icon per availability stage; unknown future stages fall back to a neutral badge.
const STAGE = {
  available: ['ok', 'check'],
  preorder: ['warm', 'calendar'],
  crowdfunding: ['hot', 'sparkles'],
  announced: ['ink', 'calendar'],
  discontinued: ['mute', 'x'],
};

let cat;
let store;
let quick = [];
let lastOpener = null;
let diffOnly = new URLSearchParams(location.search).get('diff') === '1';

// ---------- small helpers ----------

const hydrateIcons = (root = document) => {
  for (const el of $$('[data-icon]', root)) el.innerHTML = ico(el.dataset.icon, 18);
};

// Image frame: the picture is mounted on a tinted backdrop with its own rounded corners, over a blurred,
// multiplied copy of itself. Cut-outs on white melt into the tint; photos read as mounted prints.
function frame(src, cls = '') {
  const url = safeUrl(src);
  const ph = `<span class="ph">${ico('image-off', 22)}<span>No image</span></span>`;
  if (!url) return `<div class="frame ${cls} broken">${ph}</div>`;
  const css = `--img:url(&quot;${esc(url).replace(/[()\\]/g, '\\$&')}&quot;)`;
  return `<div class="frame ${cls}" style="${css}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">${ph}</div>`;
}

// Broken hotlinked images: drop the <img>, the designed placeholder behind it shows.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.parentElement?.classList.contains('frame')) {
    img.parentElement.classList.add('broken');
    img.remove();
  }
}, true);
document.addEventListener('load', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.parentElement?.classList.add('ready');
}, true);

function stageBadge(m) {
  if (!m.stage) return '';
  const [tone, ic] = STAGE[m.stage] ?? ['ink', 'info'];
  return `<span class="stage ${tone}">${ico(ic, 13)}${esc(cat.format(m, 'stage'))}</span>`;
}

const priceText = (m) => (m.price == null ? null : formatPrice(m.price, m.currency ?? 'EUR'));

const fmtVal = (f, v) => (f.unit === 'price' ? formatPrice(v, 'EUR') : `${num.format(v)}${f.unit ? ` ${f.unit}` : ''}`);

function summary(f, v) {
  if (f.filter === 'multi') return v.length === 1 ? label(f, v[0]) : `${v.length} selected`;
  if (f.filter === 'bool') return v ? 'Yes' : 'No';
  const [lo, hi] = v;
  if (lo != null && hi != null) return `${fmtVal(f, lo)} – ${fmtVal(f, hi)}`;
  return lo != null ? `≥ ${fmtVal(f, lo)}` : `≤ ${fmtVal(f, hi)}`;
}

const sectionOf = (f) => cat.sections.find((s) => s.key === f.section);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function parseDate(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s ?? '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

// ---------- filter controls (shared by the side panel and the quick popovers) ----------

// Nice slider step: 1 / 2 / 5 × 10^n, about 200 steps across the range.
function niceStep(span) {
  if (!(span > 0)) return 1;
  const raw = span / 200;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw);
}
const SLIDER = 1000;

function control(f, ctx) {
  const id = `${ctx}-${f.path.replaceAll('.', '-')}`;
  if (f.filter === 'multi') {
    const opts = facets(cat, f);
    return `<fieldset class="fld" data-path="${esc(f.path)}" data-kind="multi">
      <legend class="fld-label">${esc(f.label)}</legend>
      <div class="opts">${opts.map((o, i) => `<label class="opt" for="${id}-${i}"><input type="checkbox" id="${id}-${i}" value="${esc(o.value)}">${ico('check', 14)}<span>${esc(o.label)}</span><span class="n">${o.count}</span></label>`).join('')}</div>
    </fieldset>`;
  }
  if (f.filter === 'bool') {
    const opts = [['any', 'Any'], ['true', 'Yes'], ['false', 'No']];
    return `<fieldset class="fld" data-path="${esc(f.path)}" data-kind="bool">
      <legend class="fld-label">${esc(f.label)}</legend>
      <div class="seg">${opts.map(([v, l]) => `<label><input type="radio" name="${id}" value="${v}">${l}<span class="n"></span></label>`).join('')}</div>
    </fieldset>`;
  }
  const b = facets(cat, f) ?? { min: 0, max: 0 };
  const unit = f.unit === 'price' ? 'EUR' : (f.unit ?? '');
  const step = niceStep(b.max - b.min);
  const flat = b.max <= b.min ? ' disabled' : '';
  return `<div class="fld" role="group" aria-labelledby="${id}-l" data-path="${esc(f.path)}" data-kind="range" data-min="${b.min}" data-max="${b.max}" data-step="${step}">
    <div class="fld-row"><span class="fld-label" id="${id}-l">${esc(f.label)}</span><output class="rng-out" aria-live="off"></output></div>
    <div class="dual">
      <input type="range" class="lo" min="0" max="${SLIDER}" step="1" value="0" aria-label="Minimum ${esc(f.label)}"${flat}>
      <input type="range" class="hi" min="0" max="${SLIDER}" step="1" value="${SLIDER}" aria-label="Maximum ${esc(f.label)}"${flat}>
    </div>
    <div class="range-io">
      <label class="num"><span class="sr-only">Minimum ${esc(f.label)} in ${esc(unit || 'units')}</span><input type="number" class="nlo" inputmode="decimal" step="any" placeholder="${num.format(Math.floor(b.min))}"><span class="u" aria-hidden="true">${esc(unit)}</span></label>
      <span class="dash" aria-hidden="true">–</span>
      <label class="num"><span class="sr-only">Maximum ${esc(f.label)} in ${esc(unit || 'units')}</span><input type="number" class="nhi" inputmode="decimal" step="any" placeholder="${num.format(Math.ceil(b.max))}"><span class="u" aria-hidden="true">${esc(unit)}</span></label>
    </div>
  </div>`;
}

const rangeMeta = (el) => ({ min: +el.dataset.min, max: +el.dataset.max, step: +el.dataset.step });
function fromSlider(el, p) {
  const { min, max, step } = rangeMeta(el);
  const v = Math.round((min + ((max - min) * p) / SLIDER) / step) * step;
  return Math.min(max, Math.max(min, +v.toFixed(6)));
}
function toSlider(el, v) {
  const { min, max } = rangeMeta(el);
  return max > min ? Math.round(((v - min) / (max - min)) * SLIDER) : 0;
}

// Memoised "all active filters except this one" results for contextual facet counts.
let exceptCache = new Map();
function except(path) {
  if (!exceptCache.has(path)) {
    const s = store.get();
    const rest = { ...s.filters };
    delete rest[path];
    exceptCache.set(path, filterMachines(cat, { q: s.q, filters: rest }));
  }
  return exceptCache.get(path);
}

// Update controls in place (no re-render) so focus and slider drags survive state changes.
const setUnlessFocused = (el, value) => {
  if (document.activeElement !== el) el.value = value;
};

function syncMulti(fld, f, v) {
  const counts = new Map(facets(cat, f, except(f.path)).map((o) => [o.value, o.count]));
  for (const input of $$('input', fld)) {
    const on = !!v?.includes(input.value);
    const n = counts.get(input.value) ?? 0;
    input.checked = on;
    input.parentElement.querySelector('.n').textContent = n;
    input.parentElement.classList.toggle('zero', !n && !on);
  }
}

function syncBool(fld, f, v) {
  const c = facets(cat, f, except(f.path));
  const want = v == null ? 'any' : String(v);
  for (const input of $$('input', fld)) {
    input.checked = input.value === want;
    input.parentElement.querySelector('.n').textContent = input.value === 'any' ? '' : c[input.value];
  }
}

function syncRange(fld, f, v) {
  const [lo, hi] = v ?? [null, null];
  const { min, max } = rangeMeta(fld);
  const loI = $('.lo', fld);
  const hiI = $('.hi', fld);
  setUnlessFocused(loI, lo == null ? 0 : toSlider(fld, lo));
  setUnlessFocused(hiI, hi == null ? SLIDER : toSlider(fld, hi));
  paintTrack(fld);
  loI.setAttribute('aria-valuetext', fmtVal(f, lo ?? min));
  hiI.setAttribute('aria-valuetext', fmtVal(f, hi ?? max));
  fld.classList.toggle('on', !!v);
  $('.rng-out', fld).textContent = v ? summary(f, v) : `${fmtVal(f, Math.floor(min))} – ${fmtVal(f, Math.ceil(max))}`;
  setUnlessFocused($('.nlo', fld), lo ?? '');
  setUnlessFocused($('.nhi', fld), hi ?? '');
}

const SYNC = { multi: syncMulti, bool: syncBool, range: syncRange };
function syncControls(root, state) {
  for (const fld of $$('[data-path]', root)) {
    const f = cat.field(fld.dataset.path);
    if (f) SYNC[f.filter]?.(fld, f, state.filters[f.path]);
  }
}

function paintTrack(fld) {
  fld.style.setProperty('--lo', $('.lo', fld).value / SLIDER);
  fld.style.setProperty('--hi', $('.hi', fld).value / SLIDER);
}

const setRange = (f, lo, hi) => store.setFilter(f.path, lo == null && hi == null ? null : [lo, hi]);

function onSlider(fld, f, t) {
  const loI = $('.lo', fld);
  const hiI = $('.hi', fld);
  if (+loI.value > +hiI.value) t.value = t === loI ? hiI.value : loI.value; // thumbs never cross
  paintTrack(fld);
  setRange(f, +loI.value <= 0 ? null : fromSlider(fld, +loI.value), +hiI.value >= SLIDER ? null : fromSlider(fld, +hiI.value));
}

const numTimers = new WeakMap();
function onNumber(fld, f) {
  clearTimeout(numTimers.get(fld));
  const read = (el) => (el.value.trim() === '' || !Number.isFinite(+el.value) ? null : +el.value);
  numTimers.set(fld, setTimeout(() => setRange(f, read($('.nlo', fld)), read($('.nhi', fld))), 280));
}

function onControl(e) {
  const t = e.target;
  const fld = t.closest('[data-path]');
  const f = fld && cat.field(fld.dataset.path);
  if (!f) return;
  if (e.type === 'change' && f.filter === 'multi') {
    const vals = $$('input:checked', fld).map((i) => i.value);
    store.setFilter(f.path, vals.length ? vals : null);
  } else if (e.type === 'change' && f.filter === 'bool') {
    store.setFilter(f.path, t.value === 'any' ? null : t.value === 'true');
  } else if (e.type === 'input' && t.type === 'range') {
    onSlider(fld, f, t);
  } else if (e.type === 'input' && t.type === 'number') {
    onNumber(fld, f);
  }
}

// Quick pills: overview fields, the most informative small-cardinality facets, and the card's range stats.
const CARD_RANGES = new Set(['spindle.power']);
function pickQuick() {
  const total = cat.machines.length || 1;
  // Schema order signals importance: the first spec section after the overview gets a boost.
  const primary = cat.sections.find((sec) => sec.kind === 'fields' && sec.key !== 'overview')?.key;
  const scored = cat.filterFields
    .filter((f) => f.section !== 'overview' && f.filter !== 'range')
    .map((f) => {
      const fac = facets(cat, f);
      const counts = (f.filter === 'bool' ? [fac.true, fac.false] : fac.map((o) => o.count)).filter(Boolean);
      const n = counts.reduce((a, b) => a + b, 0);
      if (counts.length < 2 || counts.length > 8) return null;
      const entropy = -counts.reduce((h, c) => h + (c / n) * Math.log2(c / n), 0) / Math.log2(counts.length);
      return { f, score: (n / total) * entropy * (f.section === primary ? 1.3 : 1) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.f);
  const keep = new Set([...cat.filterFields.filter((f) => f.section === 'overview' || CARD_RANGES.has(f.path)), ...scored]);
  return cat.filterFields.filter((f) => keep.has(f));
}

// ---------- shell ----------

function buildShell() {
  const total = cat.machines.length;
  const makers = new Set(cat.machines.map((m) => m.company)).size;
  const latest = cat.machines.map((m) => parseDate(m.last_updated)).filter(Boolean).sort((a, b) => b - a)[0];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = latest ? `${latest.getDate()} ${MONTHS[latest.getMonth()]} ${latest.getFullYear()}` : null;
  $('#hero-eyebrow').innerHTML = [`${total} machines`, `${makers} ${makers === 1 ? 'maker' : 'makers'}`, when && `<span class="upd">Updated ${when}</span>`].filter(Boolean).join('<span class="dot" aria-hidden="true"> · </span>');

  // Featured tiles: priciest machines with an image, one per maker.
  const seen = new Set();
  const picks = [];
  for (const m of [...cat.machines].filter((x) => safeUrl(x.image_url)).sort((a, b) => (priceEUR(b) ?? 0) - (priceEUR(a) ?? 0))) {
    if (seen.has(m.company)) continue;
    seen.add(m.company);
    picks.push(m);
    if (picks.length === 3) break;
  }
  $('#hero-art').innerHTML = picks.length === 3
    ? picks.map((m, i) => `<button class="tile t${i}" type="button" data-open="${esc(m.id)}" aria-label="Open ${esc(m.name)} in the comparison">
        ${frame(m.image_url)}
        <span class="tile-cap"><span class="tile-name">${esc(m.name)}</span><span class="tile-price">${esc(priceText(m) ?? '')}</span></span>
      </button>`).join('')
    : '';

  // Sort select, grouped by section.
  const groups = cat.sections
    .map((s) => ({ s, fields: cat.sortFields.filter((f) => f.section === s.key) }))
    .filter((g) => g.fields.length);
  $('#sort').innerHTML = groups.map(({ s, fields }) => `<optgroup label="${esc(s.title)}">${fields.map((f) => {
    if (f.path === 'name') return `<option value="name">Name, A–Z</option><option value="-name">Name, Z–A</option>`;
    return `<option value="${esc(f.path)}">${esc(f.label)}, low to high</option><option value="-${esc(f.path)}">${esc(f.label)}, high to low</option>`;
  }).join('')}</optgroup>`).join('');
  $('#sort-wrap').hidden = false;
  $('#open-filters').disabled = false;

  // Quick pills.
  quick = pickQuick();
  $('#pills').innerHTML = quick.map((f) => `<button class="pill" type="button" data-path="${esc(f.path)}" aria-expanded="false" aria-controls="qp" aria-haspopup="true"><span class="pill-t">${esc(f.label)}</span>${icon('chevron-down', { size: 16, cls: 'chev' })}</button>`).join('');

  // All-filters panel, grouped by section with the section icons.
  $('#panel-body').innerHTML = cat.sections
    .map((s) => ({ s, fields: cat.filterFields.filter((f) => f.section === s.key) }))
    .filter((g) => g.fields.length)
    .map(({ s, fields }) => `<section class="fsec" data-sec="${esc(s.key)}">
      <h3 class="fsec-title"><span class="ico">${ico(s.icon ?? 'circle-help', 17)}</span>${esc(s.title)}<span class="fsec-n" hidden></span></h3>
      ${fields.map((f) => control(f, 'pf')).join('')}
    </section>`).join('');
}

// ---------- cards ----------

const cards = new Map();
function stat(ic, name, value, unit) {
  return `<div class="stat"><dt>${ico(ic, 13)}${esc(name)}${unit ? ` <small>${esc(unit)}</small>` : ''}</dt><dd>${value ?? NA}</dd></div>`;
}
function cardEl(m) {
  if (cards.has(m.id)) return cards.get(m.id);
  const li = document.createElement('li');
  const axis = get(m, 'general.axis');
  const type = get(m, 'general.machine_type');
  const kind = [type && type !== 'mill' ? cat.format(m, 'general.machine_type') : null, axis ? `${axis}-axis` : null].filter(Boolean).join(' · ');
  const wa = workArea(m);
  const power = get(m, 'spindle.power');
  li.innerHTML = `<article class="card" data-id="${esc(m.id)}">
    <div class="card-media">
      ${frame(m.image_url)}
      <div class="card-tags">${stageBadge(m)}</div>
      ${kind ? `<span class="kind">${ico('axis-3d', 14)}${esc(kind)}</span>` : ''}
    </div>
    <div class="card-body">
      <p class="eyebrow">${esc(m.company)}</p>
      <h3 class="card-title"><button class="card-open" type="button">${esc(m.name)}</button></h3>
      <p class="in-cmp">${ico('check', 14)}In your comparison</p>
      <dl class="stats">
        ${stat('tag', 'Price', priceText(m) && esc(priceText(m)))}
        ${stat('scan', 'Work area', wa === '—' ? null : esc(wa.replace(/ mm$/, '')), wa === '—' ? '' : 'mm')}
        ${stat('zap', 'Spindle', power == null ? null : esc(cat.format(m, 'spindle.power')))}
      </dl>
    </div>
    <button class="cmp-btn" type="button" data-on="false">${ico('git-compare-arrows', 20)}${ico('check', 20)}</button>
  </article>`;
  cards.set(m.id, li);
  return li;
}
function syncCard(li, m, selected) {
  const card = li.firstElementChild;
  card.classList.toggle('sel', selected);
  const btn = $('.cmp-btn', card);
  btn.dataset.on = String(selected);
  btn.setAttribute('aria-label', selected ? `Remove ${m.name} from comparison` : `Add ${m.name} to comparison`);
  btn.dataset.tip = selected ? 'Remove from comparison' : 'Add to comparison';
}

// ---------- render ----------

let gridSig = '';
const showLabel = (n) => (n ? `Show ${n} ${n === 1 ? 'machine' : 'machines'}` : 'No matches');

function renderHead(state, list, active) {
  const total = cat.machines.length;
  const filtered = active.length > 0 || !!state.q;
  const q = $('#q');
  if (q.value !== state.q && document.activeElement !== q) q.value = state.q; // only when the URL changed underneath
  $('#q-clear').hidden = !q.value;
  $('#sort').value = state.sort;
  if (!$('#sort').value) $('#sort').value = 'name';
  const word = list.length === 1 ? 'machine' : 'machines';
  $('#count').innerHTML = filtered ? `${list.length} ${word} <span class="of">of ${total}</span>` : `${total} ${total === 1 ? 'machine' : 'machines'}`;
  const chip = (key, k, text, lbl) => `<button class="chip-x" type="button" data-clear="${esc(key)}" aria-label="${esc(lbl)}"><span class="k">${esc(k)}</span>${esc(text)}<span class="x">${ico('x', 12)}</span></button>`;
  $('#active').innerHTML = !filtered ? '' : [
    state.q && chip('q', 'Search', `“${state.q}”`, `Remove search ${state.q}`),
    ...active.map(([f, v]) => chip(f.path, f.label, summary(f, v), `Remove filter ${f.label}: ${summary(f, v)}`)),
    '<button class="link-btn" type="button" data-clear="all">Clear all</button>',
  ].filter(Boolean).join('');
}

function renderGrid(state, list, active) {
  const grid = $('#grid');
  const sel = new Set(state.compare);
  const sig = list.map((m) => m.id).join();
  if (sig !== gridSig || grid.getAttribute('aria-busy')) {
    gridSig = sig; // cards are cached; only order / membership / selection change
    grid.replaceChildren(...list.map(cardEl));
    grid.removeAttribute('aria-busy');
  }
  for (const m of list) syncCard(cards.get(m.id), m, sel.has(m.id));
  const box = $('#state');
  box.hidden = list.length > 0;
  if (list.length) return;
  const what = state.q ? `“${esc(state.q)}”${active.length ? ' with these filters' : ''}` : 'these filters';
  box.innerHTML = `<div class="state-icon">${ico('search', 34)}</div>
    <h3>Nothing matches — yet.</h3>
    <p>No machine fits ${what}. Loosen a range or try a broader term.</p>
    <button class="btn accent" type="button" data-clear="all">${ico('filter-x', 18)}Reset search &amp; filters</button>`;
}

function renderFilters(state, list, active) {
  const badge = $('#filter-badge');
  badge.hidden = !active.length;
  badge.textContent = active.length;
  $('#open-filters').setAttribute('aria-label', active.length ? `All filters, ${active.length} active` : 'All filters');
  for (const sec of $$('.fsec')) {
    const n = active.filter(([f]) => f.section === sec.dataset.sec).length;
    const el = $('.fsec-n', sec);
    el.hidden = !n;
    el.textContent = `${n} active`;
  }
  $('#panel-show').textContent = showLabel(list.length);
  for (const pill of $$('#pills .pill')) {
    const f = cat.field(pill.dataset.path);
    const v = state.filters[f.path];
    pill.classList.toggle('on', v != null);
    $('.pill-t', pill).innerHTML = v != null ? `${esc(f.label)}: <span class="pill-val">${esc(summary(f, v))}</span>` : esc(f.label);
  }
  syncControls($('#panel-body'), state);
  if (qpField) syncControls($('#qp'), state);
  const done = $('#qp [data-qp-done]');
  if (done) done.textContent = showLabel(list.length);
}

function render(state) {
  // core's decodeState keeps empty ranges from hand-edited URLs (e.g. f.price=abc..); drop them first.
  const empty = Object.entries(state.filters).find(([, v]) => Array.isArray(v) && v.every((x) => x == null));
  if (empty) {
    store.setFilter(empty[0], null);
    return;
  }
  exceptCache = new Map();
  const list = filterMachines(cat, state);
  const active = Object.entries(state.filters).map(([p, v]) => [cat.field(p), v]).filter(([f]) => f);
  renderHead(state, list, active);
  renderGrid(state, list, active);
  renderFilters(state, list, active);
  renderTray(state);
  renderSheet(state);
}

// ---------- tray ----------

function renderTray(state) {
  const tray = $('#tray');
  const ms = state.compare.map((id) => cat.machine(id)).filter(Boolean);
  const show = ms.length > 0 && state.view !== 'compare';
  tray.hidden = !show;
  if (!show) return;
  tray.innerHTML = `<ul class="tray-thumbs" aria-hidden="true">${ms.map((m) => `<li>${frame(m.image_url, 'xs')}</li>`).join('')}</ul>
    <p class="tray-text"><strong>${ms.length}</strong> of ${MAX_COMPARE} selected</p>
    <button class="tray-go" type="button" data-tray="open">Compare${ico('arrow-right', 16)}</button>
    <button class="tray-x" type="button" data-tray="clear" aria-label="Clear comparison selection">${ico('x', 16)}</button>`;
}

// ---------- comparison sheet ----------

let sheetOpen = false;
let sheetSig = '';
const linkSection = () => cat.sections.find((s) => s.kind === 'links');
const websiteOf = (m) => {
  const f = linkSection()?.fields.find((x) => x.type === 'url');
  return f ? safeUrl(get(m, f.path)) : null;
};

function openCompare(id, opener) {
  const s = store.get();
  lastOpener = opener ?? document.activeElement;
  if (id && !s.compare.includes(id) && s.compare.length >= MAX_COMPARE) {
    toast(`Up to ${MAX_COMPARE} machines — ${cat.machine(s.compare[0]).name} made room.`);
  }
  store.openCompare(id);
}

function openSheet() {
  if ($('#panel').open) $('#panel').close();
  if ($('#qp').matches(':popover-open')) $('#qp').hidePopover();
  sheetSig = '';
  requestAnimationFrame(() => $('#sheet-title').focus({ preventScroll: true }));
}
function closeSheet() {
  // Return focus to whatever opened the comparison, else to the results.
  if (lastOpener?.isConnected && !lastOpener.closest('#sheet')) lastOpener.focus({ preventScroll: true });
  else $('#results').focus({ preventScroll: true });
}

function renderSheet(state) {
  const open = state.view === 'compare';
  if (open !== sheetOpen) {
    sheetOpen = open;
    $('#sheet').hidden = !open;
    document.documentElement.classList.toggle('lock', open);
    for (const el of [$('#topbar'), $('#main'), $('#footer')]) el.inert = open;
    (open ? openSheet : closeSheet)();
  }
  const sig = `${state.compare.join()}|${diffOnly}`;
  if (open && sig !== sheetSig) {
    sheetSig = sig;
    paintCompare(state);
  }
}

function paintCompare(state) {
  const ms = state.compare.map((id) => cat.machine(id)).filter(Boolean);
  const slot = ms.length < MAX_COMPARE;
  const diff = diffOnly && ms.length > 1;
  $('#sheet-count').textContent = ms.length ? `${ms.length} of ${MAX_COMPARE}` : '';
  const diffI = $('#diff');
  diffI.checked = diffOnly;
  diffI.disabled = ms.length < 2;
  $('#diff-wrap').title = ms.length < 2 ? 'Add at least two machines' : '';
  $('#sheet-add').hidden = !slot || !ms.length;

  const pane = $('#pane');
  const refocus = document.activeElement?.id === 'add-input';
  const { scrollTop, scrollLeft } = pane;
  pane.innerHTML = ms.length ? compareTable(ms, slot, diff) : compareEmpty();
  pane.scrollTop = scrollTop;
  pane.scrollLeft = scrollLeft;
  if (refocus) ($('#add-input') ?? $('#sheet-title')).focus();
}

function compareEmpty() {
  return `<div class="cmp-empty">
    <div class="state-icon">${ico('columns-3', 34)}</div>
    <h3>Nothing to compare yet</h3>
    <p>Pick up to ${MAX_COMPARE} machines and see every specification side by side.</p>
    ${combo()}
  </div>`;
}

function combo() {
  return `<div class="combo">
    <label class="eyebrow" for="add-input">Add to comparison</label>
    <div class="combo-field">${ico('search', 17)}<input id="add-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="add-list" autocomplete="off" spellcheck="false" placeholder="Search…"></div>
    <ul class="listbox" id="add-list" role="listbox" aria-label="Machines" hidden></ul>
  </div>`;
}

function headCell(m) {
  const web = websiteOf(m);
  const price = priceText(m);
  return `<div class="mh" role="columnheader">
    <div class="mh-media">${frame(m.image_url)}</div>
    <div class="mh-text">
      <button class="mh-x" type="button" data-remove="${esc(m.id)}" aria-label="Remove ${esc(m.name)} from comparison">${ico('x', 16)}</button>
      <p class="eyebrow">${esc(m.company)}</p>
      <h3 class="mh-name" title="${esc(m.name)}">${esc(m.name)}</h3>
      <div class="mh-meta"><span class="mh-price${price ? '' : ' na'}">${esc(price ?? 'Price n/a')}</span>${stageBadge(m)}</div>
      ${web ? `<a class="mh-link" href="${esc(web)}" target="_blank" rel="noopener noreferrer">Visit website${ico('arrow-up-right', 14)}<span class="sr-only"> (opens in a new tab)</span></a>` : '<span class="mh-link off">No website listed</span>'}
    </div>
  </div>`;
}

function addCell(ms) {
  const free = MAX_COMPARE - ms.length;
  return `<div class="mh add" role="columnheader">
    <div class="mh-media add-art" data-focus-add>
      <span class="add-plus">${ico('plus', 22)}</span>
      <span class="add-t">Add a machine</span>
      <span class="add-s">${free} ${free === 1 ? 'slot' : 'slots'} left</span>
    </div>
    <div class="mh-text">${combo()}</div>
  </div>`;
}

function cellValue(f, m, win) {
  const v = get(m, f.path);
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return NA;
  if (typeof v === 'boolean') {
    return v ? `<span class="yes">${ico('check', 16, 'Yes')}</span>` : `<span class="no">${ico('x', 16, 'No')}</span>`;
  }
  if (f.key === 'stage' && f.section === 'overview') return stageBadge(m);
  const txt = esc(cat.format(m, f.path));
  const eur = f.unit === 'price' && m.currency && m.currency !== 'EUR' ? `<small class="eur">≈ ${esc(formatPrice(priceEUR(m), 'EUR'))}</small>` : '';
  const long = typeof v === 'string' && v.length > 48;
  if (long && v.length > 220) {
    return `<div class="note"><span class="v long">${txt}</span><button class="more" type="button" aria-expanded="false">Read more${ico('chevron-down', 14)}</button></div>`;
  }
  return `<span class="v${long ? ' long' : ''}">${txt}</span>${win ? `<span class="best">${ico('trophy', 12)}Best</span>` : ''}${eur}`;
}

function linksOf(sec, m) {
  const out = [];
  for (const f of sec.fields) {
    const v = get(m, f.path);
    const urls = (Array.isArray(v) ? v : [v]).map(safeUrl).filter(Boolean);
    urls.forEach((u, i) => {
      const host = new URL(u).hostname.replace(/^www\./, '');
      const ic = /youtu\.?be/.test(host) ? 'circle-play' : /discord|forum|community|reddit/.test(host) ? 'message-circle' : 'external-link';
      // per-item labels read singular: "Videos" -> "Video 1"
      const one = f.type === 'urls' ? f.label.replace(/s$/, '') : f.label;
      out.push({ u, text: urls.length > 1 ? `${one} ${i + 1}` : one, host, ic });
    });
  }
  return out;
}

function accessoryList(m, sec) {
  const items = Array.isArray(m[sec.key]) ? m[sec.key] : [];
  if (!items.length) return NA;
  const li = (a) => {
    const url = safeUrl(a.url);
    return `<li class="acc-item">
      ${frame(a.image_url, 'sm')}
      <div>
        <p class="acc-name">${esc(a.name)}</p>
        <p class="acc-price${a.price == null ? ' na' : ''}">${a.price == null ? 'Price n/a' : esc(formatPrice(a.price, m.currency ?? 'EUR'))}</p>
        ${a.description ? `<p class="acc-desc">${esc(a.description)}</p>` : ''}
        ${url ? `<a class="acc-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View${ico('arrow-up-right', 13)}<span class="sr-only"> ${esc(a.name)} (opens in a new tab)</span></a>` : ''}
      </div>
    </li>`;
  };
  const head = items.slice(0, 3).map(li).join('');
  const rest = items.slice(3);
  return `<ul class="acc">${head}</ul>${rest.length ? `<details class="acc-more"><summary>${ico('chevron-down', 15)}${rest.length} more</summary><ul class="acc">${rest.map(li).join('')}</ul></details>` : ''}`;
}

const crow = (label, cells, pad) => `<div class="crow fr" role="row"><div class="lab" role="rowheader"><span>${esc(label)}</span></div>${cells.map((c) => `<div class="val${c.win ? ' win' : ''}" role="cell">${c.html}</div>`).join('')}${pad}</div>`;

// One renderer per section kind; each returns the rows for that section or '' when there is nothing to show.
const SECTION_BODY = {
  fields: (sec, ms, pad, diff) => sec.fields
    .filter((f) => f.row && hasData(f, ms) && (!diff || differs(f, ms)))
    .map((f) => {
      const win = best(f, ms);
      return crow(f.label, ms.map((m) => ({ win: win.has(m.id), html: cellValue(f, m, win.has(m.id)) })), pad);
    })
    .join(''),
  links: (sec, ms, pad) => {
    const per = ms.map((m) => linksOf(sec, m));
    if (!per.some((l) => l.length)) return '';
    const btn = (l) => `<a class="lbtn" href="${esc(l.u)}" target="_blank" rel="noopener noreferrer">${ico(l.ic, 16)}${esc(l.text)}<small>${esc(l.host)}</small><span class="sr-only"> (opens in a new tab)</span></a>`;
    return crow(sec.fields.map((f) => f.label).join(' · '), per.map((links) => ({ html: links.length ? `<div class="links">${links.map(btn).join('')}</div>` : NA })), pad);
  },
  list: (sec, ms, pad) => (ms.some((m) => Array.isArray(m[sec.key]) && m[sec.key].length)
    ? crow('From the maker', ms.map((m) => ({ html: accessoryList(m, sec) })), pad)
    : ''),
};

function headRow(ms, slot, diff) {
  const legend = ms.length > 1 ? `<p class="legend"><span class="best">${ico('trophy', 12)}Best</span>value in this set</p>` : '';
  const sub = ms.length === 1 ? '1 machine · add another to compare' : `${ms.length} machines${diff ? ' · differences only' : ''}`;
  return `<div class="crow head" role="row">
    <div class="corner" role="columnheader">
      <div class="corner-top"><p class="corner-t">Side by <em>side</em></p><p class="corner-s">${sub}</p></div>
      ${legend}
    </div>
    ${ms.map(headCell).join('')}${slot ? addCell(ms) : ''}
  </div>`;
}

function compareTable(ms, slot, diff) {
  const cols = ms.length + (slot ? 1 : 0);
  const pad = slot ? '<div class="val" role="cell"></div>' : '';
  const sections = cat.sections.map((sec) => {
    const body = SECTION_BODY[sec.kind]?.(sec, ms, pad, diff) ?? '';
    if (!body) return '';
    const dek = sec.description ? `<span class="sec-d">${esc(sec.description)}</span>` : '';
    return `<div class="crow" role="row"><div class="sec" role="cell"><div class="sec-t"><span class="ico">${ico(sec.icon ?? 'circle-help', 20)}</span><div><h3>${esc(sec.title)}</h3>${dek}</div></div></div></div>${body}`;
  });
  return `<div class="cmp" role="table" aria-label="Comparison of ${esc(ms.map((m) => m.name).join(', '))}" style="--cols:${cols};--div:${cols <= 2 ? 2 : 2.2}">${headRow(ms, slot, diff)}${sections.join('')}</div>`;
}

// ---------- add-machine combobox ----------

const cb = { items: [], active: -1, quiet: false };
function openList(query) {
  const s = store.get();
  cb.items = filterMachines(cat, { q: query }).filter((m) => !s.compare.includes(m.id));
  cb.active = query.trim() && cb.items.length ? 0 : -1;
  const ul = $('#add-list');
  const input = $('#add-input');
  ul.innerHTML = cb.items.length
    ? cb.items.map((m, i) => `<li class="option" role="option" id="opt-${i}" data-id="${esc(m.id)}" aria-selected="${i === cb.active}">${frame(m.image_url, 'sm')}<span><b>${esc(m.name)}</b><small>${esc(m.company)}${priceText(m) ? ` · ${esc(priceText(m))}` : ''}</small></span></li>`).join('')
    : `<li class="nores" role="presentation">No machine matches “${esc(query)}”</li>`;
  ul.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  setActive(cb.active);
}
function closeList() {
  const ul = $('#add-list');
  if (!ul) return;
  ul.hidden = true;
  $('#add-input').setAttribute('aria-expanded', 'false');
  $('#add-input').removeAttribute('aria-activedescendant');
}
function setActive(i) {
  cb.active = i;
  const input = $('#add-input');
  for (const li of $$('#add-list .option')) li.setAttribute('aria-selected', String(li.id === `opt-${i}`));
  if (i >= 0) {
    input.setAttribute('aria-activedescendant', `opt-${i}`);
    $(`#opt-${i}`)?.scrollIntoView({ block: 'nearest' });
  } else input.removeAttribute('aria-activedescendant');
}
function choose(id) {
  const m = cat.machine(id);
  if (!m) return;
  closeList();
  cb.quiet = true; // the re-rendered input gets focus; keep its list closed until the user types
  if (store.addCompare(id)) toast(`${m.name} added`);
  cb.quiet = false;
}

// Combobox keys: arrows move the active option, Enter picks it, Escape closes the list, then clears.
// A handler returns false when it did not consume the key (so Escape can still close the comparison).
function moveActive(input, open, d) {
  if (!open) openList(input.value);
  const n = cb.items.length;
  if (n) setActive(cb.active < 0 ? (d > 0 ? 0 : n - 1) : (cb.active + d + n) % n);
}
const COMBO_KEYS = {
  ArrowDown: (input, open) => moveActive(input, open, 1),
  ArrowUp: (input, open) => moveActive(input, open, -1),
  Enter: (input, open) => {
    if (!open || (cb.active < 0 && cb.items.length !== 1)) return false;
    choose(cb.items[Math.max(cb.active, 0)].id);
  },
  Escape: (input, open) => {
    if (open) closeList();
    else if (input.value) input.value = '';
    else return false;
  },
};
function onComboKey(e) {
  const fn = COMBO_KEYS[e.key];
  if (!fn || fn(e.target, !$('#add-list').hidden) === false) return;
  e.preventDefault();
  e.stopPropagation();
}

// ---------- quick popover ----------

let qpField = null;
let qpPill = null;
let qpWasOpenFor = null;

function placeQp() {
  if (!qpPill) return;
  const qp = $('#qp');
  const r = qpPill.getBoundingClientRect();
  const w = qp.offsetWidth;
  qp.style.left = `${Math.round(Math.min(Math.max(16, r.left), innerWidth - w - 16))}px`;
  qp.style.top = `${Math.round(r.bottom + 10)}px`;
  qp.style.maxHeight = `${Math.max(220, Math.min(560, innerHeight - r.bottom - 26))}px`;
}

function openQuick(pill) {
  const f = cat.field(pill.dataset.path);
  const sec = sectionOf(f);
  const qp = $('#qp');
  qpField = f;
  qpPill = pill;
  qp.innerHTML = `<div class="qp-head"><p class="qp-title"><span class="ico">${ico(sec?.icon ?? 'info', 15)}</span>${esc(f.label)}</p><button class="link-btn" type="button" data-qp-reset>Reset</button></div>
    ${control(f, 'qp')}
    <div class="qp-foot"><button class="btn accent" type="button" data-qp-done>Done</button></div>`;
  qp.setAttribute('aria-label', `Filter by ${f.label}`);
  qp.showPopover();
  placeQp();
  // Give the popover room: bring the filter bar up to its sticky position; the popover follows on scroll.
  const bar = $('#filterbar');
  if (bar.getBoundingClientRect().top > innerHeight * 0.3) {
    scrollTo({ top: scrollY + $('#sentinel').getBoundingClientRect().top + 1, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }
  pill.setAttribute('aria-expanded', 'true');
  render(store.get());
  $('input', qp)?.focus({ preventScroll: true });
}

// ---------- events ----------

function bindEvents() {
  const q = $('#q');
  q.addEventListener('input', () => {
    $('#q-clear').hidden = !q.value;
    store.set({ q: q.value });
  });
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    $('#results').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });
  $('#q-clear').addEventListener('click', () => {
    q.value = '';
    store.set({ q: '' });
    q.focus();
  });
  $('#mini-search').addEventListener('click', () => focusSearch());
  $('#sort').addEventListener('change', (e) => store.set({ sort: e.target.value }));

  // cards + hero tiles
  $('#grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    const toggle = e.target.closest('.cmp-btn');
    if (toggle && store.get().compare.includes(id)) {
      store.removeCompare(id);
      toast(`${cat.machine(id).name} removed from comparison`);
    } else if (toggle || e.target.closest('.card-open')) {
      openCompare(id, toggle ?? $('.cmp-btn', card));
    }
  });
  $('#hero-art').addEventListener('click', (e) => {
    const tile = e.target.closest('[data-open]');
    if (tile) openCompare(tile.dataset.open, tile);
  });

  // chips + empty state + clear-all
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-clear]');
    if (!c) return;
    const what = c.dataset.clear;
    if (what === 'all') {
      store.clearFilters();
      $('#q').value = '';
    } else if (what === 'q') {
      store.set({ q: '' });
      $('#q').value = '';
    } else store.setFilter(what, null);
    if (c.closest('#active')) ($('#active .chip-x') ?? $('#results')).focus({ preventScroll: true });
  });

  // tray
  $('#tray').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tray]');
    if (!b) return;
    if (b.dataset.tray === 'open') openCompare(null, b);
    else {
      store.set({ compare: [] });
      toast('Comparison cleared');
    }
  });

  // side panel
  const panel = $('#panel');
  $('#open-filters').addEventListener('click', () => {
    panel.showModal();
    document.documentElement.classList.add('lock');
  });
  panel.addEventListener('close', () => {
    if (!sheetOpen) document.documentElement.classList.remove('lock');
  });
  panel.addEventListener('click', (e) => {
    if (e.target === panel || e.target.closest('[data-close]')) panel.close();
    if (e.target.closest('[data-clear-all]')) {
      store.set({ filters: {} });
    }
  });
  for (const root of [$('#panel-body'), $('#qp')]) {
    root.addEventListener('change', onControl);
    root.addEventListener('input', onControl);
  }

  // quick popovers
  const qp = $('#qp');
  const pills = $('#pills');
  pills.addEventListener('pointerdown', (e) => {
    const pill = e.target.closest('.pill');
    qpWasOpenFor = pill && qp.matches(':popover-open') && qpPill === pill ? pill : null;
  });
  pills.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    const openForThis = qp.matches(':popover-open') && qpPill === pill;
    if (openForThis || qpWasOpenFor === pill) {
      qpWasOpenFor = null;
      if (openForThis) qp.hidePopover();
      return;
    }
    openQuick(pill);
  });
  pills.addEventListener('scroll', placeQp, { passive: true });
  addEventListener('scroll', placeQp, { passive: true });
  addEventListener('resize', placeQp);
  qp.addEventListener('toggle', (e) => {
    if (e.newState !== 'closed') return;
    const hadFocus = qp.contains(document.activeElement);
    qpPill?.setAttribute('aria-expanded', 'false');
    if (hadFocus) qpPill?.focus({ preventScroll: true });
    qpField = null;
    qpPill = null;
  });
  qp.addEventListener('click', (e) => {
    if (e.target.closest('[data-qp-reset]') && qpField) store.setFilter(qpField.path, null);
    if (e.target.closest('[data-qp-done]')) qp.hidePopover();
  });

  // sheet bar
  $('#sheet-back').addEventListener('click', () => store.closeCompare());
  $('#diff').addEventListener('change', (e) => {
    diffOnly = e.target.checked;
    const url = new URL(location.href);
    if (diffOnly) url.searchParams.set('diff', '1');
    else url.searchParams.delete('diff');
    history.replaceState(history.state, '', url);
    renderSheet(store.get());
  });
  $('#sheet-add').addEventListener('click', () => {
    const input = $('#add-input');
    if (!input) return;
    input.closest('.mh')?.scrollIntoView({ inline: 'end', block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    input.focus({ preventScroll: true });
  });
  $('#sheet-share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied — it opens this exact comparison');
    } catch {
      toast('Copy the address bar to share this comparison');
    }
  });

  // pane: remove, add-slot, combobox
  const pane = $('#pane');
  pane.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const m = cat.machine(rm.dataset.remove);
      store.removeCompare(rm.dataset.remove);
      toast(`${m.name} removed`);
      $('#sheet-title').focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('[data-focus-add]')) $('#add-input')?.focus();
    const more = e.target.closest('.more');
    if (more) {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      more.firstChild.textContent = open ? 'Show less' : 'Read more';
      more.parentElement.classList.toggle('open', open);
    }
    const opt = e.target.closest('.option');
    if (opt) choose(opt.dataset.id);
  });
  pane.addEventListener('mousedown', (e) => {
    if (e.target.closest('#add-list')) e.preventDefault(); // keep focus in the input
  });
  pane.addEventListener('input', (e) => {
    if (e.target.id === 'add-input') openList(e.target.value);
  });
  pane.addEventListener('focusin', (e) => {
    if (e.target.id === 'add-input' && $('#add-list').hidden && !cb.quiet) openList(e.target.value);
  });
  pane.addEventListener('focusout', (e) => {
    if (e.target.id === 'add-input') closeList();
  });
  pane.addEventListener('keydown', (e) => e.target.id === 'add-input' && onComboKey(e));

  // global keys
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && sheetOpen && !$('#panel').open) {
      e.preventDefault();
      store.closeCompare();
    }
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === '/' && !typing && !sheetOpen && !$('#panel').open && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      focusSearch();
    }
  });

  // filter bar: stuck state
  new IntersectionObserver(([entry]) => {
    const stuck = !entry.isIntersecting && entry.boundingClientRect.top < 0;
    $('#filterbar').classList.toggle('stuck', stuck);
    $('#mini-search').tabIndex = stuck ? 0 : -1;
  }).observe($('#sentinel'));
}

function focusSearch() {
  const q = $('#q');
  q.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  q.focus({ preventScroll: true });
  q.select();
}

// ---------- boot ----------

function showError(err) {
  $('#count').textContent = 'Catalogue unavailable';
  const grid = $('#grid');
  grid.replaceChildren();
  grid.removeAttribute('aria-busy');
  const st = $('#state');
  st.hidden = false;
  st.innerHTML = `<div class="state-icon">${ico('circle-help', 34)}</div>
    <h3>The catalogue didn’t arrive.</h3>
    <p>We couldn’t load the machine data. Check your connection and try again.</p>
    <code>${esc(err?.message ?? err)}</code>
    <button class="btn accent" type="button" id="retry">${ico('rotate-ccw', 18)}Try again</button>`;
  $('#retry').addEventListener('click', () => location.reload());
}

async function boot() {
  hydrateIcons();
  try {
    cat = await loadCatalog();
  } catch (err) {
    console.warn('Atelier: catalogue failed to load', err);
    showError(err);
    return;
  }
  store = createStore(cat);
  buildShell();
  bindEvents();
  store.subscribe(render);
  render(store.get());
}

boot();
