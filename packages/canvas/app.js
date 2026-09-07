/* Framelab canvas.
 *
 * Three ideas drive the UI:
 *   1. The inspector is persistent and contextual. A property interaction is a
 *      small popover anchored to its field, never a full-height overlay that
 *      buries the panel it belongs to.
 *   2. Selection is a first-class model: hover, select, parent/child, keyboard.
 *      The canvas and the inspector are two views of one selection.
 *   3. Every edit is a variant-aware token edit, so responsive and state styles
 *      are editable values rather than strings you have to hand-write.
 */
'use strict';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const QS = new URLSearchParams(location.search);
const SERVER_URL = QS.get('server') || `${location.protocol}//${location.hostname}:3131`;
const APP_URL = QS.get('app') || 'http://localhost:3134';
const WS_URL = SERVER_URL.replace(/^http/, 'ws');

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MOD = IS_MAC ? '⌘' : 'Ctrl';

const BREAKPOINTS = [
  { key: '', label: 'Base', min: 0 },
  { key: 'sm', label: 'sm', min: 640 },
  { key: 'md', label: 'md', min: 768 },
  { key: 'lg', label: 'lg', min: 1024 },
  { key: 'xl', label: 'xl', min: 1280 },
  { key: '2xl', label: '2xl', min: 1536 },
];
// Shown inline in the state row; the rest live behind the overflow menu so the
// row never has to squeeze six labels into 290px.
const STATES_INLINE = [
  { key: '', label: 'Default' },
  { key: 'hover', label: 'Hover' },
  { key: 'focus', label: 'Focus' },
];
const STATES_MORE = [
  { key: 'active', label: 'Active' },
  { key: 'focus-visible', label: 'Focus visible' },
  { key: 'disabled', label: 'Disabled' },
  { key: 'dark', label: 'Dark mode' },
  { key: 'group-hover', label: 'Group hover' },
  { key: 'peer-focus', label: 'Peer focus' },
  { key: 'first', label: 'First child' },
  { key: 'last', label: 'Last child' },
  { key: 'odd', label: 'Odd child' },
  { key: 'even', label: 'Even child' },
];
const BREAKPOINT_KEYS = new Set(BREAKPOINTS.map((b) => b.key).filter(Boolean));
const VIEWPORTS = [
  { key: 'fit', label: 'Fit', width: null },
  { key: 'sm', label: '390', width: 390 },
  { key: 'md', label: '768', width: 768 },
  { key: 'lg', label: '1024', width: 1024 },
  { key: 'xl', label: '1280', width: 1280 },
];

const ICONS = {
  chev: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',
  chevDown: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  caret: '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" opacity="0.85"/></svg>',
  folderOpen: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H8l-3 9h17l-1.39 4.17A2 2 0 0 1 19 20z" opacity="0.85"/></svg>',
  file: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/></svg>',
  sun: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  moon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  panelLeft: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
  panelRight: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
  undo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
  redo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>',
  refresh: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  link: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  unlink: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h2a5 5 0 0 1 0 10h-2M9 17H7A5 5 0 0 1 7 7h2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>',
  agent: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="12" rx="2"/><path d="M12 7V4"/><circle cx="9" cy="13" r="1.2" fill="currentColor"/><circle cx="15" cy="13" r="1.2" fill="currentColor"/></svg>',
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 9.5 17 19 7.5"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  lock: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function basename(p) {
  const parts = String(p || '').split('/');
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

const UI = {
  theme: 'dark',
  collapsedSections: new Set(),
  collapsedFolders: new Set(),
  collapsedPanels: new Set(),
  collapsedLayers: new Set(),
  panels: { left: true, right: true },
  rightWidth: 290,
  autoCommit: false,
  viewport: 'fit',
  linked: { padding: true, margin: true },
};
const RIGHT_MIN = 250;
const RIGHT_MAX = 620;
const RIGHT_DEFAULT = 290;

function loadUiPrefs() {
  try {
    UI.theme = localStorage.getItem('fl-theme') || 'dark';
    UI.collapsedSections = new Set(JSON.parse(localStorage.getItem('fl-collapsed-sections') || '[]'));
    UI.collapsedFolders = new Set(JSON.parse(localStorage.getItem('fl-collapsed-folders') || '[]'));
    UI.collapsedPanels = new Set(JSON.parse(localStorage.getItem('fl-collapsed-panels') || '[]'));
    const p = JSON.parse(localStorage.getItem('fl-panels') || 'null');
    if (p) UI.panels = { left: p.left !== false, right: p.right !== false };
    const w = parseInt(localStorage.getItem('fl-right-width') || '', 10);
    UI.rightWidth = (w >= RIGHT_MIN && w <= RIGHT_MAX) ? w : RIGHT_DEFAULT;
    UI.autoCommit = localStorage.getItem('fl-auto-commit') === 'true';
    UI.viewport = localStorage.getItem('fl-viewport') || 'fit';
    const linked = JSON.parse(localStorage.getItem('fl-linked') || 'null');
    if (linked) UI.linked = linked;
  } catch {}
}
function saveUiPrefs() {
  try {
    localStorage.setItem('fl-theme', UI.theme);
    localStorage.setItem('fl-collapsed-sections', JSON.stringify([...UI.collapsedSections]));
    localStorage.setItem('fl-collapsed-folders', JSON.stringify([...UI.collapsedFolders]));
    localStorage.setItem('fl-collapsed-panels', JSON.stringify([...UI.collapsedPanels]));
    localStorage.setItem('fl-panels', JSON.stringify(UI.panels));
    localStorage.setItem('fl-right-width', String(UI.rightWidth));
    localStorage.setItem('fl-auto-commit', String(UI.autoCommit));
    localStorage.setItem('fl-viewport', UI.viewport);
    localStorage.setItem('fl-linked', JSON.stringify(UI.linked));
  } catch {}
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  ws: null,
  reconnectTimer: null,
  files: [],
  rootDir: '',
  currentFilePath: null,
  snapshot: null,
  selected: null,          // element record from the snapshot
  selectedKey: null,       // stableKey — survives our own edits
  selectedDomId: null,     // framelabId last seen in the DOM
  selectedRect: null,
  selectedComputed: null,
  hoverId: null,
  dragging: null,
  breakpoint: '',
  variantState: '',
  pendingEdits: [],
  pendingText: undefined,
  editTimer: null,
  undoStack: [],
  redoStack: [],
  suppressRenderUntil: 0,
};

// ---------------------------------------------------------------------------
// Status + toasts
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  connecting: 'connecting', connected: 'connected',
  syncing: 'saving', disconnected: 'disconnected',
};
function setStatus(s) {
  const el = $('status');
  el.querySelector('.dot').className = 'dot ' + s;
  el.querySelector('.status-text').textContent = STATUS_LABELS[s] || s;
}
let statusTimer = null;
function flashStatus() {
  setStatus('syncing');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => setStatus('connected'), 260);
}

