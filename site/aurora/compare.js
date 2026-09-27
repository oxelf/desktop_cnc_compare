// Full-screen comparison: sticky glass machine headers, one bento block per schema section,
// winners highlighted, differences-only mode, plus the command-palette combobox to add machines.
import { best, differs, filterMachines, formatPrice, get, hasData, MAX_COMPARE, priceEUR, workArea } from '../core/core.js';
import { icon } from '../core/icons.js';
import { $, closeDialog, esc, isEmpty, MOD, openDialog, productImage, safeUrl, stageBadge, toast, wireDialog } from './ui.js';

const num = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });
const NIL = '<span class="nil" aria-hidden="true">—</span><span class="sr-only">No data</span>';
const cur = (m) => m.currency ?? 'EUR';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const LONG = 48; // longer text values render as a paragraph
const CLAMP = 260; // paragraphs longer than this start clamped with a "Show all" toggle
const MORE = `<button type="button" class="more-btn" data-more aria-expanded="false"><span>Show all</span>${icon('chevron-down', { size: 13 })}</button>`;

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function highlight(text, q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return esc(text);
  const lower = text.toLowerCase();
  const on = new Array(text.length).fill(false);
  for (const t of tokens) {
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + t.length)) on.fill(true, i, i + t.length);
  }
  let out = '';
  let open = false;
  for (let i = 0; i < text.length; i++) {
    if (on[i] !== open) {
      out += on[i] ? '<mark>' : '</mark>';
      open = on[i];
    }
    out += esc(text[i]);
  }
  return out + (open ? '</mark>' : '');
}

