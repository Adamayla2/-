/**
 * ui-helpers.js — small reusable rendering + interaction helpers shared by
 * every screen module. Kept dependency-free (no framework) on purpose.
 */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function toast(message, { error = false, timeout = 4200 } = {}) {
  const stack = document.getElementById('toast-stack');
  const node = el('div', { class: 'toast' + (error ? ' error' : '') }, message);
  stack.appendChild(node);
  setTimeout(() => node.remove(), timeout);
}

export function openModal(contentNode) {
  const root = document.getElementById('modal-root');
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal' }, contentNode);
  backdrop.appendChild(modal);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  function close() { backdrop.remove(); }
  root.appendChild(backdrop);
  return close;
}

/** Simple typed confirm() replacement returning a Promise<boolean>, styled to match the app. */
export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const wrap = el('div', {}, [
      el('h2', {}, title),
      el('p', { class: 'hint' }, body),
    ]);
    const actions = el('div', { style: 'display:flex; gap:8px; justify-content:flex-end; margin-top:16px;' });
    const cancelBtn = el('button', { class: 'ghost', onclick: () => { close(); resolve(false); } }, 'Cancel');
    const okBtn = el('button', { class: danger ? 'danger' : 'primary', onclick: () => { close(); resolve(true); } }, confirmLabel);
    actions.append(cancelBtn, okBtn);
    wrap.appendChild(actions);
    const close = openModal(wrap);
  });
}

// ---------------------------------------------------------------------------
// Confidence gauge (signature visual element) — a small dial, filled
// proportionally to confidence, colored by field status.
// ---------------------------------------------------------------------------
const STATUS_COLOR = {
  blank: 'var(--conf-blank)',
  na: 'var(--conf-blank)',
  uncertain: 'var(--conf-low)',
};
function colorForConfidence(status, confidence) {
  if (status === 'blank' || status === 'na') return 'var(--conf-blank)';
  if (status === 'uncertain') return 'var(--conf-low)';
  if (confidence >= 90) return 'var(--conf-high)';
  if (confidence >= 60) return 'var(--conf-medium)';
  return 'var(--conf-low)';
}

export function confidenceGauge(status, confidence, size = 20) {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const pct = status === 'blank' || status === 'na' ? 0 : Math.max(0, Math.min(100, confidence)) / 100;
  const color = colorForConfidence(status, confidence);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'gauge');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const cx = size / 2, cy = size / 2;
  const track = document.createElementNS(ns, 'circle');
  track.setAttribute('class', 'track');
  track.setAttribute('cx', cx); track.setAttribute('cy', cy); track.setAttribute('r', r);
  track.setAttribute('stroke-width', 2.5);
  svg.appendChild(track);
  if (pct > 0) {
    const fill = document.createElementNS(ns, 'circle');
    fill.setAttribute('class', 'fill');
    fill.setAttribute('cx', cx); fill.setAttribute('cy', cy); fill.setAttribute('r', r);
    fill.setAttribute('stroke-width', 2.5);
    fill.setAttribute('stroke', color);
    fill.setAttribute('stroke-dasharray', `${c * pct} ${c}`);
    svg.appendChild(fill);
  } else {
    track.setAttribute('stroke', color);
    track.style.opacity = 0.5;
  }
  return svg;
}

export function statusClass(status, confidence) {
  if (status === 'blank' || status === 'na') return 'status-blank';
  if (status === 'uncertain') return 'status-uncertain';
  return confidence >= 90 ? 'status-extracted-high' : 'status-extracted-medium';
}

export function confidenceBadge(status, confidence) {
  const cls = statusClass(status, confidence);
  const label = status === 'blank' ? 'Blank on form'
    : status === 'na' ? 'Not determinable'
    : status === 'uncertain' ? 'Needs review'
    : `${confidence}% confident`;
  return el('span', { class: `confidence-badge ${cls}` }, [confidenceGauge(status, confidence, 14), ' ' + label]);
}

export function formatFieldValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  return String(value) + (field.unit ? ` ${field.unit}` : '');
}