function toast(message, opts = {}) {
  const host = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (opts.error ? ' error' : '');
  el.innerHTML = `<span class="toast-dot"></span><span></span>`;
  el.querySelector('span:last-child').textContent = message;
  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = opts.actionLabel;
    btn.onclick = () => { opts.onAction(); el.remove(); };
    el.appendChild(btn);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), opts.duration || (opts.error ? 5000 : 2600));
  return el;
}
function toastError(message) {
  console.warn('[framelab]', message);
  toast(message, { error: true });
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function api(method, path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((payload && (payload.error || payload.detail)) || `${method} ${path} -> ${res.status}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function connectWS() {
  setStatus('connecting');
  try {
    const ws = new WebSocket(WS_URL);
    state.ws = ws;
    ws.addEventListener('open', () => setStatus('connected'));
    ws.addEventListener('close', () => {
      setStatus('disconnected');
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(connectWS, 1500);
    });
    ws.addEventListener('error', () => {});
    ws.addEventListener('message', onWsMessage);
  } catch {
    setStatus('disconnected');
    state.reconnectTimer = setTimeout(connectWS, 1500);
  }
}

function onWsMessage(e) {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }
  switch (msg.type) {
    case 'DIFF_SYNC': renderDiff(msg.diff); break;
    case 'THEME_SYNC':
      applyTheme(msg.theme);
      if (state.selected && !inspectorHasFocus()) renderInspector();
      break;
    case 'DISCARD_ALL':
      if (state.currentFilePath) loadFile(state.currentFilePath);
      reloadIframe();
      break;
    case 'FILE_ERROR':
      toastError(`${basename(msg.filePath)}: ${msg.error}`);
      break;
    case 'FILE_SYNC': onFileSync(msg.snapshot, msg.source); break;
  }
}

function onFileSync(snap, source) {
  if (!snap || snap.filePath !== state.currentFilePath) return;
  state.snapshot = snap;
  renderLayerTree();

  if (state.selectedKey) {
    const next = findByStableKey(state.selectedKey) || findByFramelabId(state.selectedDomId);
    if (next) {
      state.selected = next;
      // Re-rendering while the user is inside a control would steal focus and
      // drop the caret mid-typing. Patch the read-only parts instead.
      if (inspectorHasFocus()) {
        renderClassNameFoot();
      } else {
        renderInspector();
      }
    } else {
      clearSelection();
    }
  }
  if (source === 'update') flashStatus();
}

function inspectorHasFocus() {
  const active = document.activeElement;
  if (!active) return false;
  const pane = $('pane-inspector');
  const pop = $('popover');
  return (pane && pane.contains(active)) || (pop && pop.contains(active) && pop.classList.contains('show'));
}

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

const DEFAULT_PRESETS = [
  { name: 'transparent', value: 'transparent' },
  { name: 'white', value: '#ffffff' },
  { name: 'black', value: '#000000' },
  { name: 'zinc-100', value: '#f4f4f5' }, { name: 'zinc-300', value: '#d4d4d8' },
  { name: 'zinc-500', value: '#71717a' }, { name: 'zinc-700', value: '#3f3f46' },
  { name: 'zinc-900', value: '#18181b' }, { name: 'zinc-950', value: '#09090b' },
  { name: 'red-500', value: '#ef4444' }, { name: 'orange-500', value: '#f97316' },
  { name: 'amber-500', value: '#f59e0b' }, { name: 'yellow-500', value: '#eab308' },
  { name: 'green-500', value: '#22c55e' }, { name: 'emerald-500', value: '#10b981' },
  { name: 'teal-500', value: '#14b8a6' }, { name: 'cyan-500', value: '#06b6d4' },
  { name: 'blue-500', value: '#3b82f6' }, { name: 'blue-600', value: '#2563eb' },
  { name: 'indigo-500', value: '#6366f1' }, { name: 'violet-500', value: '#8b5cf6' },
  { name: 'purple-500', value: '#a855f7' }, { name: 'pink-500', value: '#ec4899' },
  { name: 'rose-500', value: '#f43f5e' },
];
const DEFAULT_TOKENS = {
  spacing: ['px','0','0.5','1','1.5','2','2.5','3','3.5','4','5','6','7','8','9','10','11','12','14','16','20','24','28','32','36','40','44','48','52','56','60','64','72','80','96'],
  fontSize: ['xs','sm','base','lg','xl','2xl','3xl','4xl','5xl','6xl','7xl','8xl','9xl'],
  borderRadius: ['none','sm','DEFAULT','md','lg','xl','2xl','3xl','full'],
  boxShadow: ['DEFAULT','sm','md','lg','xl','2xl','inner','none'],
  fontWeight: ['thin','extralight','light','normal','medium','semibold','bold','extrabold','black'],
  fontFamily: ['sans','serif','mono'],
};
function emptyPartition(list) { return { all: list, custom: [], defaults: list }; }

let COLORS = { custom: [], defaults: DEFAULT_PRESETS };
let COLOR_HEX = Object.fromEntries(DEFAULT_PRESETS.map((c) => [c.name, c.value]));
let TOKENS = Object.fromEntries(
  Object.entries(DEFAULT_TOKENS).map(([k, v]) => [k, emptyPartition(v)])
);

function applyTheme(payload) {
  const t = payload && payload.tokens;
  if (!t) {
    COLORS = { custom: [], defaults: DEFAULT_PRESETS };
    COLOR_HEX = Object.fromEntries(DEFAULT_PRESETS.map((c) => [c.name, c.value]));
    TOKENS = Object.fromEntries(Object.entries(DEFAULT_TOKENS).map(([k, v]) => [k, emptyPartition(v)]));
    return;
  }
  const colors = t.colors || {};
  COLORS = {
    custom: colors.custom || [],
    defaults: (colors.defaults && colors.defaults.length) ? colors.defaults : DEFAULT_PRESETS,
  };
  COLOR_HEX = Object.fromEntries(
    [...DEFAULT_PRESETS, ...(colors.all || [])].map((c) => [c.name, c.value])
  );
  const pick = (cat) => {
    const v = t[cat];
    if (!v || !v.all || !v.all.length) return emptyPartition(DEFAULT_TOKENS[cat]);
    return v;
  };
  TOKENS = {
    spacing: pick('spacing'),
    fontSize: pick('fontSize'),
    borderRadius: pick('borderRadius'),
    boxShadow: pick('boxShadow'),
    fontWeight: pick('fontWeight'),
    fontFamily: t.fontFamily && t.fontFamily.all && t.fontFamily.all.length
      ? t.fontFamily : emptyPartition(DEFAULT_TOKENS.fontFamily),
  };
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function normalizeColorValue(v) {
  if (v == null) return null;
  v = String(v).trim();
  if (!v) return null;
  if (v.startsWith('[') && v.endsWith(']')) return v;
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return `[${v}]`;
  if (/^[0-9a-fA-F]{6}$/.test(v) || /^[0-9a-fA-F]{3}$/.test(v)) return `[#${v}]`;
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(v)) return `[${v.replace(/\s+/g, '_')}]`;
  return v;
}
function normalizeLengthValue(v) {
  if (v == null) return null;
  v = String(v).trim();
  if (!v) return null;
  if (v.startsWith('[') && v.endsWith(']')) return v;
  if (/^-?\d*\.?\d+(px|rem|em|%|vh|vw|pt|ch)$/i.test(v)) return `[${v}]`;
  return v;
}
const COLOR_PROPS = new Set(['background', 'textColor', 'borderColor', 'shadowColor']);
const LENGTH_PROPS = new Set([
  'padding', 'margin', 'gap', 'width', 'height', 'minWidth', 'minHeight',
  'maxWidth', 'maxHeight', 'fontSize', 'lineHeight', 'letterSpacing', 'borderWidth',
  'top', 'right', 'bottom', 'left', 'inset',
]);
function normalizeForProp(prop, value) {
  if (COLOR_PROPS.has(prop)) return normalizeColorValue(value);
  if (LENGTH_PROPS.has(prop)) return normalizeLengthValue(value);
  return value === '' || value == null ? null : String(value);
}

const _probe = document.createElement('div');
function cssColorToHex(css) {
  if (!css) return null;
  _probe.style.color = '';
  _probe.style.color = css;
  if (!_probe.style.color) return null;
  document.body.appendChild(_probe);
  const computed = getComputedStyle(_probe).color;
  document.body.removeChild(_probe);
  const m = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
}
function colorToCss(v) {
  if (!v) return null;
  v = String(v).trim();
  if (!v) return null;
  const slash = v.lastIndexOf('/');
  if (slash > 0 && !v.startsWith('[')) v = v.slice(0, slash);
  if (v.startsWith('[') && v.endsWith(']')) return v.slice(1, -1).replace(/_/g, ' ');
  if (v.startsWith('#')) return v;
  if (COLOR_HEX[v]) return COLOR_HEX[v];
  return null;
}
function previewColor(value, computedFallback) {
  return colorToCss(value) || computedFallback || null;
}

// ---------------------------------------------------------------------------
// Selection model
// ---------------------------------------------------------------------------

function elements() {
  return (state.snapshot && state.snapshot.elements) || [];
}
function findByStableKey(key) {
  if (!key) return null;
  return elements().find((e) => e.stableKey === key) || null;
}
function findByFramelabId(id) {
  if (!id) return null;
  const exact = elements().find((e) => e.framelabId === id);
  if (exact) return exact;
  const parts = String(id).split('|');
  const tag = parts[0];
  const line = Number(parts[parts.length - 2]);
  return elements().find((e) => e.tagName === tag && e.line === line) || null;
}
function filePathFromId(id) {
  const i1 = id.indexOf('|');
  const i3 = id.lastIndexOf('|');
  const i2 = id.lastIndexOf('|', i3 - 1);
  if (i1 < 0 || i2 < 0 || i3 < 0) return null;
  return id.slice(i1 + 1, i2);
}
function ancestorsOf(el) {
  const chain = [];
  let cur = el;
  const byId = new Map(elements().map((e) => [e.framelabId, e]));
  let guard = 0;
  while (cur && cur.parentId && guard++ < 40) {
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  return chain;
}
function childrenOf(el) {
  return elements().filter((e) => e.parentId === el.framelabId);
}
function siblingsOf(el) {
  return elements().filter((e) => e.parentId === el.parentId);
}

function selectElement(el, opts = {}) {
  if (!el) return;
  state.selected = el;
  state.selectedKey = el.stableKey;
  state.selectedDomId = el.framelabId;
  if (!UI.panels.right) setPanel('right', true);
  switchTab('inspector');
  renderLayerTree();
  renderInspector();
  publishSelection();
  if (opts.fromCanvas) return;
  // Ask the page to measure it so the outline lands in the right place.
  postToIframe({ type: 'FRAMELAB_SELECT', framelabId: el.framelabId, scroll: true });
}

// Publish what the user is pointing at, so `framelab mcp` — a different
// process entirely — can answer "this button" without searching the codebase.
let publishTimer = null;
function publishSelection() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    const el = state.selected;
    const body = el
      ? {
          selected: true,
          framelabId: el.framelabId,
          stableKey: el.stableKey,
          filePath: state.currentFilePath,
          breakpoint: state.breakpoint,
          state: state.variantState,
          viewportWidth: Math.round($('iframe-shell').getBoundingClientRect().width),
          computed: state.selectedComputed,
          rect: state.selectedRect,
        }
      : { selected: false };
    api('POST', '/selection', body).catch(() => {});
  }, 120);
}

function clearSelection() {
  state.selected = null;
  state.selectedKey = null;
  state.selectedDomId = null;
  state.selectedRect = null;
  state.selectedComputed = null;
  hideOverlay();
  renderLayerTree();
  renderInspector();
  publishSelection();
  postToIframe({ type: 'FRAMELAB_CLEAR' });
}