export function initCompare(cat, store, { getDiff, setDiff }) {
  const view = $('#compare-view');
  const table = $('#cmp-table');
  const sub = $('#cmp-sub');
  const toggle = $('#diff-toggle');
  let renderedKey = '';
  let focusAfterAdd = null;

  // ---------- cells ----------

  function labelHtml(f) {
    const hint = f.better
      ? `<span class="better" title="${f.better === 'higher' ? 'Higher is better' : 'Lower is better'}">${icon(f.better === 'higher' ? 'chevron-up' : 'chevron-down', { size: 13 })}<span class="sr-only">(${f.better} is better)</span></span>`
      : '';
    return `<span class="lbl">${esc(f.label)}${hint}</span>`;
  }

  function linkButtons(f, v, m) {
    const urls = [].concat(v).map(safeUrl).filter(Boolean);
    if (!urls.length) return NIL;
    return `<div class="links">${urls
      .map((u, i) => {
        const host = hostOf(u);
        const ic = /youtu/.test(host) ? 'circle-play' : /discord/.test(host) ? 'message-circle' : 'external-link';
        const text = f.type === 'urls' ? `${f.label.replace(/s$/, '')}${urls.length > 1 ? ` ${i + 1}` : ''}` : f.label;
        return `<a class="link-btn" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(text)}: ${esc(m.name)} (opens in a new tab)">${icon(ic, { size: 14 })}<span>${esc(text)}</span></a>`;
      })
      .join('')}</div>`;
  }

  function valueHtml(f, m, kind) {
    const v = get(m, f.path);
    if (isEmpty(v)) return NIL;
    if (kind === 'link') return linkButtons(f, v, m);
    if (typeof v === 'boolean') {
      return v
        ? `<span class="bool yes">${icon('check', { size: 14 })}</span><span class="sr-only">Yes</span>`
        : `<span class="bool no">${icon('x', { size: 13 })}</span><span class="sr-only">No</span>`;
    }
    if (f.path === 'stage') return stageBadge(cat, m);
    if (f.unit === 'price') {
      const approx = cur(m) !== 'EUR' ? `<span class="approx">≈ ${esc(formatPrice(priceEUR(m), 'EUR'))}</span>` : '';
      return `<span class="num is-price">${esc(formatPrice(v, cur(m)))}</span>${approx}`;
    }
    if (typeof v === 'number') return `<span class="num">${esc(num.format(v))}</span>${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}`;
    const text = cat.format(m, f.path);
    if (text.length > CLAMP) return `<p class="note">${esc(text)}</p>${MORE.replace('more-btn', 'more-btn cell-more')}`;
    if (text.length > LONG) return `<p class="note">${esc(text)}</p>`;
    return `<span class="txt">${esc(text)}</span>`;
  }

  function cellHtml(f, m, winners, kind) {
    const isBest = winners?.has(m.id);
    const nil = isEmpty(get(m, f.path));
    const win = isBest ? `<span class="win" title="Best value">${icon('trophy', { size: 14 })}<span class="sr-only">Best value</span></span>` : '';
    return `<div class="cell${isBest ? ' is-best' : ''}${nil ? ' is-nil' : ''}" role="cell"><span class="cell-label" aria-hidden="true">${esc(f.label)}</span><span class="val">${valueHtml(f, m, kind)}</span>${win}</div>`;
  }

  function accessories(m, list) {
    if (isEmpty(list)) return `<span class="nil" aria-hidden="true">—</span><span class="muted-note">None listed</span>`;
    return `<ul class="acc-list">${list
      .map((a) => {
        const url = safeUrl(a.url);
        const name = url
          ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(a.name)}${icon('arrow-up-right', { size: 13 })}<span class="sr-only"> (opens in a new tab)</span></a>`
          : esc(a.name);
        const price = a.price == null ? '<span class="acc-na">Price n/a</span>' : esc(formatPrice(a.price, cur(m)));
        return `<li class="acc">${productImage({ image_url: a.image_url }, 'pool-acc', { ambient: false })}<div class="acc-body">
            <p class="acc-name">${name}</p><p class="acc-price">${price}</p>${a.description ? `<p class="acc-desc">${esc(a.description)}</p>` : ''}</div></li>`;
      })
      .join('')}</ul>`;
  }

  // ---------- header ----------

  function headCell(m, wins) {
    const site = safeUrl(m.media?.website);
    return `<div class="mh" role="columnheader" data-id="${esc(m.id)}">
      <div class="mh-media">${productImage(m)}
        <button type="button" class="mh-remove" data-remove="${esc(m.id)}" aria-label="Remove ${esc(m.name)} from comparison">${icon('x', { size: 15 })}</button>
      </div>
      <div class="mh-body">
        <div class="mh-top">${stageBadge(cat, m)}${wins ? `<span class="mh-wins" title="Best value in ${plural(wins, 'spec')}">${icon('trophy', { size: 12 })}<span>${wins}</span><span class="sr-only"> best values</span></span>` : ''}</div>
        <p class="mh-maker">${esc(m.company)}</p>
        <h3 class="mh-name">${esc(m.name)}</h3>
        <div class="mh-foot">
          ${productImage(m, 'pool-thumb', { ambient: false })}
          <span class="mh-price">${esc(formatPrice(m.price, cur(m)))}</span>
          ${site ? `<a class="mh-site" href="${esc(site)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(m.name)} website (opens in a new tab)"><span>Website</span>${icon('arrow-up-right', { size: 14 })}</a>` : ''}
        </div>
      </div>
    </div>`;
  }

  function headRow(ms, slot, wins) {
    const left = MAX_COMPARE - ms.length;
    const corner = `<div class="cmp-corner" role="columnheader">
        <p class="corner-kicker">Side by side</p>
        <p class="corner-title">${plural(ms.length, 'machine')}</p>
        <ul class="legend" aria-label="Legend">
          <li><span class="win">${icon('trophy', { size: 13 })}</span>Best value</li>
          <li><span class="better">${icon('chevron-up', { size: 13 })}</span>Higher is better</li>
          <li><span class="nil">—</span>No data</li>
        </ul>
      </div>`;
    const add = slot
      ? `<div class="mh mh-slot" role="columnheader"><button type="button" class="slot-btn" data-add aria-label="Add a machine to the comparison, ${plural(left, 'slot')} left">
          <span class="slot-plus">${icon('plus', { size: 22 })}</span>
          <span class="slot-text"><span class="slot-title">Add machine</span><span class="slot-hint">${plural(left, 'slot')} left <kbd class="kbd">${MOD} K</kbd></span></span>
        </button></div>`
      : '';
    return `<div class="cmp-head" role="row" style="grid-row:1">${corner}${ms.map((m) => headCell(m, wins.get(m.id))).join('')}${add}</div>`;
  }

  // ---------- table ----------

  // Visible rows of one section; identical rows are dropped (and counted) in differences-only mode.
  function sectionRows(s, ms, diff) {
    if (s.kind === 'list') {
      if (!ms.some((m) => !isEmpty(get(m, s.key)))) return { rows: [], hidden: 0 };
      return diff && !differs({ path: s.key }, ms) ? { rows: [], hidden: 1 } : { rows: [{ kind: 'list' }], hidden: 0 };
    }
    const shown = s.fields.filter((f) => f.row && hasData(f, ms));
    const rows = shown
      .filter((f) => !diff || differs(f, ms))
      .map((f) => ({ kind: s.kind === 'links' ? 'link' : 'field', f, w: best(f, ms) }));
    return { rows, hidden: shown.length - rows.length };
  }

  function blocksFor(ms, diff) {
    const blocks = [];
    const wins = new Map(ms.map((m) => [m.id, 0]));
    let hidden = 0;
    for (const s of cat.sections) {
      const r = sectionRows(s, ms, diff);
      hidden += r.hidden;
      for (const row of r.rows) for (const id of row.w ?? []) wins.set(id, wins.get(id) + 1);
      if (r.rows.length) blocks.push({ s, rows: r.rows });
    }
    return { blocks, wins, hidden };
  }

  function rowHtml(s, x, ms, r, first, last) {
    const tall =
      x.kind !== 'field' || ms.some((m) => typeof get(m, x.f.path) === 'string' && cat.format(m, x.f.path).length > LONG);
    const cls = `cmp-row${first ? ' is-first' : ''}${last ? ' is-last' : ''}${x.kind === 'list' ? ' is-list' : ''}${tall ? ' is-top' : ''}`;
    if (x.kind === 'list') {
      return `<div class="${cls}" role="row" style="grid-row:${r}">
        <div class="cmp-label" role="rowheader"><span class="lbl">Add-ons</span>${s.description ? `<span class="lbl-desc">${esc(s.description)}</span>` : ''}</div>
        ${ms.map((m) => `<div class="cell cell-list" role="cell">${accessories(m, get(m, s.key))}</div>`).join('')}</div>`;
    }
    const long = ms.some((m) => {
      const v = get(m, x.f.path);
      return typeof v === 'string' && v.length > CLAMP;
    });
    const more = long ? MORE : '';
    return `<div class="${cls}" role="row" style="grid-row:${r}"><div class="cmp-label" role="rowheader">${labelHtml(x.f)}${more}</div>${ms
      .map((m) => cellHtml(x.f, m, x.w, x.kind))
      .join('')}</div>`;
  }

  function emptyHtml() {
    return `<div class="cmp-empty" style="grid-row:1"><div class="state-card">
        <span class="state-icon">${icon('git-compare-arrows', { size: 26 })}</span>
        <h2>Nothing to compare yet</h2>
        <p>Pick up to ${MAX_COMPARE} machines and see every spec side by side, winners highlighted.</p>
        <div class="state-actions">
          <button type="button" class="btn btn-primary" data-add>${icon('plus', { size: 16 })}<span>Add a machine</span></button>
          <button type="button" class="btn btn-glass" data-back>Browse all machines</button>
        </div>
      </div></div>`;
  }

  function render(state) {
    const ms = state.compare.map((id) => cat.machine(id)).filter(Boolean);
    const diff = getDiff();
    toggle.setAttribute('aria-checked', String(diff));
    document.title = ms.length ? `${ms.map((m) => m.name).join(' vs ')} · Aurora` : 'Compare · Aurora';
    if (!ms.length) {
      table.style.setProperty('--cols', 1);
      table.dataset.count = 0;
      table.innerHTML = emptyHtml();
      sub.textContent = `0 of ${MAX_COMPARE} machines`;
      layout();
      return;
    }
    const slot = ms.length < MAX_COMPARE;
    table.style.setProperty('--cols', ms.length + (slot ? 1 : 0));
    table.dataset.count = ms.length;
    const { blocks, wins, hidden } = blocksFor(ms, diff);
    const parts = [headRow(ms, slot, wins)];
    let r = 2;
    for (const { s, rows } of blocks) {
      parts.push(`<div class="cmp-sec" role="row" style="grid-row:${r}"><div class="cmp-sec-cell" role="rowheader"><span class="cmp-sec-inner">
          <span class="sec-icon">${icon(s.icon ?? 'info', { size: 15 })}</span><h3>${esc(s.title)}</h3><span class="cmp-sec-meta">${plural(rows.length, 'spec')}</span></span></div></div>`);
      const r0 = r + 1;
      ms.forEach((_, k) => parts.push(`<div class="tile" aria-hidden="true" style="grid-row:${r0} / ${r0 + rows.length};grid-column:m ${k + 1}"></div>`));
      rows.forEach((x, i) => parts.push(rowHtml(s, x, ms, r0 + i, i === 0, i === rows.length - 1)));
      r = r0 + rows.length;
    }
    if (!blocks.length) {
      parts.push(`<div class="cmp-nodiff" style="grid-row:2">${icon('eye-off', { size: 18 })}<span>These machines share every listed value. Turn off “Differences only” to see them.</span></div>`);
    }
    table.innerHTML = parts.join('');
    sub.textContent = `${ms.length} of ${MAX_COMPARE} machines${diff ? ` · ${plural(hidden, 'identical row')} hidden` : ''}`;
    layout();
    onScroll();
  }

  // Wide enough for label column + machine columns? Otherwise stack labels above values.
  function layout() {
    const n = Number(table.style.getPropertyValue('--cols')) || 1;
    const need = 220 + n * 212 + n * 12 + 64;
    table.classList.toggle('is-stacked', innerWidth < Math.max(720, need));
  }
  addEventListener('resize', layout, { passive: true });

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const head = table.querySelector('.cmp-head');
      if (!head) return;
      const top = parseFloat(getComputedStyle(head).top) || 0;
      const natural = table.offsetTop + parseFloat(getComputedStyle(table).paddingTop);
      head.classList.toggle('is-stuck', view.scrollTop > natural - top + 2);
    });
  }
  view.addEventListener('scroll', onScroll, { passive: true });

  table.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return openPalette();
    if (e.target.closest('[data-back]')) return store.closeCompare();
    const more = e.target.closest('[data-more]');
    if (more) {
      const row = more.closest('.cmp-row');
      const open = row.classList.toggle('is-open');
      for (const b of row.querySelectorAll('[data-more]')) {
        b.setAttribute('aria-expanded', String(open));
        b.firstChild.textContent = open ? 'Show less' : 'Show all';
      }
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const ids = store.get().compare;
      const idx = ids.indexOf(rm.dataset.remove);
      const m = cat.machine(rm.dataset.remove);
      store.removeCompare(rm.dataset.remove);
      toast(`Removed ${m?.name ?? 'machine'}`, 'minus');
      const next = table.querySelectorAll('[data-remove]')[Math.min(idx, ids.length - 2)] ?? table.querySelector('[data-add]');
      next?.focus();
    }
  });

  toggle.addEventListener('click', () => {
    setDiff(!getDiff());
    update(store.get(), true);
  });

  $('#cmp-share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied to clipboard', 'link');
    } catch {
      toast('Copy failed — use the address bar', 'x');
    }
  });

  // ---------- add-machine palette (combobox + listbox) ----------

  const pal = $('#palette');
  const pq = $('#palette-q');
  const plist = $('#palette-list');
  const pmeta = $('#palette-meta');
  let items = [];
  let active = 0;

  function optionHtml(m, i, q) {
    return `<li role="option" id="opt-${esc(m.id)}" data-id="${esc(m.id)}" aria-selected="${i === active}" class="opt">
      ${productImage(m, 'pool-opt', { ambient: false })}
      <span class="opt-main"><span class="opt-name">${highlight(m.name, q)}</span><span class="opt-sub">${esc(m.company)}<span aria-hidden="true"> · </span>${esc(workArea(m))}</span></span>
      <span class="opt-side">${m.stage && m.stage !== 'available' ? stageBadge(cat, m) : ''}<span class="opt-price">${esc(formatPrice(m.price, cur(m)))}</span></span>
      <span class="opt-enter" aria-hidden="true">${icon('plus', { size: 14 })}</span>
    </li>`;
  }

  function renderPalette() {
    const st = store.get();
    const q = pq.value;
    items = filterMachines(cat, { q, sort: 'name' }).filter((m) => !st.compare.includes(m.id));
    active = Math.min(active, Math.max(0, items.length - 1));
    plist.innerHTML = items.length
      ? items.map((m, i) => optionHtml(m, i, q)).join('')
      : `<li class="opt-empty" role="presentation">${icon('search', { size: 20 })}<span>No machines match “${esc(q)}”</span></li>`;
    pmeta.textContent = `${plural(items.length, 'machine')} available · ${st.compare.length} of ${MAX_COMPARE} in comparison`;
    syncActive();
  }

  function syncActive(scroll = true) {
    const opts = plist.querySelectorAll('[role="option"]');
    opts.forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (items[active]) {
      pq.setAttribute('aria-activedescendant', `opt-${items[active].id}`);
      if (scroll) opts[active].scrollIntoView({ block: 'nearest' });
    } else {
      pq.removeAttribute('aria-activedescendant');
    }
  }

  function choose(id, keepOpen) {
    const m = cat.machine(id);
    if (!m || !store.addCompare(id)) return;
    toast(`Added ${m.name}`, 'plus');
    if (keepOpen && store.get().compare.length < MAX_COMPARE) {
      renderPalette();
      pq.focus();
    } else {
      focusAfterAdd = id;
      closeDialog(pal);
    }
  }

  pq.addEventListener('input', () => {
    active = 0;
    renderPalette();
  });
  pq.addEventListener('keydown', (e) => {
    const n = items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!n) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      syncActive();
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      if (!n) return;
      active = Math.max(0, Math.min(n - 1, active + (e.key === 'PageDown' ? 5 : -5)));
      syncActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) choose(items[active].id, e.metaKey || e.ctrlKey);
    }
  });
  plist.addEventListener('click', (e) => {
    const li = e.target.closest('[role="option"]');
    if (li) choose(li.dataset.id, e.metaKey || e.ctrlKey);
  });
  plist.addEventListener('pointermove', (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li) return;
    const i = items.findIndex((m) => m.id === li.dataset.id);
    if (i >= 0 && i !== active) {
      active = i;
      syncActive(false);
    }
  });
  wireDialog(pal, () => {
    const target = table.querySelector('[data-add]') ?? table.querySelector(`.mh[data-id="${CSS.escape(focusAfterAdd ?? '')}"] .mh-remove`);
    focusAfterAdd = null;
    if (store.get().view === 'compare') target?.focus({ preventScroll: true });
  });

  function openPalette() {
    if (store.get().compare.length >= MAX_COMPARE) {
      toast(`The comparison is full — remove a machine to add another`, 'info');
      return;
    }
    pq.value = '';
    active = 0;
    renderPalette();
    openDialog(pal);
    pq.focus();
  }

  function update(state, force = false) {
    if (state.view !== 'compare') return;
    const key = `${state.compare.join(',')}|${getDiff()}`;
    if (!force && key === renderedKey) return;
    renderedKey = key;
    render(state);
  }

  return {
    update,
    openPalette,
    reset: () => {
      renderedKey = '';
    },
    mediaFor: (id) => table.querySelector(`.mh[data-id="${CSS.escape(id)}"] .mh-media .pool`),
  };
}
