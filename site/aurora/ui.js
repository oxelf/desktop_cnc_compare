// Small helpers shared by the Aurora modules: escaping, images, badges, motion, toasts.
import { formatValue } from '../core/core.js';
import { ICONS, icon } from '../core/icons.js';

// Two extra Lucide icons (ISC License) this design needs; registered locally, core stays untouched.
Object.assign(ICONS, {
  'refresh-cw':
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'cloud-off':
    '<path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>',
});

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

// Only http(s) links reach an href or src.
export const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

export const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const platform = navigator.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;
export const MOD = /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl';

// View Transitions with a plain fallback. Returns the transition (or null).
export function transition(update) {
  if (!document.startViewTransition || reducedMotion.matches || document.visibilityState !== 'visible') {
    update();
    return null;
  }
  const vt = document.startViewTransition(update);
  vt.finished.catch(() => {});
  vt.ready.catch(() => {});
  return vt;
}

// Replace every [data-icon] placeholder with its inline SVG.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.innerHTML = icon(el.dataset.icon, { size: Number(el.dataset.size) || 18 });
    el.classList.add('ico');
    el.removeAttribute('data-icon');
  }
}

// Remember outcomes so re-rendered images (compare, tray, palette) don't flash their loading state.
const loaded = new Set();
const failed = new Set();

// Product image on a soft light pool. Large variants add an "ambient" copy: the same image,
// cover-fit and heavily blurred, so dark photos bleed to the edges while white-background
// studio shots dissolve into the light. The placeholder is part of the markup, shown on error.
export function productImage(m, cls = '', { ambient = true } = {}) {
  const src = safeUrl(m.image_url);
  const attrs = `src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"`;
  const img = src ? `${ambient ? `<img class="pool-amb" ${attrs} aria-hidden="true">` : ''}<img class="pool-img" ${attrs}>` : '';
  const state = !src || failed.has(src) ? ' is-broken' : loaded.has(src) ? ' is-loaded' : '';
  return `<div class="pool ${cls}${ambient ? '' : ' is-flat'}${state}">${img}<span class="pool-fallback">${icon('image-off', { size: 22 })}<span>No image</span></span></div>`;
}

// One capture listener handles every product image on the page.
export function watchImages() {
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      failed.add(img.getAttribute('src'));
      img.closest('.pool')?.classList.add('is-broken');
    },
    true,
  );
  document.addEventListener(
    'load',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      loaded.add(img.getAttribute('src'));
      img.closest('.pool')?.classList.add('is-loaded');
    },
    true,
  );
}

const STAGE_ICONS = { preorder: 'calendar', crowdfunding: 'zap', announced: 'sparkles', discontinued: 'x' };

export function stageBadge(cat, m) {
  const stage = m.stage ?? 'available';
  const text = formatValue(cat.field('stage'), stage);
  const ic = STAGE_ICONS[stage] ? icon(STAGE_ICONS[stage], { size: 12 }) : '<span class="stage-dot" aria-hidden="true"></span>';
  return `<span class="stage stage-${esc(stage)}">${ic}<span>${esc(text)}</span></span>`;
}

const toastRoot = () => document.getElementById('toasts');

export function toast(message, ic = 'check') {
  const root = toastRoot();
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${icon(ic, { size: 16 })}<span>${esc(message)}</span>`;
  root.append(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  setTimeout(() => el.classList.add('is-out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

// Open/close a <dialog> with an exit animation (CSS handles [data-closing]).
export function openDialog(dlg) {
  if (dlg.open) return;
  dlg.removeAttribute('data-closing');
  dlg.showModal();
}

export function closeDialog(dlg) {
  if (!dlg.open || dlg.hasAttribute('data-closing')) return;
  if (reducedMotion.matches) {
    dlg.close();
    return;
  }
  dlg.setAttribute('data-closing', '');
  const done = () => {
    dlg.removeAttribute('data-closing');
    dlg.close();
  };
  const panel = dlg.firstElementChild;
  panel.addEventListener('animationend', done, { once: true });
  setTimeout(() => dlg.open && dlg.hasAttribute('data-closing') && done(), 400);
}

// Escape animates the close instead of the native instant close; backdrop click closes too.
export function wireDialog(dlg, onClose) {
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialog(dlg);
  });
  // A drag that starts inside (e.g. on a slider) and ends on the backdrop must not close it.
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === dlg;
  });
  dlg.addEventListener('click', (e) => {
    if ((e.target === dlg && downOnBackdrop) || e.target.closest('[data-close]')) closeDialog(dlg);
  });
  dlg.addEventListener('close', () => onClose?.());
}