function postToIframe(msg) {
  const frame = $('app-iframe');
  if (frame && frame.contentWindow) {
    try { frame.contentWindow.postMessage(msg, '*'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

function frameOffset() {
  const shell = $('iframe-shell').getBoundingClientRect();
  const frame = $('app-iframe').getBoundingClientRect();
  return { left: frame.left - shell.left, top: frame.top - shell.top };
}

function paintOverlay(node, rect, label, opts = {}) {
  const off = frameOffset();
  node.style.left = (off.left + rect.left) + 'px';
  node.style.top = (off.top + rect.top) + 'px';
  node.style.width = Math.max(0, rect.width) + 'px';
  node.style.height = Math.max(0, rect.height) + 'px';
  node.classList.toggle('smooth', !!opts.smooth);
  node.classList.add('show');
  const labelEl = node.querySelector('.overlay-label');
  if (labelEl) {
    labelEl.textContent = label || '';
    labelEl.classList.toggle('below', off.top + rect.top < 20);
  }
}

function showSelectOverlay(rect, instant) {
  if (!rect) return;
  state.selectedRect = rect;
  const el = state.selected;
  const label = el ? `${el.tagName}` : '';
  paintOverlay($('select-overlay'), rect, label, { smooth: !instant });
  const size = $('select-size');
  size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}
function hideOverlay() {
  $('select-overlay').classList.remove('show');
  $('hover-overlay').classList.remove('show');
}
function showHoverOverlay(rect, label) {
  if (state.dragging) return;
  paintOverlay($('hover-overlay'), rect, label);
}
function hideHoverOverlay() {
  $('hover-overlay').classList.remove('show');
}

// ---------------------------------------------------------------------------
// Iframe messaging
// ---------------------------------------------------------------------------

window.addEventListener('message', (e) => {
  const data = e.data || {};
  switch (data.type) {
    case 'FRAMELAB_CLICK':
      handleIframeClick(data.framelabId, data.rect, data.computed, data.fromCanvas);
      break;
    case 'FRAMELAB_HOVER':
      handleIframeHover(data.framelabId, data.rect);
      break;
    case 'FRAMELAB_HOVER_OUT':
      state.hoverId = null;
      hideHoverOverlay();
      renderLayerHoverState();
      break;
    case 'FRAMELAB_DESELECT':
      clearSelection();
      break;
    case 'FRAMELAB_KEY':
      handleShortcut(data);
      break;
    case 'FRAMELAB_RECT_UPDATE':
      if (state.selectedDomId === data.framelabId) showSelectOverlay(data.rect, true);
      break;
    case 'FRAMELAB_NOT_FOUND':
      hideOverlay();
      break;
    case 'FRAMELAB_DRAG_START': handleDragStart(data.sourceId); break;
    case 'FRAMELAB_DRAG_OVER': handleDragOver(data.targetId, data.position, data.rect); break;
    case 'FRAMELAB_DROP': handleDrop(data.sourceId, data.targetId, data.position); break;
    case 'FRAMELAB_DRAG_CANCEL': handleDragCancel(); break;
  }
});

async function handleIframeClick(framelabId, rect, computed, fromCanvas) {
  const filePath = filePathFromId(framelabId || '');
  if (!filePath) return;
  if (state.currentFilePath !== filePath) await loadFile(filePath);
  const el = findByFramelabId(framelabId);
  if (!el) {
    toastError('That element is not in the current source snapshot.');
    return;
  }
  state.selectedComputed = computed || null;
  state.selectedDomId = framelabId;
  selectElement(el, { fromCanvas: true });
  showSelectOverlay(rect, true);
  if (!fromCanvas) scrollLayerIntoView();
}

function handleIframeHover(framelabId, rect) {
  if (state.dragging) return;
  state.hoverId = framelabId;
  const el = findByFramelabId(framelabId);
  showHoverOverlay(rect, el ? el.tagName : '');
  renderLayerHoverState();
}

// ---------------------------------------------------------------------------
// Drag + drop reorder
// ---------------------------------------------------------------------------

function handleDragStart(sourceId) {
  state.dragging = { sourceId };
  $('stage').classList.add('dragging');
  hideOverlay();
}
function handleDragOver(targetId, position, rect) {
  const ind = $('drop-indicator');
  if (!targetId || !rect) { ind.classList.remove('show'); return; }
  const off = frameOffset();
  const y = position === 'before'
    ? off.top + rect.top - 1.5
    : off.top + rect.top + rect.height - 1.5;
  ind.style.top = y + 'px';
  ind.style.left = (off.left + rect.left) + 'px';
  ind.style.width = rect.width + 'px';
  ind.classList.add('show');
}
function handleDragCancel() {
  state.dragging = null;
  $('stage').classList.remove('dragging');
  $('drop-indicator').classList.remove('show');
}

// A stable key is a path of child indices, so a reorder is fully described by
// the two indices involved — which is exactly what makes it invertible.
function splitKey(key) {
  const parts = String(key || '').split('.');
  return { parentKey: parts.slice(0, -1).join('.'), index: Number(parts[parts.length - 1]) };
}

async function handleDrop(sourceId, targetId, position) {
  handleDragCancel();
  if (!sourceId || !targetId || !position || sourceId === targetId) return;
  const filePath = filePathFromId(sourceId);
  if (!filePath) return;
  const sourceEl = findByFramelabId(sourceId);
  const targetEl = findByFramelabId(targetId);
  try {
    await api('POST', '/move', {
      filePath, sourceId, targetId, position,
      sourceKey: sourceEl && sourceEl.stableKey,
      targetKey: targetEl && targetEl.stableKey,
    });

    if (sourceEl && targetEl) {
      const from = splitKey(sourceEl.stableKey);
      const to = splitKey(targetEl.stableKey);
      if (from.parentKey && from.parentKey === to.parentKey) {
        // Mirror the server's insertion arithmetic to know where it landed.
        let insertAt = position === 'before' ? to.index : to.index + 1;
        if (from.index < to.index) insertAt -= 1;
        if (insertAt !== from.index) {
          pushUndo({
            filePath,
            kind: 'move',
            parentKey: from.parentKey,
            fromIndex: from.index,
            toIndex: insertAt,
            stableKey: sourceEl.stableKey,
          });
        }
      }
    }

    clearSelection();
    reloadIframe();
    flashStatus();
    if (sourceEl && targetEl) {
      await maybeAutoCommit('move', {
        filePath, tagName: sourceEl.tagName, line: sourceEl.line,
        position, targetTag: targetEl.tagName, targetLine: targetEl.line,
      });
    }
  } catch (err) {
    const reason = err.message === 'cross-parent-not-supported'
      ? 'Elements can only be reordered within the same parent.'
      : err.message;
    toastError(reason);
  }
}

function reloadIframe() {
  const frame = $('app-iframe');
  frame.src = APP_URL + (APP_URL.includes('?') ? '&' : '?') + '_fl=' + Date.now();
}

// ---------------------------------------------------------------------------
// Files + layers
// ---------------------------------------------------------------------------

async function fetchFiles() {
  try {
    const data = await api('GET', '/files');
    state.files = data.files || [];
    state.rootDir = data.rootDir || '';
    renderFileTree();
  } catch (err) {
    toastError(`Could not list project files: ${err.message}`);
  }
}

async function loadFile(filePath) {
  state.currentFilePath = filePath;
  const rel = relPath(filePath);
  $('current-file').textContent = rel;
  $('current-file').title = filePath;
  try {
    await api('POST', '/watch', { filePath });
    state.snapshot = await api('GET', `/snapshot?filePath=${encodeURIComponent(filePath)}`);
    renderFileTree();
    renderLayerTree();
  } catch (err) {
    toastError(`Could not open ${rel}: ${err.message}`);
  }
}

function relPath(p) {
  const root = state.rootDir || '';
  if (root && p.startsWith(root)) return p.slice(root.length).replace(/^\/+/, '');
  return p.split('/').slice(-2).join('/');
}

function buildFileTree(files, rootDir) {
  const root = { name: '', children: {}, isFile: false, fullPath: '' };
  for (const f of files) {
    let rel = f;
    if (rootDir && f.startsWith(rootDir)) rel = f.slice(rootDir.length).replace(/^[/\\]+/, '');
    const parts = rel.split(/[/\\]/).filter(Boolean);
    let cur = root;
    let pathSoFar = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      pathSoFar = pathSoFar ? pathSoFar + '/' + name : name;
      if (!cur.children[name]) {
        cur.children[name] = { name, isFile: isLast, fullPath: isLast ? f : pathSoFar, children: {} };
      }
      cur = cur.children[name];
    }
  }
  return root;
}

function fileExtClass(name) {
  if (/\.tsx?$/.test(name)) return 'tsx';
  if (/\.jsx?$/.test(name)) return 'jsx';
  return '';
}

function renderTreeChildren(node, depth) {
  const entries = Object.values(node.children).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  let html = '';
  for (const child of entries) {
    const indent = `padding-left: ${8 + depth * 13}px`;
    if (child.isFile) {
      const isActive = child.fullPath === state.currentFilePath;
      html += `<div class="tree-node leaf ${isActive ? 'active' : ''}" data-file="${escapeHtml(child.fullPath)}" style="${indent}" title="${escapeHtml(child.fullPath)}">
        <span class="chev">${ICONS.chev}</span>
        <span class="icon ${fileExtClass(child.name)}">${ICONS.file}</span>
        <span class="name">${escapeHtml(child.name)}</span>
      </div>`;
    } else {
      const collapsed = UI.collapsedFolders.has(child.fullPath);
      html += `<div class="tree-node folder ${collapsed ? '' : 'expanded'}" data-folder="${escapeHtml(child.fullPath)}" style="${indent}" title="${escapeHtml(child.fullPath)}">
        <span class="chev">${ICONS.chev}</span>
        <span class="icon folder">${collapsed ? ICONS.folder : ICONS.folderOpen}</span>
        <span class="name">${escapeHtml(child.name)}</span>
      </div>`;
      if (!collapsed) html += renderTreeChildren(child, depth + 1);
    }
  }
  return html;
}

function renderFileTree() {
  const root = $('file-tree');
  if (!state.files.length) {
    root.innerHTML = '<div class="list-empty">No .tsx or .jsx files found in this project.</div>';
    return;
  }
  root.innerHTML = '<div class="tree">' + renderTreeChildren(buildFileTree(state.files, state.rootDir), 0) + '</div>';
  root.querySelectorAll('[data-file]').forEach((n) => {
    n.addEventListener('click', () => loadFile(n.dataset.file));
  });
  root.querySelectorAll('[data-folder]').forEach((n) => {
    n.addEventListener('click', () => {
      const fp = n.dataset.folder;
      if (UI.collapsedFolders.has(fp)) UI.collapsedFolders.delete(fp);
      else UI.collapsedFolders.add(fp);
      saveUiPrefs();
      renderFileTree();
    });
  });
}

function layerHint(el) {
  if (el.textContent) {
    const t = el.textContent.replace(/\s+/g, ' ').trim();
    return t.length > 22 ? t.slice(0, 22) + '…' : t;
  }
  if (el.className) {
    const first = el.className.split(/\s+/).find((c) => c && !c.startsWith('__FRAMELAB'));
    return first ? '.' + first : '';
  }
  return '';
}

function renderLayerTree() {
  const host = $('layer-tree');
  const els = elements();
  $('layer-count').textContent = els.length ? String(els.length) : '';
  if (!state.currentFilePath) {
    host.innerHTML = '<div class="list-empty">Click an element in the preview, or pick a file above.</div>';
    return;
  }
  if (!els.length) {
    host.innerHTML = '<div class="list-empty">No JSX elements in this file.</div>';
    return;
  }
  const byParent = new Map();
  for (const el of els) {
    const key = el.parentId || '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(el);
  }
  const render = (list, depth) => {
    let html = '';
    for (const el of list) {
      const kids = byParent.get(el.framelabId) || [];
      const collapsed = UI.collapsedLayers.has(el.stableKey);
      const active = state.selectedKey === el.stableKey;
      const hint = layerHint(el);
      html += `<div class="layer ${kids.length ? (collapsed ? '' : 'expanded') : 'leaf'} ${active ? 'active' : ''}"
                    data-key="${escapeHtml(el.stableKey)}" data-id="${escapeHtml(el.framelabId)}"
                    style="padding-left:${6 + depth * 12}px" title="${escapeHtml(el.tagName)} · line ${el.line}">
        <span class="twist" data-twist="${escapeHtml(el.stableKey)}">${kids.length ? ICONS.chev : ''}</span>
        <span class="tag">${escapeHtml(el.tagName)}</span>
        <span class="hint">${escapeHtml(hint)}</span>
        ${el.classNameEditable === false ? `<span class="lock" title="className is a dynamic expression">${ICONS.lock}</span>` : ''}
      </div>`;
      if (kids.length && !collapsed) html += render(kids, depth + 1);
    }
    return html;
  };
  host.innerHTML = render(byParent.get('__root__') || [], 0);

  host.querySelectorAll('.layer').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-twist]')) {
        const key = e.target.closest('[data-twist]').dataset.twist;
        if (UI.collapsedLayers.has(key)) UI.collapsedLayers.delete(key);
        else UI.collapsedLayers.add(key);
        renderLayerTree();
        return;
      }
      const el = findByStableKey(row.dataset.key);
      if (el) selectElement(el);
    });
  });
}

function renderLayerHoverState() {
  const hoverEl = state.hoverId ? findByFramelabId(state.hoverId) : null;
  document.querySelectorAll('#layer-tree .layer').forEach((row) => {
    row.classList.toggle('hovered', !!hoverEl && row.dataset.key === hoverEl.stableKey);
  });
}

