// Technical drawings as SVG strings: the to-scale isometric envelope on each card and the
// orthographic overlay (top + front view) in the comparison sheet. Pure functions, no DOM.

const COS30 = Math.cos(Math.PI / 6);
const nf = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const r = (v) => Math.round(v * 10) / 10;
const pos = (v) => (typeof v === 'number' && v > 0 ? v : null);

// Normalised working envelope. Lathes: turning length L and swing diameter D.
export function envelope(m) {
  const g = m.general ?? {};
  const l = m.lathe ?? {};
  if (g.machine_type === 'lathe' && (pos(l.swing_diameter) ?? pos(l.turning_length)) != null) {
    return { kind: 'lathe', L: pos(l.turning_length), D: pos(l.swing_diameter) };
  }
  const x = pos(g.working_x);
  const y = pos(g.working_y);
  const z = pos(g.working_z);
  if (x == null && y == null && z == null) return { kind: 'none' };
  return { kind: 'box', x, y, z };
}

// Unknown dimensions are drawn as a placeholder (60 % of the largest known one) and labelled "?".
function filled(e) {
  if (e.kind === 'lathe') {
    const L = e.L ?? e.D * 1.4;
    return [L, e.D ?? L * 0.6];
  }
  const known = [e.x, e.y, e.z].filter((v) => v != null);
  const fb = Math.max(...known) * 0.6;
  return [e.x ?? fb, e.y ?? fb, e.z ?? fb];
}

// ---------- card: isometric envelope ----------

const ISO = { W: 200, H: 142, ml: 14, mr: 40, mt: 10, mb: 24 };

function isoExtents(e) {
  if (e.kind === 'box') {
    const [X, Y, Z] = filled(e);
    return [(X + Y) * COS30, (X + Y) * 0.5 + Z];
  }
  if (e.kind === 'lathe') {
    const [L, D] = filled(e);
    return [L * 1.22, D * 1.2];
  }
  return null;
}

// One scale for every card, so the drawings are comparable at a glance.
export function isoScale(machines) {
  let s = Infinity;
  for (const m of machines) {
    const ext = isoExtents(envelope(m));
    if (!ext) continue;
    s = Math.min(s, (ISO.W - ISO.ml - ISO.mr) / ext[0], (ISO.H - ISO.mt - ISO.mb) / ext[1]);
  }
  return Number.isFinite(s) ? s : 0.3;
}

// Pick a round scale-bar length that renders between ~22 and ~60 px.
function scaleBar(s) {
  const mm = [10, 20, 50, 100, 200, 500, 1000].find((v) => v * s >= 22) ?? 1000;
  return { mm, px: mm * s };
}

function scaleBarSVG(s, x, y) {
  const { mm, px } = scaleBar(s);
  const x0 = r(x - px);
  return `<g class="sb"><path d="M${x0} ${y - 3}V${y}H${r(x)}V${y - 3}M${r(x0 + px / 2)} ${y}v-2"/><text x="${r(x)}" y="${y - 6}" text-anchor="end">${mm} mm</text></g>`;
}

const tick = (x, y, ang) => {
  const a = ((ang + 45) * Math.PI) / 180;
  const dx = Math.cos(a) * 3;
  const dy = Math.sin(a) * 3;
  return `M${r(x - dx)} ${r(y - dy)}L${r(x + dx)} ${r(y + dy)}`;
};

