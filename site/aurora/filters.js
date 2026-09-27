// Filter slide-over, generated from cat.filterFields grouped by cat.sections.
// DOM is built once; update(state) only syncs values and facet counts so focus is never lost.
import { facets, filterMachines, formatPrice, formatValue, value } from '../core/core.js';
import { icon } from '../core/icons.js';
import { $, $$, closeDialog, esc, openDialog, wireDialog } from './ui.js';

const CHIP_LIMIT = 10; // multi facets longer than this collapse behind "show more"

const uid = (path) => `f-${path.replace(/[^a-z0-9]+/gi, '-')}`;

export const formatBound = (field, v) => (field.unit === 'price' ? formatPrice(v, 'EUR') : formatValue(field, v));

function stepFor(field, { min, max }) {
  const span = max - min;
  let step = 10 ** Math.floor(Math.log10(span / 60));
  if (field.type === 'integer') step = Math.max(1, Math.round(step));
  return step;
}

const decimals = (step) => Math.max(0, -Math.floor(Math.log10(step)));
const roundTo = (v, step) => Number((Math.round(v / step) * step).toFixed(decimals(step)));

export function initFilters(cat, store) {
  const dlg = $('#filters');
  const body = $('#filter-body');
  const find = $('#filter-find');
  const controls = [];
  const sections = [];

  for (const s of cat.sections) {
    const fields = s.fields.filter((f) => cat.filterFields.includes(f));
    if (!fields.length) continue;
    const det = document.createElement('details');
    det.className = 'fsec';
    det.open = s.key === 'overview' || s.key === 'general';
    det.innerHTML = `<summary>
        <span class="sec-icon">${icon(s.icon ?? 'info', { size: 16 })}</span>
        <span class="fsec-title">${esc(s.title)}</span>
        <span class="fsec-count" hidden></span>
        <span class="fsec-chev">${icon('chevron-down', { size: 16 })}</span>
      </summary><div class="fsec-body"></div>`;
    const list = det.lastElementChild;
    const own = [];
    for (const f of fields) {
      const c = makeControl(f);
      if (!c) continue;
      list.append(c.el);
      own.push(c);
      controls.push(c);
    }
    sections.push({ s, det, controls: own, count: det.querySelector('.fsec-count') });
    body.append(det);
  }
  const none = document.createElement('p');
  none.className = 'sheet-none';
  none.hidden = true;
  none.textContent = 'No filter matches that name.';
  body.append(none);

  function makeControl(f) {
    if (f.filter === 'multi') return multiControl(f);
    if (f.filter === 'bool') return boolControl(f);
    if (f.filter === 'range') return rangeControl(f);
    return null;
  }

  function shell(f, extra = '') {
    const el = document.createElement('div');
    el.className = `ff ff-${f.filter}`;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-labelledby', `${uid(f.path)}-l`);
    const unit = f.unit === 'price' ? 'EUR, approx.' : f.filter === 'range' ? f.unit : '';
    el.innerHTML = `<div class="ff-head"><span class="ff-label" id="${uid(f.path)}-l">${esc(f.label)}${unit ? ` <span class="ff-unit">${esc(unit)}</span>` : ''}</span>${extra}</div>`;
    return el;
  }

  function multiControl(f) {
    const opts = facets(cat, f);
    const el = shell(f);
    const collapsible = opts.length > CHIP_LIMIT;
    el.insertAdjacentHTML(
      'beforeend',
      `<div class="chipset">${opts
        .map(
          (o, i) => `<label class="chip${collapsible && i >= CHIP_LIMIT - 2 ? ' is-extra' : ''}">
            <input type="checkbox" value="${esc(o.value)}"><span class="chip-text">${esc(o.label)}</span><span class="chip-n">${o.count}</span></label>`,
        )
        .join('')}${collapsible ? `<button type="button" class="chip chip-more" aria-expanded="false">+${opts.length - CHIP_LIMIT + 2} more</button>` : ''}</div>`,
    );
    const inputs = $$('input', el);
    el.addEventListener('change', () => {
      const vals = inputs.filter((i) => i.checked).map((i) => i.value);
      store.setFilter(f.path, vals.length ? vals : null);
    });
    const more = $('.chip-more', el);
    more?.addEventListener('click', () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      el.classList.toggle('is-expanded', open);
      more.textContent = open ? 'Show less' : `+${opts.length - CHIP_LIMIT + 2} more`;
    });
    return {
      field: f,
      el,
      update(state, others) {
        const cur = state.filters[f.path] ?? [];
        const counts = new Map(facets(cat, f, others).map((o) => [o.value, o.count]));
        for (const input of inputs) {
          const n = counts.get(input.value) ?? 0;
          input.checked = cur.includes(input.value);
          const chip = input.parentElement;
          chip.classList.toggle('is-zero', !n && !input.checked);
          chip.classList.toggle('is-on', input.checked);
          chip.lastElementChild.textContent = n;
        }
      },
    };
  }

  function boolControl(f) {
    const el = shell(f);
    const name = uid(f.path);
    const opt = (v, text, n = true) =>
      `<label><input type="radio" name="${name}" value="${v}"><span>${text}</span>${n ? '<span class="seg-n"></span>' : ''}</label>`;
    el.insertAdjacentHTML(
      'beforeend',
      `<div class="seg" role="radiogroup" aria-labelledby="${name}-l">${opt('any', 'Any', false)}${opt('1', 'Yes')}${opt('0', 'No')}</div>`,
    );
    const radios = $$('input', el);
    el.addEventListener('change', (e) => {
      const v = e.target.value;
      store.setFilter(f.path, v === 'any' ? null : v === '1');
    });
    return {
      field: f,
      el,
      update(state, others) {
        const cur = state.filters[f.path];
        const want = cur == null ? 'any' : cur ? '1' : '0';
        const counts = facets(cat, f, others);
        for (const r of radios) {
          r.checked = r.value === want;
          const n = r.parentElement.querySelector('.seg-n');
          if (n) n.textContent = r.value === '1' ? counts.true : counts.false;
        }
      },
    };
  }

  function rangeControl(f) {
    const b = facets(cat, f);
    if (!b) return null;
    // A single distinct value: a range would be meaningless, offer "only machines with this value".
    if (b.min === b.max) {
      const el = shell(f);
      el.insertAdjacentHTML(
        'beforeend',
        `<div class="chipset"><label class="chip"><input type="checkbox"><span class="chip-text">${esc(formatBound(f, b.min))}</span><span class="chip-n"></span></label></div>`,
      );
      const input = $('input', el);
      input.addEventListener('change', () => store.setFilter(f.path, input.checked ? [b.min, b.max] : null));
      return {
        field: f,
        el,
        update(state, others) {
          input.checked = state.filters[f.path] != null;
          input.parentElement.classList.toggle('is-on', input.checked);
          const n = others.filter((m) => value(m, f) != null).length;
          input.parentElement.lastElementChild.textContent = n;
        },
      };
    }

    const step = stepFor(f, b);
    const lo = roundTo(Math.floor(b.min / step + 1e-9) * step, step);
    const hi = roundTo(Math.ceil(b.max / step - 1e-9) * step, step);
    const pct = (v) => ((v - lo) / (hi - lo)) * 100;
    const vals = cat.machines.map((m) => value(m, f)).filter((v) => v != null);
    const el = shell(f, `<span class="range-val" aria-hidden="true"></span>`);
    const labelText = esc(f.label.toLowerCase());
    el.insertAdjacentHTML(
      'beforeend',
      `<div class="range" style="--a:0%;--b:100%">
        <div class="range-track">
          <div class="range-rail"><div class="range-ticks">${vals.map((v) => `<i style="left:${pct(v).toFixed(2)}%"></i>`).join('')}</div><div class="range-fill"></div></div>
          <input type="range" class="range-lo" min="${lo}" max="${hi}" step="${step}" value="${lo}" aria-label="Minimum ${labelText}">
          <input type="range" class="range-hi" min="${lo}" max="${hi}" step="${step}" value="${hi}" aria-label="Maximum ${labelText}">
        </div>
        <div class="range-fields">
          <label><span>Min</span><input type="number" class="num-lo" inputmode="decimal" min="${lo}" max="${hi}" step="any" placeholder="${roundTo(lo, step)}" aria-label="Minimum ${labelText}"></label>
          <span class="range-dash" aria-hidden="true">–</span>
          <label><span>Max</span><input type="number" class="num-hi" inputmode="decimal" min="${lo}" max="${hi}" step="any" placeholder="${hi}" aria-label="Maximum ${labelText}"></label>
        </div>
      </div>`,
    );
    const range = $('.range', el);
    const sLo = $('.range-lo', el);
    const sHi = $('.range-hi', el);
    const nLo = $('.num-lo', el);
    const nHi = $('.num-hi', el);
    const out = $('.range-val', el);
    const ticks = $$('.range-ticks i', el);

    const commit = (a, z) => store.setFilter(f.path, [a == null || a <= lo ? null : a, z == null || z >= hi ? null : z]);

    const onSlide = (e) => {
      let a = Number(sLo.value);
      let z = Number(sHi.value);
      if (a > z) {
        if (e.target === sLo) a = z;
        else z = a;
      }
      paint(a, z);
      commit(a, z);
    };
    sLo.addEventListener('input', onSlide);
    sHi.addEventListener('input', onSlide);

    const parse = (input) => (input.value.trim() === '' || !Number.isFinite(Number(input.value)) ? null : Number(input.value));
    const onNumber = () => {
      let a = parse(nLo);
      let z = parse(nHi);
      if (a != null && z != null && a > z) [a, z] = [z, a];
      commit(a, z);
    };
    nLo.addEventListener('change', onNumber);
    nHi.addEventListener('change', onNumber);

    function paint(a, z) {
      range.style.setProperty('--a', `${pct(a)}%`);
      range.style.setProperty('--b', `${pct(z)}%`);
      vals.forEach((v, i) => ticks[i].classList.toggle('in', v >= a && v <= z));
    }

    return {
      field: f,
      el,
      update(state) {
        const cur = state.filters[f.path];
        const a = cur?.[0] ?? lo;
        const z = cur?.[1] ?? hi;
        if (document.activeElement !== sLo) sLo.value = a;
        if (document.activeElement !== sHi) sHi.value = z;
        if (document.activeElement !== nLo) nLo.value = cur?.[0] ?? '';
        if (document.activeElement !== nHi) nHi.value = cur?.[1] ?? '';
        paint(a, z);
        el.classList.toggle('is-on', cur != null);
        out.textContent = `${formatBound(f, cur?.[0] ?? b.min)} – ${formatBound(f, cur?.[1] ?? b.max)}`;
      },
    };
  }

  // "Find a filter": narrows the sheet to matching fields or section titles.
  find.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    let any = false;
    for (const sec of sections) {
      const secHit = sec.s.title.toLowerCase().includes(q);
      let hits = 0;
      for (const c of sec.controls) {
        const f = c.field;
        const hit = !q || secHit || `${f.label} ${f.unit === 'price' ? 'eur' : (f.unit ?? '')} ${f.description ?? ''}`.toLowerCase().includes(q);
        c.el.hidden = !hit;
        hits += hit;
      }
      sec.det.hidden = !hits;
      if (q && hits) sec.det.open = true;
      any ||= hits > 0;
    }
    none.hidden = any;
  });

  const sub = $('#sheet-sub');
  const done = $('#sheet-done');

  function update(state) {
    if (!dlg.open) return;
    const all = filterMachines(cat, state);
    for (const c of controls) {
      let others = all;
      if (state.filters[c.field.path] != null) {
        const { [c.field.path]: _omit, ...rest } = state.filters;
        others = filterMachines(cat, { q: state.q, filters: rest });
      }
      c.update(state, others);
    }
    for (const sec of sections) {
      const n = sec.controls.filter((c) => state.filters[c.field.path] != null).length;
      sec.count.hidden = !n;
      sec.count.textContent = n;
      if (n && !sec.det.open && !sec.det.dataset.seen) sec.det.open = true;
      sec.det.dataset.seen = '1';
    }
    const total = cat.machines.length;
    sub.textContent = `${all.length} of ${total} machines match`;
    done.textContent = all.length ? `Show ${all.length} machine${all.length === 1 ? '' : 's'}` : 'No matches — adjust filters';
  }

  $('#sheet-reset').addEventListener('click', () => store.set({ filters: {} }));
  wireDialog(dlg, () => $('#open-filters')?.focus({ preventScroll: true }));

  return {
    open() {
      for (const sec of sections) delete sec.det.dataset.seen;
      openDialog(dlg);
      update(store.get());
    },
    close: () => closeDialog(dlg),
    update,
  };
}