function scrollLayerIntoView() {
  const row = document.querySelector(`#layer-tree .layer[data-key="${CSS.escape(state.selectedKey || '')}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------------------
// Popover engine
// ---------------------------------------------------------------------------

const popover = {
  el: null,
  anchor: null,
  onClose: null,
  items: [],
  cursor: -1,
};

function closePopover() {
  const pop = $('popover');
  pop.classList.remove('show');
  pop.innerHTML = '';
  popover.anchor = null;
  popover.items = [];
  popover.cursor = -1;
  if (popover.onClose) { const fn = popover.onClose; popover.onClose = null; fn(); }
}

function positionPopover(anchor) {
  const pop = $('popover');
  const a = anchor.getBoundingClientRect();
  pop.style.visibility = 'hidden';
  pop.classList.add('show');
  const p = pop.getBoundingClientRect();
  let left = a.left;
  let top = a.bottom + 4;
  if (left + p.width > window.innerWidth - 8) left = window.innerWidth - p.width - 8;
  if (left < 8) left = 8;
  if (top + p.height > window.innerHeight - 8) {
    const above = a.top - p.height - 4;
    top = above > 8 ? above : Math.max(8, window.innerHeight - p.height - 8);
  }
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  pop.style.minWidth = Math.max(180, Math.round(a.width)) + 'px';
  pop.style.visibility = '';
}

/**
 * A compact anchored menu. Deliberately not a native <select> or <datalist>:
 * those render an OS menu that can cover the whole panel, which is exactly the
 * interaction this inspector is built to avoid.
 */
function openMenu(anchor, config) {
  closePopover();
  const pop = $('popover');
  popover.anchor = anchor;

  const searchable = config.groups.reduce((n, g) => n + g.items.length, 0) > 8;
  pop.innerHTML =
    (searchable ? `<div class="pop-search"><input type="text" placeholder="${escapeHtml(config.placeholder || 'Search')}" spellcheck="false"></div>` : '') +
    `<div class="pop-list"></div>` +
    (config.footer || '');

  const list = pop.querySelector('.pop-list');
  const search = pop.querySelector('.pop-search input');

  function draw(filter) {
    const f = (filter || '').trim().toLowerCase();
    let html = '';
    popover.items = [];
    for (const group of config.groups) {
      const items = group.items.filter((it) =>
        !f || String(it.label).toLowerCase().includes(f) || String(it.value).toLowerCase().includes(f));
      if (!items.length) continue;
      if (group.label) html += `<div class="pop-group">${escapeHtml(group.label)}</div>`;
      for (const it of items) {
        const idx = popover.items.length;
        popover.items.push(it);
        const selected = String(it.value) === String(config.value == null ? '' : config.value);
        html += `<div class="pop-item ${selected ? 'selected' : ''}" data-idx="${idx}">
          ${it.swatch ? `<span class="pi-swatch" style="background:${escapeHtml(it.swatch)}"></span>` : ''}
          <span>${escapeHtml(it.label)}</span>
          ${it.detail ? `<span class="pi-val">${escapeHtml(it.detail)}</span>` : ''}
        </div>`;
      }
    }
    list.innerHTML = html || '<div class="pop-empty">No matches</div>';
    list.querySelectorAll('.pop-item').forEach((node) => {
      node.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const it = popover.items[Number(node.dataset.idx)];
        config.onPick(it.value, it);
        closePopover();
      });
    });
  }

  draw('');
  if (search) {
    search.addEventListener('input', () => draw(search.value));
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveCursor(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = popover.items[popover.cursor];
        if (it) { config.onPick(it.value, it); closePopover(); }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePopover();
        anchor.focus();
      }
    });
  }
  function moveCursor(delta) {
    if (!popover.items.length) return;
    popover.cursor = (popover.cursor + delta + popover.items.length) % popover.items.length;
    list.querySelectorAll('.pop-item').forEach((n, i) => {
      n.classList.toggle('cursor', i === popover.cursor);
      if (i === popover.cursor) n.scrollIntoView({ block: 'nearest' });
    });
  }

  if (config.onFooter) config.onFooter(pop);
  positionPopover(anchor);
  if (search) search.focus();
  return pop;
}

document.addEventListener('mousedown', (e) => {
  const pop = $('popover');
  if (!pop.classList.contains('show')) return;
  if (pop.contains(e.target)) return;
  if (popover.anchor && popover.anchor.contains(e.target)) return;
  closePopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('popover').classList.contains('show')) {
    e.stopPropagation();
    closePopover();
  }
}, true);
window.addEventListener('resize', closePopover);
$('inspector-scroll') && $('inspector-scroll').addEventListener('scroll', () => {
  if ($('popover').classList.contains('show')) closePopover();
});

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

function currentVariants() {
  const out = [];
  if (state.breakpoint) out.push(state.breakpoint);
  if (state.variantState) out.push(state.variantState);
  return out;
}
function variantKeyOf(list) {
  return [...list].sort().join(':');
}
function currentVariantKey() {
  return variantKeyOf(currentVariants());
}
function propsForKey(key) {
  const p = state.selected && state.selected.props;
  if (!p) return {};
  if (!key) return p.props || {};
  return (p.variantProps && p.variantProps[key]) || {};
}
function valueOf(prop) {
  const v = propsForKey(currentVariantKey())[prop];
  return v === undefined ? null : v;
}
function baseValueOf(prop) {
  const v = propsForKey('')[prop];
  return v === undefined ? null : v;
}
function isVariantMode() {
  return currentVariantKey() !== '';
}
function spacingOf(prop) {
  const v = propsForKey(currentVariantKey())[prop];
  return v || { top: null, right: null, bottom: null, left: null };
}
function variantHasValues(key) {
  const p = state.selected && state.selected.props;
  if (!p || !p.variantProps || !p.variantProps[key]) return false;
  const bag = p.variantProps[key];
  return Object.entries(bag).some(([k, v]) => {
    if (k === 'padding' || k === 'margin') return v && Object.values(v).some((x) => x != null);
    return v != null;
  });
}

// ---------------------------------------------------------------------------
// Edit pipeline
// ---------------------------------------------------------------------------

function queueEdit(edit) {
  state.pendingEdits.push(edit);
  // Optimistic local update so controls respond instantly; the server's
  // snapshot is authoritative and arrives a few milliseconds later.
  const key = variantKeyOf(edit.variants || []);
  const p = state.selected && state.selected.props;
  if (p) {
    if (!key) p.props = p.props || {};
    p.variantProps = p.variantProps || {};
    const bag = key ? (p.variantProps[key] = p.variantProps[key] || {}) : (p.variantProps[''] = p.props);
    if (edit.prop === 'padding' || edit.prop === 'margin') {
      bag[edit.prop] = { ...(bag[edit.prop] || {}), ...(edit.value || {}) };
    } else {
      bag[edit.prop] = edit.value;
    }
  }
  clearTimeout(state.editTimer);
  state.editTimer = setTimeout(flushEdits, 200);
}

function queueText(text) {
  state.pendingText = text;
  clearTimeout(state.editTimer);
  state.editTimer = setTimeout(flushEdits, 320);
}

async function flushEdits() {
  const edits = state.pendingEdits;
  const text = state.pendingText;
  state.pendingEdits = [];
  state.pendingText = undefined;
  if (!edits.length && text === undefined) return;

  const el = state.selected;
  if (!el) return;
  const filePath = state.currentFilePath;
  const before = { className: el.className, textContent: el.textContent };

  flashStatus();
  try {
    const payload = {
      filePath,
      elementId: el.framelabId,
      stableKey: el.stableKey,
    };
    if (edits.length) payload.edits = edits;
    if (text !== undefined) payload.textContent = text;

    const res = await api('POST', '/update', payload);
    const applied = res.applied || {};

    pushUndo({
      filePath,
      stableKey: el.stableKey,
      elementId: el.framelabId,
      className: applied.className !== undefined
        ? { before: applied.previousClassName == null ? before.className : applied.previousClassName, after: applied.className }
        : null,
      textContent: applied.textContent !== undefined
        ? { before: before.textContent || '', after: applied.textContent }
        : null,
    });

    if (UI.autoCommit) {
      if (edits.length) await maybeAutoCommit('style', { filePath, tagName: el.tagName, line: el.line, changes: edits });
      if (text !== undefined) await maybeAutoCommit('text', { filePath, tagName: el.tagName, line: el.line, text });
    }
  } catch (err) {
    const message = explainUpdateError(err);
    toastError(message);
    // The optimistic value was wrong — re-sync from the server.
    if (state.currentFilePath) loadFile(state.currentFilePath).then(() => {
      const again = findByStableKey(state.selectedKey);
      if (again) { state.selected = again; renderInspector(); }
    });
  }
}

function explainUpdateError(err) {
  const raw = (err && err.message) || 'update failed';
  const map = {
    'className is not a static string':
      'This className is built from an expression Framelab cannot rewrite safely. Edit it in your editor.',
    'className-not-static':
      'This className is built from an expression Framelab cannot rewrite safely. Edit it in your editor.',
    'has-expression-children': 'This element renders dynamic children, so its text is not editable here.',
    'has-nested-element-children': 'This element wraps other elements. Select a child to edit its text.',
    'self-closing-element': 'A self-closing element has no text to edit.',
    'element-not-found': 'That element is no longer in the file. Reload the preview.',
    'would-not-parse': 'That change would have broken the file, so it was not written.',
    'path outside project root': 'That file is outside the watched project.',
    'cannot-delete-root':
      'This is the outermost element of the component, so it cannot be deleted here.',
    'element-not-in-parent': 'That element is no longer where Framelab expected it.',
    'parent-not-found': 'The parent element is gone, so this cannot be restored automatically.',
  };
  return map[raw] || raw;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

// Deleting removes real source code, so it is never silent: the element's
// text is kept in the undo stack and the toast offers the way back.
async function deleteSelected() {
  const el = state.selected;
  if (!el) return;
  if (!el.parentId) {
    toastError('This is the outermost element of the component, so it cannot be deleted here.');
    return;
  }
  const filePath = state.currentFilePath;
  const parentKey = (el.stableKey || '').split('.').slice(0, -1).join('.');

  try {
    const res = await api('POST', '/delete', {
      filePath,
      elementId: el.framelabId,
      stableKey: el.stableKey,
    });

    pushUndo({
      filePath,
      kind: 'delete',
      parentKey: res.parentKey || parentKey,
      index: res.index,
      removed: res.removed,
      tagName: res.tagName || el.tagName,
    });

    // Keep the user somewhere sensible: the parent of what they just removed.
    if (res.snapshot) {
      state.snapshot = res.snapshot;
      renderLayerTree();
    }
    const parent = findByStableKey(res.parentKey || parentKey);
    if (parent) selectElement(parent);
    else clearSelection();

    flashStatus();
    toast(`Deleted <${res.tagName || el.tagName}>`, {
      actionLabel: 'Undo',
      onAction: undo,
      duration: 6000,
    });

    await maybeAutoCommit('delete', {
      filePath, tagName: res.tagName || el.tagName, line: el.line,
    });
  } catch (err) {
    toastError(explainUpdateError(err));
  }
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

function pushUndo(entry) {
  if (entry.kind === 'move' || entry.kind === 'delete') {
    state.undoStack.push({ ...entry, at: Date.now() });
    if (state.undoStack.length > 100) state.undoStack.shift();
    state.redoStack.length = 0;
    renderHistoryButtons();
    return;
  }
  if (!entry.className && !entry.textContent) return;
  if (entry.className && entry.className.before === entry.className.after) entry.className = null;
  if (entry.textContent && entry.textContent.before === entry.textContent.after) entry.textContent = null;
  if (!entry.className && !entry.textContent) return;
  // Coalesce a run of edits to the same element into one undo step, so
  // dragging a slider is a single undo rather than forty.
  const last = state.undoStack[state.undoStack.length - 1];
  const now = Date.now();
  if (last && last.stableKey === entry.stableKey && last.filePath === entry.filePath &&
      now - last.at < 700 && !!last.className === !!entry.className && !!last.textContent === !!entry.textContent) {
    if (entry.className) last.className.after = entry.className.after;
    if (entry.textContent) last.textContent.after = entry.textContent.after;
    last.at = now;
  } else {
    state.undoStack.push({ ...entry, at: now });
    if (state.undoStack.length > 100) state.undoStack.shift();
  }
  state.redoStack.length = 0;
  renderHistoryButtons();
}

async function applyHistory(entry, direction) {
  if (entry.kind === 'move') return applyMoveHistory(entry, direction);
  if (entry.kind === 'delete') return applyDeleteHistory(entry, direction);
  const payload = {
    filePath: entry.filePath,
    elementId: entry.elementId,
    stableKey: entry.stableKey,
  };
  if (entry.className) payload.className = direction === 'undo' ? entry.className.before : entry.className.after;
  if (entry.textContent) payload.textContent = direction === 'undo' ? entry.textContent.before : entry.textContent.after;
  try {
    if (state.currentFilePath !== entry.filePath) await loadFile(entry.filePath);
    await api('POST', '/update', payload);
    flashStatus();
    const el = findByStableKey(entry.stableKey);
    if (el) { state.selected = el; state.selectedKey = el.stableKey; renderInspector(); }
    return true;
  } catch (err) {
    toastError(explainUpdateError(err));
    return false;
  }
}

// Undo of a delete re-inserts the exact source text at the exact index; redo
// deletes whatever now sits there again.
async function applyDeleteHistory(entry, direction) {
  try {
    if (state.currentFilePath !== entry.filePath) await loadFile(entry.filePath);
    if (direction === 'undo') {
      const res = await api('POST', '/insert', {
        filePath: entry.filePath,
        parentKey: entry.parentKey,
        index: entry.index,
        source: entry.removed,
      });
      if (res.snapshot) { state.snapshot = res.snapshot; renderLayerTree(); }
      const restored = findByStableKey(`${entry.parentKey}.${entry.index}`);
      if (restored) selectElement(restored);
      flashStatus();
      return true;
    }
    const target = findByStableKey(`${entry.parentKey}.${entry.index}`);
    if (!target) {
      toastError('That element has moved since it was restored, so it cannot be re-deleted.');
      return false;
    }
    const res = await api('POST', '/delete', {
      filePath: entry.filePath,
      elementId: target.framelabId,
      stableKey: target.stableKey,
    });
    if (res.snapshot) { state.snapshot = res.snapshot; renderLayerTree(); }
    const parent = findByStableKey(entry.parentKey);
    if (parent) selectElement(parent); else clearSelection();
    flashStatus();
    return true;
  } catch (err) {
    toastError(explainUpdateError(err));
    return false;
  }
}

// Undo of a reorder is the same reorder with the indices swapped.
async function applyMoveHistory(entry, direction) {
  const { parentKey, fromIndex, toIndex } = entry;
  const sourceIndex = direction === 'undo' ? toIndex : fromIndex;
  const targetIndex = direction === 'undo' ? fromIndex : toIndex;
  try {
    if (state.currentFilePath !== entry.filePath) await loadFile(entry.filePath);
    const source = findByStableKey(`${parentKey}.${sourceIndex}`);
    const target = findByStableKey(`${parentKey}.${targetIndex}`);
    if (!source || !target) {
      toastError('The elements moved since that reorder, so it cannot be undone.');
      return false;
    }
    await api('POST', '/move', {
      filePath: entry.filePath,
      sourceId: source.framelabId,
      targetId: target.framelabId,
      sourceKey: source.stableKey,
      targetKey: target.stableKey,
      position: targetIndex < sourceIndex ? 'before' : 'after',
    });
    clearSelection();
    reloadIframe();
    flashStatus();
    return true;
  } catch (err) {
    toastError(explainUpdateError(err));
    return false;
  }
}

async function undo() {
  const entry = state.undoStack.pop();
  if (!entry) return;
  renderHistoryButtons();
  if (await applyHistory(entry, 'undo')) {
    state.redoStack.push(entry);
  } else {
    state.undoStack.push(entry);
  }
  renderHistoryButtons();
}
async function redo() {
  const entry = state.redoStack.pop();
  if (!entry) return;
  renderHistoryButtons();
  if (await applyHistory(entry, 'redo')) {
    state.undoStack.push(entry);
  } else {
    state.redoStack.push(entry);
  }
  renderHistoryButtons();
}
function renderHistoryButtons() {
  $('undo-btn').disabled = state.undoStack.length === 0;
  $('redo-btn').disabled = state.redoStack.length === 0;
  $('undo-btn').title = `Undo (${MOD}Z)`;
  $('redo-btn').title = `Redo (${MOD}⇧Z)`;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setProp(prop, rawValue, opts = {}) {
  if (!state.selected) return;
  const value = opts.raw ? rawValue : normalizeForProp(prop, rawValue);
  queueEdit({ prop, value, variants: currentVariants(), ...(opts.side ? { side: opts.side } : {}) });
}

function setSpacing(prop, patch) {
  if (!state.selected) return;
  const normalized = {};
  for (const [k, v] of Object.entries(patch)) normalized[k] = normalizeLengthValue(v);
  queueEdit({ prop, value: normalized, variants: currentVariants() });
}

// A text field with an optional token menu. Free text is always allowed, which
// is how arbitrary values (`[13px]`, `#0af`) stay first-class.
function makeField(prop, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const value = valueOf(prop);
  const inherited = isVariantMode() && value == null ? baseValueOf(prop) : null;

  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.value = value == null ? '' : String(value);
  input.placeholder = inherited != null ? String(inherited) : (opts.placeholder || '');
  if (inherited != null) input.classList.add('inherited');
  input.dataset.prop = prop;
  input.addEventListener('focus', () => input.select());
  wrap.appendChild(input);

  const commit = () => setProp(prop, input.value, opts);
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(); input.blur(); }
    if (e.key === 'Escape') { input.value = value == null ? '' : String(value); input.blur(); }
    if (opts.scale && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const next = stepScaleValue(opts.scale(), input.value, e.key === 'ArrowUp' ? 1 : -1);
      if (next != null) { input.value = next; setProp(prop, next, opts); }
    }
  });

  if (opts.menu) {
    const btn = document.createElement('button');
    btn.className = 'field-btn';
    btn.type = 'button';
    btn.innerHTML = ICONS.caret;
    btn.setAttribute('aria-label', `Choose ${prop}`);
    btn.addEventListener('click', () => {
      openMenu(wrap, {
        value: value == null ? '' : value,
        placeholder: opts.searchPlaceholder || 'Filter',
        groups: opts.menu(),
        onPick: (v) => { input.value = v; setProp(prop, v, opts); },
      });
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function stepScaleValue(scale, current, dir) {
  const list = scale || [];
  const idx = list.indexOf(String(current));
  if (idx >= 0) {
    const next = list[Math.min(list.length - 1, Math.max(0, idx + dir))];
    return next === undefined ? null : next;
  }
  const n = parseFloat(current);
  if (!Number.isNaN(n)) return String(n + dir);
  return list.length ? list[dir > 0 ? 0 : list.length - 1] : null;
}

function tokenGroups(category, extra) {
  const part = TOKENS[category] || { custom: [], defaults: [] };
  const norm = (k) => (k === 'DEFAULT' ? '' : k);
  const label = (k) => (k === 'DEFAULT' ? 'default' : k);
  const groups = [];
  if (extra && extra.length) groups.push({ label: '', items: extra });
  if (part.custom && part.custom.length) {
    groups.push({ label: 'project', items: part.custom.map((k) => ({ value: norm(k), label: label(k) })) });
  }
  const defaults = (part.defaults && part.defaults.length ? part.defaults : part.all) || [];
  if (defaults.length) {
    groups.push({ label: 'tailwind', items: defaults.map((k) => ({ value: norm(k), label: label(k) })) });
  }
  return groups;
}

function colorGroups() {
  const groups = [{ label: '', items: [{ value: '', label: 'none' }] }];
  if (COLORS.custom && COLORS.custom.length) {
    groups.push({
      label: 'project',
      items: COLORS.custom.map((c) => ({ value: c.name, label: c.name, swatch: c.value, detail: c.value })),
    });
  }
  groups.push({
    label: 'tailwind',
    items: (COLORS.defaults || []).map((c) => ({ value: c.name, label: c.name, swatch: c.value, detail: c.value })),
  });
  return groups;
}

function makeColorField(prop, computedFallback) {
  const wrap = document.createElement('div');
  wrap.className = 'color-field';
  const value = valueOf(prop);
  const inherited = isVariantMode() && value == null ? baseValueOf(prop) : null;
  const shown = value != null ? value : null;
  const css = previewColor(shown != null ? shown : inherited, computedFallback);

  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'swatch';
  swatch.setAttribute('aria-label', `Choose ${prop}`);
  swatch.innerHTML = `<span class="swatch-fill" style="background:${css ? escapeHtml(css) : 'transparent'}"></span>`;

  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.dataset.prop = prop;
  input.value = shown == null ? '' : String(shown);
  input.placeholder = inherited != null ? String(inherited) : 'token or #hex';
  if (inherited != null) input.classList.add('inherited');
  input.addEventListener('focus', () => input.select());

  const commit = () => setProp(prop, input.value);
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { commit(); input.blur(); }
  });

  swatch.addEventListener('click', () => {
    const hex = cssColorToHex(css || '#888888') || '#888888';
    openMenu(swatch, {
      value: shown == null ? '' : shown,
      placeholder: 'Search colours',
      groups: colorGroups(),
      onPick: (v) => { input.value = v; setProp(prop, v); },
      footer: `<div class="pop-foot">
          <input type="color" value="${escapeHtml(hex)}" aria-label="Custom colour">
          <input type="text" placeholder="#rrggbb or rgb()" spellcheck="false" aria-label="Custom colour value">
        </div>`,
      onFooter: (pop) => {
        const picker = pop.querySelector('.pop-foot input[type="color"]');
        const text = pop.querySelector('.pop-foot input[type="text"]');
        picker.addEventListener('input', () => {
          input.value = picker.value;
          setProp(prop, picker.value);
        });
        text.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          input.value = text.value;
          setProp(prop, text.value);
          closePopover();
        });
      },
    });
  });

  wrap.appendChild(swatch);
  wrap.appendChild(input);
  return wrap;
}