function dim(p0, p1, label, { off = [0, 0], rot = 0, anchor = 'middle', cls = '' } = {}) {
  const ang = (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI;
  const mx = (p0[0] + p1[0]) / 2 + off[0];
  const my = (p0[1] + p1[1]) / 2 + off[1];
  return `<g class="dim ${cls}"><path d="M${r(p0[0])} ${r(p0[1])}L${r(p1[0])} ${r(p1[1])}${tick(...p0, ang)}${tick(...p1, ang)}"/><text x="${r(mx)}" y="${r(my)}" text-anchor="${anchor}" dominant-baseline="central"${rot ? ` transform="rotate(${rot} ${r(mx)} ${r(my)})"` : ''}>${label}</text></g>`;
}

const fmtDim = (v, known) => (known ? nf.format(v) : '?');

export function isoSVG(m, s, title = '') {
  const e = envelope(m);
  const aria = `role="img" aria-label="${title || 'Working envelope'}"`;
  if (e.kind === 'none') return naSVG(aria);
  if (e.kind === 'lathe') return latheSVG(e, s, aria);
  const [X, Y, Z] = filled(e);
  const P = (x, y, z) => [(x - y) * COS30 * s, ((x + y) * 0.5 - z) * s];
  const minU = -Y * COS30 * s;
  const maxU = X * COS30 * s;
  const minV = -Z * s;
  const maxV = (X + Y) * 0.5 * s;
  const aw = ISO.W - ISO.ml - ISO.mr;
  const ah = ISO.H - ISO.mt - ISO.mb;
  const tx = ISO.ml + (aw - (maxU - minU)) / 2 - minU;
  const ty = ISO.mt + ah - maxV; // bottom-aligned: every card stands on the same ground line
  const T = ([u, v]) => [u + tx, v + ty];
  const Q = (x, y, z) => T(P(x, y, z));
  const pts = (...ps) => ps.map((p) => `${r(p[0])},${r(p[1])}`).join(' ');
  const [A, B, C, D, E, F, G, H] = [
    Q(0, 0, 0), Q(X, 0, 0), Q(X, Y, 0), Q(0, Y, 0), Q(0, 0, Z), Q(X, 0, Z), Q(X, Y, Z), Q(0, Y, Z),
  ];
  const unknown = e.x == null || e.y == null || e.z == null;
  const o = 9 / s; // dimension offset: 9 px in world units
  const ext = (a, b) => `M${r(a[0])} ${r(a[1])}L${r(b[0])} ${r(b[1])}`;
  const xd0 = Q(0, Y + o, 0);
  const xd1 = Q(X, Y + o, 0);
  const yd0 = Q(X + o, 0, 0);
  const yd1 = Q(X + o, Y, 0);
  const zx = B[0] + 11;
  return `<svg class="iso${unknown ? ' partial' : ''}" viewBox="0 0 ${ISO.W} ${ISO.H}" ${aria}>
<polygon class="f-top" points="${pts(E, F, G, H)}"/><polygon class="f-right" points="${pts(B, C, G, F)}"/><polygon class="f-left" points="${pts(C, D, H, G)}"/>
<path class="hid" d="${ext(A, B)}${ext(A, D)}${ext(A, E)}"/>
<path class="vis" d="${ext(B, C)}${ext(C, D)}${ext(B, F)}${ext(C, G)}${ext(D, H)}${ext(E, F)}${ext(F, G)}${ext(G, H)}${ext(H, E)}"/>
<path class="ext" d="${ext(D, Q(0, Y + o + 3 / s, 0))}${ext(C, Q(X, Y + o + 3 / s, 0))}${ext(B, Q(X + o + 3 / s, 0, 0))}${ext(C, Q(X + o + 3 / s, Y, 0))}${ext([B[0] + 3, B[1]], [zx + 3, B[1]])}${ext([F[0] + 3, F[1]], [zx + 3, F[1]])}"/>
${dim(xd0, xd1, fmtDim(X, e.x != null), { off: [-5.2, 3], rot: 30, cls: e.x == null ? 'q' : '' })}
${dim(yd0, yd1, fmtDim(Y, e.y != null), { off: [5.2, 3], rot: -30, cls: e.y == null ? 'q' : '' })}
${dim([zx, B[1]], [zx, F[1]], fmtDim(Z, e.z != null), { off: [5, 0], anchor: 'start', cls: e.z == null ? 'q' : '' })}
${scaleBarSVG(s, ISO.W - 4, ISO.H - 3)}
</svg>`;
}

function latheSVG(e, s, aria) {
  const [L, D] = filled(e);
  const w = L * s;
  const h = D * s;
  const chuck = Math.max(6, w * 0.1);
  const aw = ISO.W - ISO.ml - ISO.mr;
  const ah = ISO.H - ISO.mt - ISO.mb;
  const x0 = ISO.ml + (aw - (w + chuck)) / 2 + chuck;
  const y1 = ISO.mt + ah - h * 0.1;
  const y0 = y1 - h;
  const cy = (y0 + y1) / 2;
  const ch = h * 1.18;
  const dx = x0 + w + 11;
  return `<svg class="iso lathe${e.L == null || e.D == null ? ' partial' : ''}" viewBox="0 0 ${ISO.W} ${ISO.H}" ${aria}>
<rect class="chuck" x="${r(x0 - chuck)}" y="${r(cy - ch / 2)}" width="${r(chuck)}" height="${r(ch)}"/>
<rect class="f-top" x="${r(x0)}" y="${r(y0)}" width="${r(w)}" height="${r(h)}"/>
<path class="vis" d="M${r(x0)} ${r(y0)}h${r(w)}v${r(h)}h${r(-w)}z"/>
<path class="cl" d="M${r(x0 - chuck - 5)} ${r(cy)}H${r(x0 + w + 6)}"/>
<path class="ext" d="M${r(x0)} ${r(y1 + 3)}v8M${r(x0 + w)} ${r(y1 + 3)}v8M${r(x0 + w + 3)} ${r(y0)}h11M${r(x0 + w + 3)} ${r(y1)}h11"/>
${dim([x0, y1 + 9], [x0 + w, y1 + 9], fmtDim(L, e.L != null), { off: [0, 7] })}
${dim([dx, y1], [dx, y0], `Ø${fmtDim(D, e.D != null)}`, { off: [5, 0], anchor: 'start' })}
${scaleBarSVG(s, ISO.W - 4, ISO.H - 3)}
</svg>`;
}

function naSVG(aria) {
  const c = [100, 64];
  const k = 30;
  const P = (x, y, z) => [c[0] + (x - y) * COS30 * k, c[1] + ((x + y) * 0.5 - z) * k];
  const pts = (...ps) => ps.map((p) => p.map(r).join(',')).join(' ');
  const [B, C, D, E, F, G, H] = [P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)];
  return `<svg class="iso na" viewBox="0 0 ${ISO.W} ${ISO.H}" ${aria}>
<polygon class="hid" points="${pts(E, F, G, H)}"/><polyline class="hid" points="${pts(H, D, C, B, F)}"/><path class="hid" d="M${pts(C)}L${pts(G)}"/>
<text class="na-q" x="${c[0]}" y="${c[1] + 8}" text-anchor="middle" dominant-baseline="central">?</text>
<text class="na-t" x="${c[0]}" y="${ISO.H - 10}" text-anchor="middle">ENVELOPE N/A</text>
</svg>`;
}