function makeSegmented(prop, options, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'seg-icons';
  const value = valueOf(prop);
  const effective = value != null ? value : (isVariantMode() ? baseValueOf(prop) : null);
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = opt.label;
    btn.title = opt.title || opt.label;
    btn.className = String(effective) === String(opt.value) ? 'active' : '';
    btn.addEventListener('click', () => {
      // Clicking the active option clears it, which is how you get back to
      // "no opinion" without hand-editing the class string.
      const next = String(value) === String(opt.value) ? null : opt.value;
      setProp(prop, next, { raw: opts.raw });
      renderInspector();
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function row(labelText, control, opts = {}) {
  const r = document.createElement('div');
  r.className = 'row' + (opts.scrub ? ' scrub' : '');
  const label = document.createElement('label');
  label.textContent = labelText;
  r.appendChild(label);
  r.appendChild(control);
  if (opts.scrub && opts.onScrub) attachScrub(label, opts.onScrub);
  return r;
}

// Figma-style drag-to-change on a control's label.
function attachScrub(handle, onDelta) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    let last = 0;
    const move = (ev) => {
      const steps = Math.round((ev.clientX - startX) / 6);
      if (steps !== last) { onDelta(steps - last); last = steps; }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('is-resizing');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

// Box model: four editable sides plus a link toggle, nested margin over
// padding. Values scrub vertically, which matches how the numbers read.
function makeBoxModel(prop, label) {
  const wrap = document.createElement('div');
  const spacing = spacingOf(prop);
  const linked = UI.linked[prop];

  const sides = ['top', 'right', 'bottom', 'left'];
  const inputs = {};

  const mkInput = (side) => {
    const input = document.createElement('input');
    input.className = 'bm-in';
    input.type = 'text';
    input.spellcheck = false;
    input.value = spacing[side] == null ? '' : String(spacing[side]);
    input.placeholder = '–';
    input.title = `${label} ${side}`;
    input.setAttribute('aria-label', `${label} ${side}`);
    inputs[side] = input;

    const commit = (v) => {
      const patch = {};
      if (UI.linked[prop]) for (const s of sides) patch[s] = v;
      else patch[side] = v;
      for (const [s, val] of Object.entries(patch)) {
        if (inputs[s]) inputs[s].value = val == null ? '' : String(val);
      }
      setSpacing(prop, patch);
    };
    input.addEventListener('change', () => commit(input.value === '' ? null : input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { input.blur(); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = stepScaleValue(TOKENS.spacing.all, input.value, e.key === 'ArrowUp' ? 1 : -1);
        if (next != null) { input.value = next; commit(next); }
      }
    });
    // Vertical scrub on the input itself, like a design tool's number field.
    let scrubbing = false;
    input.addEventListener('mousedown', (e) => {
      if (document.activeElement === input) return;
      e.preventDefault();
      scrubbing = true;
      const startY = e.clientY;
      const startVal = input.value;
      let last = 0;
      const move = (ev) => {
        const steps = Math.round((startY - ev.clientY) / 6);
        if (steps === last) return;
        last = steps;
        let v = startVal;
        for (let i = 0; i < Math.abs(steps); i++) {
          v = stepScaleValue(TOKENS.spacing.all, v, steps > 0 ? 1 : -1);
          if (v == null) break;
        }
        if (v != null) { input.value = v; commit(v); }
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        // A click that never turned into a drag is a request to type a value:
        // focus and select, so the next keystroke replaces rather than appends.
        if (!last && scrubbing) { input.focus(); input.select(); }
        scrubbing = false;
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    return input;
  };

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'bm-link' + (linked ? ' on' : '');
  link.innerHTML = linked ? ICONS.link : ICONS.unlink;
  link.title = linked ? 'Sides linked — click to edit each side' : 'Sides independent — click to link';
  link.setAttribute('aria-pressed', String(!!linked));
  link.addEventListener('click', () => {
    UI.linked[prop] = !UI.linked[prop];
    saveUiPrefs();
    renderInspector();
  });

  const box = document.createElement('div');
  box.className = 'boxmodel';
  box.innerHTML = `<span class="bm-label">${escapeHtml(label)}</span>`;
  const grid = document.createElement('div');
  grid.className = 'bm-outer';

  const spacer = () => document.createElement('span');
  const top = mkInput('top');
  const rightI = mkInput('right');
  const bottom = mkInput('bottom');
  const leftI = mkInput('left');

  grid.appendChild(spacer());
  grid.appendChild(top);
  grid.appendChild(spacer());
  grid.appendChild(leftI);

  const center = document.createElement('div');
  center.className = 'bm-inner';
  const inner = document.createElement('div');
  inner.className = 'bm-inner-grid';
  const centerCell = document.createElement('div');
  centerCell.className = 'bm-center';
  centerCell.appendChild(link);
  inner.appendChild(centerCell);
  center.appendChild(inner);
  grid.appendChild(center);

  grid.appendChild(rightI);
  grid.appendChild(spacer());
  grid.appendChild(bottom);
  grid.appendChild(spacer());

  box.appendChild(grid);
  wrap.appendChild(box);
  return wrap;
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function sectionEl(id, title, buildBody, countText) {
  const sec = document.createElement('div');
  sec.className = 'section' + (UI.collapsedSections.has(id) ? ' collapsed' : '');
  const h = document.createElement('h4');
  h.innerHTML = `<span class="section-chev">${ICONS.chevDown}</span><span>${escapeHtml(title)}</span>` +
    (countText ? `<span class="sec-count">${escapeHtml(countText)}</span>` : '');
  h.addEventListener('click', () => {
    if (UI.collapsedSections.has(id)) UI.collapsedSections.delete(id);
    else UI.collapsedSections.add(id);
    saveUiPrefs();
    sec.classList.toggle('collapsed');
  });
  sec.appendChild(h);
  const body = document.createElement('div');
  body.className = 'section-body';
  buildBody(body);
  sec.appendChild(body);
  return sec;
}

function renderInspector() {
  const empty = $('inspector-empty');
  const host = $('inspector');
  const foot = $('classname-foot');
  const el = state.selected;

  host.innerHTML = '';
  if (!el) {
    empty.style.display = '';
    foot.hidden = true;
    return;
  }
  empty.style.display = 'none';

  host.appendChild(renderBreadcrumb(el));
  host.appendChild(renderHead(el));

  if (el.classNameEditable === false) {
    const msg = document.createElement('div');
    msg.className = 'bare-msg';
    msg.innerHTML = `<b>Dynamic className</b><br/>
      This element's classes come from an expression Framelab will not rewrite
      (a ternary, a variable, or a call it does not recognise). Editing it here
      could change behaviour it cannot see, so it stays read-only.
      <br/><br/>Text content and layer navigation still work.`;
    host.appendChild(msg);
    host.appendChild(renderTextSection(el));
    renderClassNameFoot();
    return;
  }

  host.appendChild(renderVariantBar(el));
  host.appendChild(renderTextSection(el));

  host.appendChild(sectionEl('layout', 'Layout', (body) => {
    body.appendChild(row('Display', makeSegmented('display', [
      { value: 'block', label: 'block' },
      { value: 'flex', label: 'flex' },
      { value: 'grid', label: 'grid' },
      { value: 'inline-block', label: 'inline' },
      { value: 'hidden', label: 'none', title: 'hidden' },
    ])));
    const display = valueOf('display') || baseValueOf('display');
    const isFlex = display === 'flex' || display === 'inline-flex';
    const isGrid = display === 'grid' || display === 'inline-grid';
    if (isFlex) {
      body.appendChild(row('Direction', makeSegmented('flexDirection', [
        { value: 'row', label: 'row' },
        { value: 'col', label: 'column' },
      ])));
      body.appendChild(row('Wrap', makeSegmented('flexWrap', [
        { value: 'wrap', label: 'wrap' },
        { value: 'nowrap', label: 'nowrap' },
      ])));
    }
    if (isGrid) {
      body.appendChild(row('Columns', makeField('gridCols', {
        placeholder: '1 / 2 / 3',
        menu: () => [{ label: 'columns', items: ['1','2','3','4','5','6','12','none'].map((v) => ({ value: v, label: v })) }],
      })));
    }
    if (isFlex || isGrid) {
      body.appendChild(row('Align', makeSegmented('alignItems', [
        { value: 'start', label: 'start' },
        { value: 'center', label: 'center' },
        { value: 'end', label: 'end' },
        { value: 'stretch', label: 'fill' },
      ])));
      body.appendChild(row('Justify', makeSegmented('justifyContent', [
        { value: 'start', label: 'start' },
        { value: 'center', label: 'center' },
        { value: 'end', label: 'end' },
        { value: 'between', label: 'between' },
      ])));
      body.appendChild(row('Gap', makeField('gap', {
        placeholder: '0',
        scale: () => TOKENS.spacing.all,
        menu: () => tokenGroups('spacing'),
      })));
    }
    body.appendChild(row('Position', makeSegmented('position', [
      { value: 'relative', label: 'rel' },
      { value: 'absolute', label: 'abs' },
      { value: 'fixed', label: 'fixed' },
      { value: 'sticky', label: 'sticky' },
    ])));
  }));

  host.appendChild(sectionEl('spacing', 'Spacing', (body) => {
    body.appendChild(makeBoxModel('margin', 'margin'));
    body.appendChild(makeBoxModel('padding', 'padding'));
  }));

  host.appendChild(sectionEl('size', 'Size', (body) => {
    const grid = document.createElement('div');
    grid.className = 'row-2';
    grid.appendChild(row('W', makeField('width', {
      placeholder: 'auto', scale: () => TOKENS.spacing.all,
      menu: () => tokenGroups('spacing', [
        { value: 'full', label: 'full' }, { value: 'auto', label: 'auto' },
        { value: 'screen', label: 'screen' }, { value: 'fit', label: 'fit' },
      ]),
    })));
    grid.appendChild(row('H', makeField('height', {
      placeholder: 'auto', scale: () => TOKENS.spacing.all,
      menu: () => tokenGroups('spacing', [
        { value: 'full', label: 'full' }, { value: 'auto', label: 'auto' },
        { value: 'screen', label: 'screen' }, { value: 'fit', label: 'fit' },
      ]),
    })));
    body.appendChild(grid);
    const grid2 = document.createElement('div');
    grid2.className = 'row-2';
    grid2.appendChild(row('Min', makeField('minWidth', { placeholder: 'min-w' })));
    grid2.appendChild(row('Max', makeField('maxWidth', {
      placeholder: 'max-w',
      menu: () => [{ label: 'max-width', items: ['none','xs','sm','md','lg','xl','2xl','3xl','4xl','5xl','6xl','7xl','full','prose','screen-lg'].map((v) => ({ value: v, label: v })) }],
    })));
    body.appendChild(grid2);
  }));

  host.appendChild(sectionEl('typography', 'Typography', (body) => {
    body.appendChild(row('Color', makeColorField('textColor',
      state.selectedComputed && state.selectedComputed.color)));
    body.appendChild(row('Size', makeField('fontSize', {
      placeholder: 'base', scale: () => TOKENS.fontSize.all,
      menu: () => tokenGroups('fontSize'),
    })));
    body.appendChild(row('Weight', makeField('fontWeight', {
      placeholder: 'normal', menu: () => tokenGroups('fontWeight'),
    })));
    body.appendChild(row('Family', makeField('fontFamily', {
      placeholder: 'sans', menu: () => tokenGroups('fontFamily'),
    })));
    const grid = document.createElement('div');
    grid.className = 'row-2';
    grid.appendChild(row('LH', makeField('lineHeight', {
      placeholder: 'normal',
      menu: () => [{ label: 'leading', items: ['none','tight','snug','normal','relaxed','loose','3','4','5','6','7','8','9','10'].map((v) => ({ value: v, label: v })) }],
    })));
    grid.appendChild(row('LS', makeField('letterSpacing', {
      placeholder: 'normal',
      menu: () => [{ label: 'tracking', items: ['tighter','tight','normal','wide','wider','widest'].map((v) => ({ value: v, label: v })) }],
    })));
    body.appendChild(grid);
    body.appendChild(row('Align', makeSegmented('textAlign', [
      { value: 'left', label: 'left' },
      { value: 'center', label: 'center' },
      { value: 'right', label: 'right' },
      { value: 'justify', label: 'just' },
    ])));
    body.appendChild(row('Style', makeSegmented('textTransform', [
      { value: 'uppercase', label: 'AA' },
      { value: 'capitalize', label: 'Aa' },
      { value: 'lowercase', label: 'aa' },
    ], { raw: true })));
  }));

  host.appendChild(sectionEl('fill', 'Fill & border', (body) => {
    body.appendChild(row('Fill', makeColorField('background',
      state.selectedComputed && state.selectedComputed.backgroundColor)));
    body.appendChild(row('Border', makeColorField('borderColor',
      state.selectedComputed && state.selectedComputed.borderColor)));
    const grid = document.createElement('div');
    grid.className = 'row-2';
    grid.appendChild(row('W', makeField('borderWidth', {
      placeholder: '0',
      menu: () => [{ label: 'width', items: ['', '0', '2', '4', '8'].map((v) => ({ value: v, label: v === '' ? '1 (default)' : v })) }],
    })));
    grid.appendChild(row('Style', makeField('borderStyle', {
      placeholder: 'solid',
      menu: () => [{ label: 'style', items: ['solid','dashed','dotted','double','none'].map((v) => ({ value: v, label: v })) }],
    })));
    body.appendChild(grid);
    body.appendChild(row('Radius', makeField('borderRadius', {
      placeholder: 'none',
      menu: () => tokenGroups('borderRadius'),
    })));
  }));

  host.appendChild(sectionEl('effects', 'Effects', (body) => {
    body.appendChild(row('Shadow', makeField('boxShadow', {
      placeholder: 'none', menu: () => tokenGroups('boxShadow'),
    })));
    body.appendChild(row('Opacity', makeField('opacity', {
      placeholder: '100',
      scale: () => ['0','5','10','20','25','30','40','50','60','70','75','80','90','95','100'],
      menu: () => [{ label: 'opacity', items: ['0','25','50','75','90','100'].map((v) => ({ value: v, label: v })) }],
    })));
    body.appendChild(row('Overflow', makeField('overflow', {
      placeholder: 'visible',
      menu: () => [{ label: 'overflow', items: ['auto','hidden','clip','visible','scroll'].map((v) => ({ value: v, label: v })) }],
    })));
    body.appendChild(row('Cursor', makeField('cursor', {
      placeholder: 'auto',
      menu: () => [{ label: 'cursor', items: ['pointer','default','not-allowed','wait','text','move','grab'].map((v) => ({ value: v, label: v })) }],
    })));
  }));

  renderClassNameFoot();
}

function renderBreadcrumb(el) {
  const bar = document.createElement('div');
  bar.className = 'breadcrumb';
  const chain = ancestorsOf(el);
  const parts = [...chain, el];
  const shown = parts.length > 5 ? parts.slice(parts.length - 5) : parts;
  if (parts.length > shown.length) {
    const more = document.createElement('span');
    more.className = 'sep';
    more.textContent = '…';
    bar.appendChild(more);
  }
  shown.forEach((node, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      bar.appendChild(sep);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = node.tagName;
    btn.title = `line ${node.line}`;
    if (node === el) btn.className = 'current';
    btn.addEventListener('click', () => selectElement(node));
    bar.appendChild(btn);
  });
  return bar;
}

function renderHead(el) {
  const head = document.createElement('div');
  head.className = 'inspector-head';
  const kindBadge = el.classNameKind === 'call'
    ? `<span class="kind-badge call">${escapeHtml(el.classNameHelper || 'cn')}()</span>`
    : el.classNameKind === 'template'
      ? '<span class="kind-badge template">template</span>'
      : '';
  head.innerHTML =
    `<span class="tag">&lt;${escapeHtml(el.tagName)}&gt;</span>${kindBadge}` +
    `<span class="meta">${escapeHtml(basename(state.currentFilePath || ''))}:${el.line}</span>`;

  const ask = document.createElement('button');
  ask.type = 'button';
  ask.className = 'head-action';
  ask.innerHTML = ICONS.agent;
  ask.setAttribute('aria-label', 'Copy this element as context for an AI agent');
  ask.title = 'Copy as agent context — paste into Claude Code, Cursor, or any chat';
  ask.addEventListener('click', () => copyAgentContext(ask));
  head.appendChild(ask);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'head-action danger';
  del.innerHTML = ICONS.trash;
  const deletable = !!el.parentId;
  del.disabled = !deletable;
  del.setAttribute('aria-label', `Delete this ${el.tagName}`);
  del.title = deletable
    ? `Delete this <${el.tagName}> (Del) — undo with ${MOD}Z`
    : 'The outermost element of a component cannot be deleted here';
  del.addEventListener('click', deleteSelected);
  head.appendChild(del);
  return head;
}

function renderVariantBar(el) {
  const bar = document.createElement('div');
  bar.className = 'variant-bar';

  const bpRow = document.createElement('div');
  bpRow.className = 'variant-row';
  bpRow.innerHTML = '<span class="vlabel">Size</span>';
  const bpSeg = document.createElement('div');
  bpSeg.className = 'seg';
  for (const bp of BREAKPOINTS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = bp.label;
    const key = variantKeyOf([bp.key, state.variantState].filter(Boolean));
    btn.className = (state.breakpoint === bp.key ? 'active ' : '') +
      (bp.key && variantHasValues(key) ? 'has-value' : '');
    btn.title = bp.min ? `${bp.label} — ${bp.min}px and up` : 'Base styles (all sizes)';
    btn.addEventListener('click', () => {
      state.breakpoint = bp.key;
      // Editing a breakpoint you cannot see is guesswork, so widen the canvas
      // to that breakpoint when it is currently narrower.
      if (bp.min) matchViewportToBreakpoint(bp.min);
      renderInspector();
      publishSelection();
    });
    bpSeg.appendChild(btn);
  }
  bpRow.appendChild(bpSeg);
  bar.appendChild(bpRow);

  const stRow = document.createElement('div');
  stRow.className = 'variant-row';
  stRow.innerHTML = '<span class="vlabel">State</span>';
  const stSeg = document.createElement('div');
  stSeg.className = 'seg';

  const known = new Map([...STATES_INLINE, ...STATES_MORE].map((s) => [s.key, s.label]));
  // Any state variant already present in this element's classes deserves a
  // visible tab — that is how you discover a `group-hover:` someone hand-wrote.
  const present = [];
  for (const v of (el.props && el.props.variants) || []) {
    for (const part of v.split(':')) {
      if (!part || BREAKPOINT_KEYS.has(part)) continue;
      if (!present.includes(part)) present.push(part);
    }
  }
  const inline = [...STATES_INLINE];
  for (const key of present) {
    if (!inline.some((s) => s.key === key)) inline.push({ key, label: known.get(key) || key });
  }
  if (state.variantState && !inline.some((s) => s.key === state.variantState)) {
    inline.push({ key: state.variantState, label: known.get(state.variantState) || state.variantState });
  }

  for (const st of inline) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = st.label;
    btn.title = st.key ? `${st.key}: variant` : 'No state variant';
    const key = variantKeyOf([state.breakpoint, st.key].filter(Boolean));
    btn.className = (state.variantState === st.key ? 'active ' : '') +
      (st.key && variantHasValues(key) ? 'has-value' : '');
    btn.addEventListener('click', () => {
      state.variantState = st.key;
      renderInspector();
      publishSelection();
    });
    stSeg.appendChild(btn);
  }

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'more';
  more.textContent = '···';
  more.title = 'More states';
  more.addEventListener('click', () => {
    openMenu(more, {
      value: state.variantState,
      placeholder: 'Search states',
      groups: [{
        label: 'state variants',
        items: [{ key: '', label: 'Default' }, ...STATES_MORE, ...STATES_INLINE.slice(1)]
          .filter((s, i, arr) => arr.findIndex((x) => x.key === s.key) === i)
          .map((s) => ({
            value: s.key,
            label: s.label,
            detail: s.key && variantHasValues(variantKeyOf([state.breakpoint, s.key].filter(Boolean))) ? 'set' : '',
          })),
      }],
      onPick: (v) => { state.variantState = v; renderInspector(); publishSelection(); },
    });
  });
  stSeg.appendChild(more);

  stRow.appendChild(stSeg);
  bar.appendChild(stRow);

  if (isVariantMode()) {
    const note = document.createElement('div');
    note.className = 'variant-note';
    const prefix = currentVariants().join(':');
    note.innerHTML = `Editing <b>${escapeHtml(prefix)}:</b> — empty fields inherit from Base.`;
    bar.appendChild(note);
  }
  return bar;
}

function renderTextSection(el) {
  const kind = el.textKind || 'empty';
  const editable = kind === 'text' || kind === 'empty';
  const wrap = document.createElement('div');
  wrap.className = 'text-content';

  const badges = {
    expression: 'dynamic', children: 'has elements', empty: 'empty', text: '',
  };
  const hints = {
    expression: 'Renders {expression} children — edit this in your editor.',
    children: 'Wraps other elements. Select a child to edit its text.',
    empty: 'No text yet. Typing here inserts text content.',
    text: '',
  };
  wrap.innerHTML = `<div class="label">Text${badges[kind] ? ` <span class="badge">${escapeHtml(badges[kind])}</span>` : ''}</div>`;
  const ta = document.createElement('textarea');
  ta.rows = 2;
  ta.spellcheck = true;
  ta.id = 'text-content-input';
  ta.value = el.textContent || '';
  ta.disabled = !editable;
  ta.placeholder = editable ? 'Type to replace the text' : '';
  ta.addEventListener('input', () => {
    state.selected.textContent = ta.value;
    queueText(ta.value);
  });
  wrap.appendChild(ta);
  if (hints[kind]) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = hints[kind];
    wrap.appendChild(hint);
  }
  return wrap;
}

function renderClassNameFoot() {
  const el = state.selected;
  const foot = $('classname-foot');
  if (!el) { foot.hidden = true; return; }
  foot.hidden = false;

  const kindEl = $('classname-kind');
  kindEl.textContent = '';

  const host = $('classname-tokens');
  const tokens = (el.props && el.props.tokens) || [];
  if (!tokens.length) {
    host.innerHTML = '<span class="cls-empty">no classes yet</span>';
    return;
  }
  host.innerHTML = tokens.map((t) => {
    const dynamic = /^__FRAMELAB_EXPR_\d+__$/.test(t.raw);
    const cls = dynamic ? 'dynamic' : (t.variants && t.variants.length ? 'variant' : (t.prop ? 'known' : ''));
    const text = dynamic ? '${…}' : t.raw;
    const title = dynamic ? 'A ${...} interpolation, preserved as-is' : (t.prop || 'not recognised');
    return `<span class="cls-token ${cls}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
  }).join('');
}

$('classname-copy').addEventListener('click', async () => {
  const el = state.selected;
  if (!el || !el.className) return;
  try {
    await navigator.clipboard.writeText(el.className);
    const btn = $('classname-copy');
    btn.textContent = 'copied';
    btn.classList.add('flash');
    setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('flash'); }, 900);
  } catch {
    toastError('Clipboard is unavailable in this context.');
  }
});

// A plain-text brief for whoever is going to act on this element. Agents with
// the Framelab MCP server can call get_selection instead; this is for everyone
// pasting into a chat window.
function agentContextFor(el) {
  const file = relPath(state.currentFilePath || '');
  const lines = [];
  lines.push(`${el.tagName} in ${file} line ${el.line}`);
  const chain = ancestorsOf(el).map((a) => a.tagName);
  if (chain.length) lines.push(`Nested in: ${chain.join(' > ')} > ${el.tagName}`);
  if (el.className) lines.push(`Classes: ${el.className}`);
  else lines.push('Classes: (none yet)');
  if (el.classNameKind === 'call') {
    lines.push(`Classes live in the first argument of ${el.classNameHelper || 'cn'}(); the other arguments must not change.`);
  } else if (el.classNameKind === 'template') {
    lines.push('Classes live in a template literal; the ${...} interpolations must stay in place.');
  } else if (el.classNameEditable === false) {
    lines.push('Note: this className is a dynamic expression, so it needs a careful hand edit.');
  }
  if (el.textContent) lines.push(`Text: ${JSON.stringify(el.textContent)}`);
  const prefix = currentVariants().join(':');
  if (prefix) lines.push(`I am editing the ${prefix}: variant, so target that breakpoint/state.`);
  const variants = (el.props && el.props.variants || []).filter(Boolean);
  if (variants.length) lines.push(`Existing variants on this element: ${variants.join(', ')}`);
  lines.push(`framelabId: ${el.framelabId}`);
  lines.push('');
  lines.push('Change I want: ');
  return lines.join('\n');
}

async function copyAgentContext(btn) {
  const el = state.selected;
  if (!el) return;
  const text = agentContextFor(el);
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.innerHTML;
    btn.innerHTML = ICONS.check || '✓';
    btn.classList.add('ok');
    setTimeout(() => { btn.innerHTML = original; btn.classList.remove('ok'); }, 1100);
    toast('Element context copied — paste it to your agent');
  } catch {
    toastError('Clipboard is unavailable in this context.');
  }
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

function renderViewportControls() {
  const group = $('viewport-group');
  group.innerHTML = '';
  for (const vp of VIEWPORTS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = vp.label;
    btn.className = UI.viewport === vp.key ? 'active' : '';
    btn.title = vp.width ? `${vp.width}px wide` : 'Fill the available width';
    btn.addEventListener('click', () => setViewport(vp.key));
    group.appendChild(btn);
  }
}

function setViewport(key) {
  UI.viewport = key;
  saveUiPrefs();
  const vp = VIEWPORTS.find((v) => v.key === key) || VIEWPORTS[0];
  const shell = $('iframe-shell');
  shell.style.width = vp.width ? vp.width + 'px' : '100%';
  renderViewportControls();
  updateViewportReadout();
  // The outline was measured against the old width.
  requestAnimationFrame(() => postToIframe({ type: 'FRAMELAB_MEASURE' }));
}

function matchViewportToBreakpoint(minWidth) {
  const current = $('iframe-shell').getBoundingClientRect().width;
  if (current >= minWidth) return;
  const target = VIEWPORTS.filter((v) => v.width && v.width >= minWidth)
    .sort((a, b) => a.width - b.width)[0];
  if (target) {
    setViewport(target.key);
    toast(`Canvas widened to ${target.width}px so ${minWidth}px styles are visible`);
  }
}

function updateViewportReadout() {
  const w = Math.round($('iframe-shell').getBoundingClientRect().width);
  $('viewport-width').textContent = w ? `${w}px` : '';
}

// ---------------------------------------------------------------------------
// Panels, theme, resize
// ---------------------------------------------------------------------------

function applyRightWidth(width) {
  UI.rightWidth = Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, width));
  document.querySelector('.layout').style.setProperty('--right-width', UI.rightWidth + 'px');
}
function setupRightResize() {
  const handle = $('resize-right');
  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startWidth = UI.rightWidth;
    handle.classList.add('dragging');
    document.body.classList.add('is-resizing');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    applyRightWidth(startWidth + (startX - e.clientX));
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.classList.remove('is-resizing');
    saveUiPrefs();
    updateViewportReadout();
  });
  handle.addEventListener('dblclick', () => { applyRightWidth(RIGHT_DEFAULT); saveUiPrefs(); });
}

function setPanel(side, visible) {
  UI.panels[side] = visible;
  document.querySelector('.layout').classList.toggle(`${side}-collapsed`, !visible);
  const btn = $(`${side}-toggle`);
  if (btn) {
    btn.classList.toggle('active', visible);
    const shortcut = side === 'left' ? `${MOD}B` : `${MOD}J`;
    btn.title = `${visible ? 'Hide' : 'Show'} ${side === 'left' ? 'files and layers' : 'inspector'} (${shortcut})`;
  }
  saveUiPrefs();
  requestAnimationFrame(updateViewportReadout);
}
function togglePanel(side) { setPanel(side, !UI.panels[side]); }

function setUiTheme(theme) {
  UI.theme = theme;
  document.documentElement.dataset.theme = theme;
  const btn = $('theme-toggle');
  btn.innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon;
  btn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  saveUiPrefs();
}

function switchTab(tab) {
  $('tab-inspector').classList.toggle('active', tab === 'inspector');
  $('tab-diff').classList.toggle('active', tab === 'diff');
  $('pane-inspector').classList.toggle('active', tab === 'inspector');
  $('pane-diff').classList.toggle('active', tab === 'diff');
}

// ---------------------------------------------------------------------------
// Diff panel
// ---------------------------------------------------------------------------

const diffState = { data: null, collapsed: new Set() };
const sessionLog = {
  commits: [],
  record(sha, message, kind) {
    if (!sha) return;
    this.commits.unshift({ sha, message, kind: kind || 'edit', time: new Date() });
    if (this.commits.length > 200) this.commits.length = 200;
    if (UI.autoCommit) renderDiff(diffState.data);
  },
};

function autoCommitMessage(kind, ctx) {
  const file = ctx.filePath ? basename(ctx.filePath) : '';
  const where = (ctx.tagName && ctx.line) ? ` ${ctx.tagName}@L${ctx.line}` : '';
  const fileTag = file ? `(${file})` : '';
  switch (kind) {
    case 'style': {
      const parts = (ctx.changes || []).slice(0, 3).map((c) => {
        const v = c.value == null ? '∅'
          : (typeof c.value === 'object' ? Object.entries(c.value).filter(([, x]) => x != null).map(([k, x]) => `${k} ${x}`).join(' ') : String(c.value));
        const prefix = (c.variants && c.variants.length) ? c.variants.join(':') + ':' : '';
        return `${prefix}${c.prop} → ${v}`;
      });
      const more = (ctx.changes && ctx.changes.length > 3) ? `, +${ctx.changes.length - 3} more` : '';
      return `style${fileTag}:${where} ${parts.join(', ')}${more}`;
    }
    case 'text': {
      const t = (ctx.text || '').replace(/\s+/g, ' ').trim();
      return `text${fileTag}:${where} → ${JSON.stringify(t.length > 40 ? t.slice(0, 40) + '…' : t)}`;
    }
    case 'move': return `move${fileTag}:${where} ${ctx.position} ${ctx.targetTag}@L${ctx.targetLine}`;
    case 'delete': return `remove${fileTag}:${where}`;
    case 'revert-hunk': return `revert${fileTag}: hunk ${ctx.hunkIndex}`;
    case 'revert-file': return `revert${fileTag}`;
    default: return `edit${fileTag}`;
  }
}

async function maybeAutoCommit(kind, ctx) {
  if (!UI.autoCommit) return;
  const message = autoCommitMessage(kind, ctx);
  try {
    const body = await api('POST', '/diff/commit', { message });
    if (body && body.sha) sessionLog.record(body.sha, message, kind.split('-')[0]);
  } catch (err) {
    toastError(`Auto-commit failed: ${err.message}`);
  }
}

function setAutoCommit(on) {
  UI.autoCommit = !!on;
  $('auto-commit-toggle').classList.toggle('on', UI.autoCommit);
  const hide = UI.autoCommit ? 'none' : '';
  $('diff-commit-btn').style.display = hide;
  $('diff-discard-btn').style.display = hide;
  $('commit-message').style.display = hide;
  saveUiPrefs();
  renderDiff(diffState.data);
}

async function fetchDiff() {
  try { renderDiff(await api('GET', '/diff')); }
  catch (err) { console.warn('fetchDiff failed', err); }
}

function renderDiff(data) {
  diffState.data = data || { initialized: false, files: [], diff: '' };
  const fileCount = (data && data.files && data.files.length) || 0;
  const badge = $('diff-badge');
  const list = $('diff-list');
  $('diff-commit-btn').disabled = fileCount === 0;
  $('diff-discard-btn').disabled = fileCount === 0;
  const msgEl = $('commit-message');
  if (msgEl && !msgEl.value && data && data.suggestedMessage) msgEl.value = data.suggestedMessage;
  if (msgEl && fileCount === 0) msgEl.value = '';

  if (UI.autoCommit) {
    badge.textContent = String(sessionLog.commits.length);
    badge.classList.toggle('zero', sessionLog.commits.length === 0);
    list.innerHTML = renderSessionLog();
    return;
  }

  badge.textContent = String(fileCount);
  badge.classList.toggle('zero', fileCount === 0);

  if (!data || !data.initialized) {
    list.innerHTML = '<div class="diff-empty">Not a git repository.<br/><br/><span style="font-size:11px">Run <span class="mono">git init</span> to track your edits here.</span></div>';
    return;
  }
  if (fileCount === 0) {
    list.innerHTML = '<div class="diff-empty">No pending changes.<br/><br/><span style="font-size:11px">Edit a class or some text and the diff appears here.</span></div>';
    return;
  }

  const blocks = parseUnifiedDiff(data.diff || '');
  list.innerHTML = (data.files || []).map((f) => {
    const block = blocks[f.path] || { added: 0, removed: 0, lines: [] };
    const collapsed = diffState.collapsed.has(f.path);
    return `<div class="diff-file">
      <div class="diff-file-head ${collapsed ? 'collapsed' : ''}" data-toggle="${escapeHtml(f.path)}">
        <span class="chev">▾</span>
        <span class="path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span>
        <span class="stat"><span class="add">+${block.added}</span> <span class="del">-${block.removed}</span></span>
        <button class="revert-btn" data-revert="${escapeHtml(f.path)}" title="Revert this file to HEAD">revert file</button>
      </div>
      <div class="diff-file-body ${collapsed ? 'collapsed' : ''}">
        ${block.lines.map((l) => renderDiffLine(l, f.path)).join('') ||
          '<div class="diff-line context" style="padding:8px 12px;color:var(--text3)">(new or untracked file)</div>'}
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-toggle]').forEach((head) => {
    head.addEventListener('click', (e) => {
      if (e.target.dataset && e.target.dataset.revert !== undefined) return;
      const fp = head.dataset.toggle;
      if (diffState.collapsed.has(fp)) diffState.collapsed.delete(fp);
      else diffState.collapsed.add(fp);
      renderDiff(diffState.data);
    });
  });
  list.querySelectorAll('[data-revert]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rel = btn.dataset.revert;
      showConfirmModal(`Discard all changes to <code>${escapeHtml(rel)}</code>? It will be restored to the last commit.`,
        () => revertFile(rel));
    });
  });
  list.querySelectorAll('[data-revert-hunk]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      revertHunk(btn.dataset.revertHunk, Number(btn.dataset.hunkIndex));
    });
  });
}