// ---------- comparison: orthographic overlay ----------

// Plan dimensions for the overlay; lathes project as L × Ø × Ø.
function plan(m) {
  const e = envelope(m);
  if (e.kind === 'lathe') return { x: e.L, y: e.D, z: e.D, lathe: true };
  if (e.kind === 'box') return { x: e.x, y: e.y, z: e.z, lathe: false };
  return { x: null, y: null, z: null, lathe: false };
}

export const STYLES = ['s-a', 's-b', 's-c', 's-d'];

function niceStep(s) {
  return [10, 20, 25, 50, 100, 200, 250, 500].find((v) => v * s >= 26) ?? 1000;
}

const OM = { l: 40, r: 30, t: 16, b: 26 };

function view(items, key, s, W, maxH, label, k) {
  const M = OM;
  const H = M.t + M.b + maxH * s;
  const ox = M.l;
  const oy = H - M.b;
  const step = niceStep(s);
  const gx = Math.floor((W - M.l - M.r) / s / step);
  const gy = Math.floor(maxH / step);
  let grid = '';
  let labels = '';
  for (let i = 0; i <= gx; i++) {
    const x = r(ox + i * step * s);
    grid += `M${x} ${M.t - 6}V${oy}`;
    if (i % 2 === 0) labels += `<text x="${x}" y="${r(oy + 14)}" text-anchor="middle">${i * step}</text>`;
  }
  for (let j = 0; j <= gy; j++) {
    const y = r(oy - j * step * s);
    grid += `M${ox} ${y}H${r(W - M.r + 6)}`;
    if (j % 2 === 0 && j) labels += `<text x="${ox - 6}" y="${y}" text-anchor="end" dominant-baseline="central">${j * step}</text>`;
  }
  const drawn = items.filter((it) => it.p.x != null && it.p[key] != null);
  // Key tags sit at each rectangle's far corner; nudge overlapping tags apart.
  const tags = drawn
    .map((it) => ({ it, x: ox + it.p.x * s, y: oy - it.p[key] * s }))
    .sort((a, b) => a.y - b.y || b.x - a.x);
  for (let i = 1; i < tags.length; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.abs(tags[i].x - tags[j].x) < 16 && Math.abs(tags[i].y - tags[j].y) < 15) tags[i].y = tags[j].y + 15;
    }
  }
  const rects = drawn
    .map(({ p, style }) => `<rect class="env ${style}" x="${ox}" y="${r(oy - p[key] * s)}" width="${r(p.x * s)}" height="${r(p[key] * s)}"/>`)
    .join('');
  const tagSVG = tags
    .map(({ it, x, y }) => `<g class="tag ${it.style}" transform="translate(${r(Math.min(x + 3, W - 15))} ${r(Math.max(y - 13, 1))})"><rect width="13" height="12"/><text x="6.5" y="6.5" text-anchor="middle" dominant-baseline="central">${it.key}</text></g>`)
    .join('');
  const axisY = key === 'y' ? 'Y' : 'Z';
  return `<svg class="ortho" viewBox="0 0 ${W} ${r(H)}" style="width:${r(W * k)}px" role="img" aria-label="${label}">
<path class="grid" d="${grid}"/>
<path class="axis" d="M${ox} ${M.t - 8}V${oy}H${W - M.r + 8}"/>
<g class="ticks">${labels}</g>
<text class="ax" x="${W - M.r + 10}" y="${oy}" dominant-baseline="central">X</text>
<text class="ax" x="${ox}" y="${M.t - 12}" text-anchor="middle">${axisY}</text>
${rects}${tagSVG}
</svg>`;
}