function renderSessionLog() {
  if (!sessionLog.commits.length) {
    return `<div class="session-empty">No commits yet this session.<br/><br/>
      <span style="font-size:11px">Every edit commits automatically while Auto is on.</span></div>`;
  }
  const fmt = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return sessionLog.commits.map((c) => `<div class="session-entry">
      <div class="row1">
        <span class="time">${fmt(c.time)}</span>
        <span class="kind ${escapeHtml(c.kind)}">${escapeHtml(c.kind)}</span>
        <span class="sha">${escapeHtml(c.sha)}</span>
      </div>
      <div class="msg">${escapeHtml(c.message)}</div>
    </div>`).join('');
}

function parseUnifiedDiff(diffText) {
  const result = {};
  if (!diffText) return result;
  const lines = diffText.split('\n');
  let currentFile = null;
  let hunkIdx = -1;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.*?) b\/(.+)$/);
      const fp = (m && m[2]) || null;
      if (fp) { currentFile = fp; result[currentFile] = { added: 0, removed: 0, lines: [] }; hunkIdx = -1; }
      continue;
    }
    if (!currentFile) continue;
    if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename |Binary files)/.test(line)) continue;
    if (line.startsWith('@@')) {
      hunkIdx++;
      result[currentFile].lines.push({ kind: 'hunk', text: line, hunkIndex: hunkIdx });
    } else if (line.startsWith('+')) {
      result[currentFile].added++;
      result[currentFile].lines.push({ kind: 'add', text: line, hunkIndex: hunkIdx });
    } else if (line.startsWith('-')) {
      result[currentFile].removed++;
      result[currentFile].lines.push({ kind: 'del', text: line, hunkIndex: hunkIdx });
    } else {
      result[currentFile].lines.push({ kind: 'context', text: line, hunkIndex: hunkIdx });
    }
  }
  return result;
}

function renderDiffLine(line, filePath) {
  if (line.kind === 'hunk') {
    return `<div class="diff-line hunk">
      <span class="hunk-text">${escapeHtml(line.text)}</span>
      <button class="hunk-revert-btn" data-revert-hunk="${escapeHtml(filePath)}" data-hunk-index="${line.hunkIndex}" title="Revert just this hunk">revert hunk</button>
    </div>`;
  }
  return `<div class="diff-line ${line.kind}">${escapeHtml(line.text)}</div>`;
}

function showConfirmModal(descHtml, onConfirm) {
  const backdrop = $('confirm-modal');
  $('modal-desc').innerHTML = descHtml;
  backdrop.classList.add('show');
  function close() {
    backdrop.classList.remove('show');
    backdrop.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  function onBackdrop(e) { if (e.target === backdrop) close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', onBackdrop);
  $('modal-cancel').onclick = close;
  $('modal-confirm').onclick = () => { close(); onConfirm(); };
  $('modal-confirm').focus();
}

async function revertFile(rel) {
  try {
    await api('POST', '/diff/revert-file', { filePath: rel });
    reloadIframe();
    if (state.currentFilePath && state.currentFilePath.endsWith(rel)) await loadFile(state.currentFilePath);
    toast(`Reverted ${rel}`);
    await maybeAutoCommit('revert-file', { filePath: rel });
  } catch (err) {
    toastError(`Revert failed: ${err.message}`);
  }
}

async function revertHunk(rel, hunkIndex) {
  try {
    await api('POST', '/diff/revert-hunk', { filePath: rel, hunkIndex });
    if (state.currentFilePath && state.currentFilePath.endsWith(rel)) await loadFile(state.currentFilePath);
    reloadIframe();
    await maybeAutoCommit('revert-hunk', { filePath: rel, hunkIndex });
  } catch (err) {
    toastError(`Revert hunk failed: ${err.message}`);
  }
}

function discardAll() {
  showConfirmModal('Discard <b>all</b> pending changes and reset to the last commit?', async () => {
    try {
      await api('POST', '/diff/discard-all');
      toast('All changes discarded');
    } catch (err) {
      toastError(`Discard failed: ${err.message}`);
    }
  });
}

async function commitChanges() {
  const msg = $('commit-message').value.trim();
  if (!msg) { toastError('A commit message is required.'); return; }
  try {
    const body = await api('POST', '/diff/commit', { message: msg });
    $('commit-message').value = '';
    if (body.sha) {
      sessionLog.record(body.sha, msg, 'manual');
      toast(`Committed ${body.sha}`);
    }
  } catch (err) {
    toastError(`Commit failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// One shortcut handler for both sources: keys pressed in the canvas, and keys
// the preview forwards after a click moved focus into the iframe.
function handleShortcut(e) {
  const mod = e.metaKey || e.ctrlKey;
  const prevent = () => { if (e.preventDefault) e.preventDefault(); };

  if (mod && String(e.key).toLowerCase() === 'z') {
    prevent();
    if (e.shiftKey) redo(); else undo();
    return true;
  }
  if (mod && !e.shiftKey && !e.altKey) {
    const k = String(e.key).toLowerCase();
    if (k === 'b') { prevent(); togglePanel('left'); return true; }
    if (k === 'j') { prevent(); togglePanel('right'); return true; }
  }
  if (e.key === 'Escape') {
    if ($('popover').classList.contains('show')) return false;
    clearSelection();
    return true;
  }
  if (!state.selected) return false;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    prevent();
    deleteSelected();
    return true;
  }
  if (e.key === 'ArrowUp') {
    const parents = ancestorsOf(state.selected);
    const parent = parents[parents.length - 1];
    if (parent) { prevent(); selectElement(parent); return true; }
  } else if (e.key === 'ArrowDown') {
    const kids = childrenOf(state.selected);
    if (kids.length) { prevent(); selectElement(kids[0]); return true; }
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const sibs = siblingsOf(state.selected);
    const i = sibs.findIndex((s) => s.stableKey === state.selected.stableKey);
    const next = sibs[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) { prevent(); selectElement(next); return true; }
  }
  return false;
}

document.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) {
    // Undo is the one shortcut that should still work from a field.
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'z') return;
    return;
  }
  handleShortcut(e);
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function bindPanelHeads() {
  document.querySelectorAll('[data-panel-toggle]').forEach((head) => {
    const key = head.dataset.panelToggle;
    const body = head.nextElementSibling;
    const collapsed = UI.collapsedPanels.has(key);
    head.classList.toggle('collapsed', collapsed);
    body.classList.toggle('collapsed', collapsed);
    head.querySelector('.chev').innerHTML = ICONS.chevDown;
    head.addEventListener('click', () => {
      const now = !UI.collapsedPanels.has(key);
      if (now) UI.collapsedPanels.add(key); else UI.collapsedPanels.delete(key);
      head.classList.toggle('collapsed', now);
      body.classList.toggle('collapsed', now);
      saveUiPrefs();
    });
  });
}

function init() {
  loadUiPrefs();
  setUiTheme(UI.theme);

  $('theme-toggle').addEventListener('click', () => setUiTheme(UI.theme === 'dark' ? 'light' : 'dark'));
  $('left-toggle').innerHTML = ICONS.panelLeft;
  $('right-toggle').innerHTML = ICONS.panelRight;
  $('undo-btn').innerHTML = ICONS.undo;
  $('redo-btn').innerHTML = ICONS.redo;
  $('reload-btn').innerHTML = ICONS.refresh;
  $('diff-refresh-btn').innerHTML = ICONS.refresh;
  $('undo-btn').addEventListener('click', undo);
  $('redo-btn').addEventListener('click', redo);
  $('reload-btn').addEventListener('click', () => { reloadIframe(); toast('Preview reloaded'); });
  $('reload-btn').title = 'Reload the preview';
  $('left-toggle').addEventListener('click', () => togglePanel('left'));
  $('right-toggle').addEventListener('click', () => togglePanel('right'));

  applyRightWidth(UI.rightWidth);
  setupRightResize();
  setPanel('left', UI.panels.left);
  setPanel('right', UI.panels.right);
  bindPanelHeads();
  renderHistoryButtons();
  renderViewportControls();
  setViewport(UI.viewport);

  document.querySelectorAll('.right-tabs button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  $('diff-refresh-btn').addEventListener('click', fetchDiff);
  $('diff-discard-btn').addEventListener('click', discardAll);
  $('diff-commit-btn').addEventListener('click', commitChanges);
  $('commit-message').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') commitChanges();
  });
  $('auto-commit-toggle').addEventListener('click', () => setAutoCommit(!UI.autoCommit));
  setAutoCommit(UI.autoCommit);

  window.addEventListener('resize', updateViewportReadout);

  $('app-iframe').src = APP_URL;
  $('app-iframe').addEventListener('load', () => {
    if (state.selectedDomId) {
      postToIframe({ type: 'FRAMELAB_SELECT', framelabId: state.selectedDomId });
    }
  });

  connectWS();
  fetchFiles();
  api('GET', '/theme').then(applyTheme).catch(() => applyTheme(null));
  fetchDiff();
  renderLayerTree();
  updateViewportReadout();
}

init();