// entries: [{ key: 'A', m, style }] → { top, front, items } drawn at one common scale.
// maxW / maxH bound the drawing area in viewBox units; k is the on-screen px per unit.
export function overlay(entries, { maxW = 560, maxH = 250, k = 1 } = {}) {
  const items = entries.map((e) => ({ ...e, p: plan(e.m) }));
  const maxOf = (k) => Math.max(0, ...items.map((it) => it.p[k] ?? 0));
  const maxX = maxOf('x');
  const maxY = maxOf('y');
  const maxZ = maxOf('z');
  if (!maxX || (!maxY && !maxZ)) return null;
  const s = Math.min((maxW - OM.l - OM.r) / maxX, maxH / Math.max(maxY, maxZ, 1));
  const W = Math.ceil(OM.l + OM.r + maxX * s);
  return {
    s,
    top: maxY ? view(items, 'y', s, W, maxY, 'Top view, working area X by Y, to scale', k) : '',
    front: maxZ ? view(items, 'z', s, W, maxZ, 'Front view, working area X by Z, to scale', k) : '',
    items,
  };
}

// Tiny line-style swatch used in legends and machine headers.
export const swatch = (style) =>
  `<svg class="swatch" viewBox="0 0 28 8" aria-hidden="true"><path class="env ${style}" d="M1 4H27"/></svg>`;

// Third-angle projection symbol, a drafting-sheet detail.
export const projectionSymbol = `<svg class="proj" viewBox="0 0 44 20" aria-hidden="true"><path d="M2 2 L16 5 V15 L2 18 Z"/><circle cx="32" cy="10" r="8"/><circle cx="32" cy="10" r="3.5"/><path class="cl" d="M0 10H44M32 0V20"/></svg>`;
