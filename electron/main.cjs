// electron/main.cjs — FH6 desktop overlay + system tray.
//
// Reuses the exact same widget pages served by src/server.js. Each enabled
// widget gets its own frameless, transparent, always-on-top window that sits
// over the game (requires FH6 in *borderless* mode, not exclusive fullscreen).
// The Node telemetry server is launched as a hidden child process so there is
// no console window; OBS keeps working because that server still serves :9000.
//
// CommonJS (.cjs) on purpose: the project package.json is `type:module`, and a
// .cjs entry sidesteps every Electron ESM-main caveat across versions.

const { app, BrowserWindow, Tray, Menu, screen, shell, globalShortcut, nativeImage, ipcMain, clipboard } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.join(__dirname, '..');
const SERVER_ENTRY = path.join(APP_ROOT, 'src', 'server.js');
const ASSETS = path.join(__dirname, 'assets');
const PREFS_FILE = () => path.join(app.getPath('userData'), 'overlay-prefs.json');

// Network config lives in prefs (no .env dependency) — set from prefs.network in init().
// The spawned server receives these via env vars, which override any stray .env.
let httpPort = 9000;
let udpHost = '0.0.0.0';
let udpPort = 20777;
let baseUrl = `http://localhost:${httpPort}`;
function applyNetwork() {
  httpPort = prefs.network.httpPort;
  udpHost = prefs.network.udpHost;
  udpPort = prefs.network.udpPort;
  baseUrl = `http://localhost:${httpPort}`;
}

// --- Widget catalog -------------------------------------------------------
// w/h are content-sized defaults (pages center their content, so the window
// only needs to be big enough to contain it). `on` is the first-run default.
const WIDGETS = [
  { id: 'speedometer', file: 'speedometer.html', label: 'Speed',        w: 380, h: 340, on: true,  anchor: 'bottom-center' },
  { id: 'shift',       file: 'shift.html',       label: 'Shift light',  w: 620, h: 220, on: true,  anchor: 'top-center'    },
  { id: 'delta',       file: 'delta.html',       label: 'Lap delta',    w: 440, h: 360, on: true,  anchor: 'bottom-right'  },
  { id: 'car',         file: 'car.html',         label: 'Vehicle',      w: 460, h: 220, on: true,  anchor: 'top-left'      },
  { id: 'tires',       file: 'tires.html',       label: 'Tires',        w: 320, h: 340, on: false, anchor: 'top-right'     },
  { id: 'gforce',      file: 'gforce.html',      label: 'G-Force',      w: 300, h: 380, on: false, anchor: 'bottom-left'   },
  { id: 'index',       file: 'index.html',       label: 'Combined HUD', w: 460, h: 280, on: false, anchor: 'center'        },
];
const WIDGET_BY_ID = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));
const SCALES = [0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
const FONTS = ['Orbitron', 'Rajdhani', 'Russo One', 'Chakra Petch', 'Teko', 'Barlow Condensed', 'Roboto Mono', 'monospace'];
// Per-widget toggleable fields (key -> label). Widgets mark them with data-field="<key>".
const FIELDS = {
  speedometer: { gear: 'Gear box' },
  shift: { rpm: 'RPM / gear readout' },
  delta: { best: 'Best-lap line', bar: 'Delta bar' },
  car: { meta: 'Class / PI / drivetrain' },
  gforce: { read: 'Lat / Lon / Peak readout' },
  tires: {},
  index: { pedals: 'Throttle / Brake', tires: 'Tire row', lap: 'Lap row' },
};
// Per-widget visual styles (first = default). Emitted as ?style=<value>.
const WIDGET_STYLES = {
  speedometer: ['digital', 'analog', 'cinematic'],
  tires: ['grid', 'corners'],
  gforce: ['circle', 'ball'],
  shift: ['bar', 'arc'],
};
// Global theme skins (skin.css). Emitted as ?skin=<value> when not 'classic'.
const SKINS = ['classic', 'cinematic', 'neon', 'carbon', 'wec'];

// --- Preferences (persisted in userData) ----------------------------------
// Appearance: global theme (accent/alert color, bg opacity, font, units) plus
// per-widget overrides (scale, opacity, field show/hide). '' color = no override.
function defaultAppearance() {
  const a = { accent: '', alert: '', bg: 0, font: 'Orbitron', skin: 'classic', units: { speed: 'kmh', temp: 'c' }, widgets: {} };
  for (const w of WIDGETS) a.widgets[w.id] = { scale: 1, op: 1, style: '', fields: {} };
  return a;
}
function defaultNetwork() {
  // loopback by default (game on the same PC); switch to 0.0.0.0 in Settings for a separate console/PC
  return { udpHost: '127.0.0.1', udpPort: 20777, httpPort: 9000 };
}
function defaultPrefs() {
  const prefs = { locked: true, hidden: false, autostart: false, gateToGame: true, appearance: defaultAppearance(), network: defaultNetwork(), widgets: {} };
  for (const w of WIDGETS) prefs.widgets[w.id] = { enabled: w.on, x: null, y: null };
  return prefs;
}
function mergeNetwork(base, saved) {
  if (typeof saved.udpHost === 'string' && /^[\w.]+$/.test(saved.udpHost)) base.udpHost = saved.udpHost;
  if (Number.isInteger(saved.udpPort) && saved.udpPort >= 1 && saved.udpPort <= 65535) base.udpPort = saved.udpPort;
  if (Number.isInteger(saved.httpPort) && saved.httpPort >= 1 && saved.httpPort <= 65535) base.httpPort = saved.httpPort;
  return base;
}
function mergeAppearance(base, saved) {
  if (typeof saved.accent === 'string') base.accent = saved.accent;
  if (typeof saved.alert === 'string') base.alert = saved.alert;
  if (typeof saved.bg === 'number') base.bg = Math.max(0, Math.min(1, saved.bg));
  if (typeof saved.font === 'string' && FONTS.includes(saved.font)) base.font = saved.font;
  if (typeof saved.skin === 'string' && SKINS.includes(saved.skin)) base.skin = saved.skin;
  if (saved.units) {
    if (saved.units.speed === 'mph' || saved.units.speed === 'kmh') base.units.speed = saved.units.speed;
    if (saved.units.temp === 'f' || saved.units.temp === 'c') base.units.temp = saved.units.temp;
  }
  for (const w of WIDGETS) {
    const s = saved.widgets?.[w.id];
    if (!s) continue;
    const t = base.widgets[w.id];
    if (typeof s.scale === 'number' && s.scale >= 0.4 && s.scale <= 3) t.scale = s.scale;
    if (typeof s.op === 'number' && s.op >= 0.1 && s.op <= 1) t.op = s.op;
    if (typeof s.style === 'string' && (WIDGET_STYLES[w.id] || []).includes(s.style)) t.style = s.style;
    if (s.fields && typeof s.fields === 'object') for (const k of Object.keys(FIELDS[w.id] || {})) if (k in s.fields) t.fields[k] = !!s.fields[k];
  }
  return base;
}
function loadPrefs() {
  const base = defaultPrefs();
  try {
    const saved = JSON.parse(fs.readFileSync(PREFS_FILE(), 'utf8'));
    base.locked = saved.locked ?? base.locked;
    base.hidden = saved.hidden ?? base.hidden;
    base.autostart = saved.autostart ?? base.autostart;
    base.gateToGame = saved.gateToGame ?? base.gateToGame;
    if (saved.appearance) base.appearance = mergeAppearance(base.appearance, saved.appearance);
    if (saved.network) base.network = mergeNetwork(base.network, saved.network);
    for (const w of WIDGETS) {
      const s = saved.widgets?.[w.id];
      if (s) base.widgets[w.id] = { enabled: s.enabled ?? w.on, x: s.x ?? null, y: s.y ?? null };
    }
  } catch { /* first run / corrupt → defaults */ }
  return base;
}
let saveTimer = null;
function savePrefs() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(PREFS_FILE(), JSON.stringify(prefs, null, 2));
    } catch { /* best effort */ }
  }, 400);
}

let prefs = defaultPrefs();
const windows = new Map(); // id -> BrowserWindow
let tray = null;
let settingsWin = null;
let serverChild = null;
let restartTimer = null;  // debounces server restarts on rapid network-config edits
let fgWatch = null;
let gameActive = false; // set by the foreground watcher; false until Forza is seen up front

// --- Telemetry server (hidden child) --------------------------------------
// Best-effort: if the port is already bound (OBS server already running, or a
// second overlay instance), the child exits and the overlay simply connects to
// whoever owns :9000. ELECTRON_RUN_AS_NODE makes electron.exe behave as Node.
function startServer() {
  if (serverChild) { try { serverChild.kill(); } catch {} serverChild = null; } // never leak a previous child
  try {
    serverChild = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: APP_ROOT,
      // pass network config from prefs; these override any .env in the child
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', UDP_HOST: udpHost, UDP_PORT: String(udpPort), HTTP_PORT: String(httpPort) },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    serverChild.on('error', () => { serverChild = null; });
    serverChild.stderr?.on('data', (d) => {
      if (/EADDRINUSE/.test(String(d))) serverChild = null; // external server owns the port
    });
  } catch { serverChild = null; }
}

function waitForServer(timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const ping = () => {
      const req = http.get(baseUrl + '/', (res) => { res.resume(); resolve(true); });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(ping, 300);
      });
      req.setTimeout(1000, () => req.destroy());
    };
    ping();
  });
}

// --- Appearance → URL params ----------------------------------------------
function widgetScale(id) {
  const w = prefs.appearance.widgets[id];
  return w && w.scale ? w.scale : 1;
}
// obs=true omits `scale`: in OBS you resize the Browser Source itself, so the zoom
// would double up. The overlay keeps `scale` (its window is sized to scale).
function appearanceParams(id, obs) {
  const a = prefs.appearance, w = a.widgets[id] || {};
  const p = new URLSearchParams();
  if (a.accent) p.set('accent', a.accent.replace('#', ''));
  if (a.alert) p.set('alert', a.alert.replace('#', ''));
  if (a.bg) p.set('bg', String(a.bg));
  if (a.font && a.font !== 'Orbitron') p.set('font', a.font);
  if (a.skin && a.skin !== 'classic') p.set('skin', a.skin);
  if (a.units.speed !== 'kmh') p.set('speed', a.units.speed);
  if (a.units.temp !== 'c') p.set('temp', a.units.temp);
  if (!obs && w.scale && w.scale !== 1) p.set('scale', String(w.scale));
  if (w.op != null && w.op !== 1) p.set('op', String(w.op));
  if (w.style) p.set('style', w.style);
  if (w.fields) for (const [k, v] of Object.entries(w.fields)) if (v === false) p.set('f_' + k, '0');
  return p.toString();
}
function widgetUrl(id, obs) {
  const qs = appearanceParams(id, obs);
  return `${baseUrl}/${WIDGET_BY_ID[id].file}${qs ? '?' + qs : ''}`;
}

// --- Window geometry ------------------------------------------------------
function anchoredPosition(widget) {
  const { x: ax, y: ay, width, height } = screen.getPrimaryDisplay().workArea;
  const m = 24;
  const w = Math.round(widget.w * widgetScale(widget.id));
  const h = Math.round(widget.h * widgetScale(widget.id));
  const cx = ax + Math.round((width - w) / 2);
  const cy = ay + Math.round((height - h) / 2);
  switch (widget.anchor) {
    case 'top-left':      return { x: ax + m, y: ay + m };
    case 'top-center':    return { x: cx, y: ay + m };
    case 'top-right':     return { x: ax + width - w - m, y: ay + m };
    case 'bottom-left':   return { x: ax + m, y: ay + height - h - m };
    case 'bottom-center': return { x: cx, y: ay + height - h - m };
    case 'bottom-right':  return { x: ax + width - w - m, y: ay + height - h - m };
    default:              return { x: cx, y: cy };
  }
}

// Pin a window to its own origin: deny popups and block navigation to other origins.
// Defence-in-depth — the widget pages never navigate, but a tampered/redirected page can't escape.
function hardenNavigation(wc, sameOrigin) {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    if (!sameOrigin) { e.preventDefault(); return; }              // settings window: never navigates
    try { if (new URL(url).origin !== new URL(sameOrigin).origin) e.preventDefault(); }
    catch { e.preventDefault(); }
  });
}

// --- Window creation ------------------------------------------------------
function createWidgetWindow(widget) {
  const saved = prefs.widgets[widget.id];
  const s = widgetScale(widget.id);
  const w = Math.round(widget.w * s);
  const h = Math.round(widget.h * s);
  const pos = (saved.x != null && saved.y != null) ? { x: saved.x, y: saved.y } : anchoredPosition(widget);

  const win = new BrowserWindow({
    width: w,
    height: h,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    thickFrame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: !prefs.locked,
    show: false,
    title: `FH6 — ${widget.label}`,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep updating while unfocused (overlays never have focus)
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');           // sit above borderless game windows
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setBackgroundThrottling(false);
  hardenNavigation(win.webContents, baseUrl);         // confine to the local origin; deny popups
  win.setIgnoreMouseEvents(prefs.locked);             // click-through from creation, before the page even loads

  // Clamp a saved position back on-screen (display layout may have changed).
  if (saved.x != null && saved.y != null) {
    const b = win.getBounds();
    const c = clampToDisplay(b.x, b.y, b.width, b.height);
    if (c.x !== b.x || c.y !== b.y) win.setPosition(c.x, c.y);
  }

  let reloadTimer = null, reloadTries = 0;
  win.loadURL(widgetUrl(widget.id));   // appearance is encoded in the query string (customize.js applies it)

  win.webContents.on('did-finish-load', () => {
    reloadTries = 0;                    // loaded OK → reset the retry budget
    injectEditChrome(win, widget.label);
    applyLockState(win);
  });
  // Server not up yet → retry a bounded number of times (the pages also self-reconnect over WS).
  win.webContents.on('did-fail-load', (_e, code) => {
    if (code === -3) return;            // aborted (e.g. during teardown)
    if (reloadTries >= 15) return;      // give up after ~12s; WS reconnect handles eventual recovery
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { if (!win.isDestroyed()) { reloadTries++; win.loadURL(widgetUrl(widget.id)); } }, 800);
  });

  win.once('ready-to-show', () => { if (shouldShow()) win.showInactive(); });

  const persistBounds = debounce(() => {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    prefs.widgets[widget.id].x = b.x;
    prefs.widgets[widget.id].y = b.y;
    savePrefs();
  }, 400);
  win.on('moved', persistBounds);

  win.on('closed', () => { clearTimeout(reloadTimer); windows.delete(widget.id); });
  windows.set(widget.id, win);
  return win;
}

// Inject a drag region + a labelled frame, shown only in "edit" (unlocked) mode.
// Lives entirely in the Electron context — the raw files OBS loads stay clean.
function injectEditChrome(win, label) {
  const js = `(() => {
    if (document.getElementById('ovl-style')) return;
    const s = document.createElement('style'); s.id = 'ovl-style';
    s.textContent =
      // -webkit-app-region is NOT inherited; widgets render content in positioned containers,
      // so the drag region must cover the whole subtree or the visible widget won't grab.
      'html.ovl-edit, html.ovl-edit body, html.ovl-edit body * { -webkit-app-region: drag; cursor: move; }' +
      '#ovl-frame { position: fixed; inset: 0; border: 2px dashed rgba(0,229,255,.85); pointer-events: none; display: none; z-index: 2147483647; }' +
      '#ovl-badge { position: fixed; top: 4px; left: 6px; font: 700 12px Arial,sans-serif; color: #00e5ff; background: rgba(0,0,0,.65); padding: 2px 8px; border-radius: 6px; pointer-events: none; display: none; z-index: 2147483647; letter-spacing: 1px; }' +
      'html.ovl-edit #ovl-frame, html.ovl-edit #ovl-badge { display: block; }';
    document.head.appendChild(s);
    const f = document.createElement('div'); f.id = 'ovl-frame'; document.body.appendChild(f);
    const b = document.createElement('div'); b.id = 'ovl-badge'; b.textContent = ${JSON.stringify('↔ ' + label)}; document.body.appendChild(b);
  })();`;
  win.webContents.executeJavaScript(js).catch(() => {});
}

function applyLockState(win) {
  const locked = prefs.locked;
  win.setIgnoreMouseEvents(locked);            // locked → clicks pass through to the game
  win.setFocusable(!locked);
  win.webContents
    .executeJavaScript(`document.documentElement.classList.toggle('ovl-edit', ${!locked});`)
    .catch(() => {});
}

// --- State mutations ------------------------------------------------------
function setWidgetEnabled(id, enabled) {
  prefs.widgets[id].enabled = enabled;
  if (enabled && prefs.hidden) setHidden(false); // explicit enable implies "show" (avoid an invisible enabled window)
  if (enabled && !windows.has(id)) createWidgetWindow(WIDGET_BY_ID[id]);
  else if (!enabled && windows.has(id)) windows.get(id).close();
  savePrefs();
  rebuildTray();
}

function setLocked(locked) {
  prefs.locked = locked;
  for (const win of windows.values()) if (!win.isDestroyed()) applyLockState(win);
  savePrefs();
  rebuildTray();
}

function setHidden(hidden) {
  prefs.hidden = hidden;
  updateVisibility();
  savePrefs();
  rebuildTray();
}

// Effective visibility = not manually hidden AND (gating off OR Forza is foreground).
function shouldShow() {
  return !prefs.hidden && (!prefs.gateToGame || gameActive);
}
function updateVisibility() {
  const show = shouldShow();
  for (const win of windows.values()) {
    if (win.isDestroyed()) continue;
    if (show && !win.isVisible()) win.showInactive();
    else if (!show && win.isVisible()) win.hide();
  }
  rebuildTray(); // refresh the "waiting for Forza" hint as the gating state changes
}
function setGateToGame(enabled) {
  prefs.gateToGame = enabled;
  updateVisibility();
  savePrefs();
  rebuildTray();
}

// --- Foreground gating: show overlays only while Forza is the active window ---
const GAME_PATTERN = /forzahorizon/i;          // "ForzaHorizon6" — NOT "forza-painter"/"ForzaMotorsport"
const SELF = path.basename(process.execPath).replace(/\.exe$/i, '').toLowerCase(); // our own process
let fgSeen = false;
function onForeground(name) {
  fgSeen = true;                               // watcher is alive and reporting
  if (name && name.toLowerCase() === SELF) return; // our tray/menu focus → keep current state
  const active = GAME_PATTERN.test(name);
  if (active !== gameActive) { gameActive = active; updateVisibility(); }
}
function startForegroundWatch() {
  try {
    fgWatch = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'foreground-watch.ps1'), String(process.pid)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    fgWatch.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '').trim();
        buf = buf.slice(nl + 1);
        onForeground(line);
      }
    });
    const failOpen = () => { fgWatch = null; if (!gameActive) { gameActive = true; updateVisibility(); } };
    fgWatch.on('error', failOpen);
    fgWatch.on('exit', failOpen);
  } catch { fgWatch = null; gameActive = true; updateVisibility(); }
  // Safety net: if the watcher never reports (PowerShell blocked), stop hiding everything.
  setTimeout(() => { if (!fgSeen) { gameActive = true; updateVisibility(); } }, 6000);
}

// Re-apply a widget's appearance live: resize the window for its scale, then push the
// new params into the already-loaded page (no reload → no flash while tweaking sliders).
function applyWidgetAppearance(id) {
  const win = windows.get(id);
  if (!win || win.isDestroyed()) return;
  const widget = WIDGET_BY_ID[id];
  const saved = prefs.widgets[id];
  const anchored = saved.x == null || saved.y == null; // null x/y means "follow the anchor"
  const nw = Math.round(widget.w * widgetScale(id));
  const nh = Math.round(widget.h * widgetScale(id));
  let nx, ny;
  if (anchored) { const p = anchoredPosition(widget); nx = p.x; ny = p.y; }
  else {
    const b = win.getBounds();
    nx = Math.round(b.x + (b.width - nw) / 2); // grow around the current centre
    ny = Math.round(b.y + (b.height - nh) / 2);
  }
  const b0 = win.getBounds();
  if (nw !== b0.width || nh !== b0.height) {  // only a scale change resizes/repositions
    const c = clampToDisplay(nx, ny, nw, nh);
    win.setBounds({ x: c.x, y: c.y, width: nw, height: nh });
    if (!anchored) { saved.x = c.x; saved.y = c.y; } // keep anchored widgets re-anchorable
  }
  const search = '?' + appearanceParams(id);
  win.webContents.executeJavaScript(`window.__applyCustomize && window.__applyCustomize(${JSON.stringify(search)})`).catch(() => {});
}

// Global theme change (accent/alert/bg/font/units) → re-apply to every open widget.
function setAppearance(patch) {
  const a = prefs.appearance;
  if (typeof patch.accent === 'string') a.accent = patch.accent;
  if (typeof patch.alert === 'string') a.alert = patch.alert;
  if (typeof patch.bg === 'number') a.bg = Math.max(0, Math.min(1, patch.bg));
  if (typeof patch.font === 'string' && FONTS.includes(patch.font)) a.font = patch.font;
  if (typeof patch.skin === 'string' && SKINS.includes(patch.skin)) a.skin = patch.skin;
  if (patch.units) {
    if (patch.units.speed === 'mph' || patch.units.speed === 'kmh') a.units.speed = patch.units.speed;
    if (patch.units.temp === 'f' || patch.units.temp === 'c') a.units.temp = patch.units.temp;
  }
  for (const id of windows.keys()) applyWidgetAppearance(id);
  savePrefs();
  rebuildTray();
}

// Per-widget override (scale/opacity/field toggles).
function setWidgetAppearance(id, patch) {
  const w = prefs.appearance.widgets[id];
  if (!w) return;
  if (typeof patch.scale === 'number' && patch.scale >= 0.4 && patch.scale <= 3) w.scale = patch.scale;
  if (typeof patch.op === 'number' && patch.op >= 0.1 && patch.op <= 1) w.op = patch.op;
  if (typeof patch.style === 'string' && (WIDGET_STYLES[id] || []).includes(patch.style)) w.style = patch.style;
  if (patch.field && typeof patch.field.key === 'string') w.fields[patch.field.key] = !!patch.field.on;
  applyWidgetAppearance(id);
  savePrefs();
  rebuildTray();
}

// Network config (UDP host/port, HTTP/WS port) → restart the server, reload widgets.
function setNetwork(patch) {
  const n = prefs.network;
  if (typeof patch.udpHost === 'string' && /^[\w.]+$/.test(patch.udpHost)) n.udpHost = patch.udpHost;
  if (Number.isInteger(patch.udpPort) && patch.udpPort >= 1 && patch.udpPort <= 65535) n.udpPort = patch.udpPort;
  if (Number.isInteger(patch.httpPort) && patch.httpPort >= 1 && patch.httpPort <= 65535) n.httpPort = patch.httpPort;
  applyNetwork();
  savePrefs();
  if (serverChild) { try { serverChild.kill(); } catch {} serverChild = null; }
  clearTimeout(restartTimer);        // coalesce a burst of port edits into a single restart
  restartTimer = setTimeout(() => {  // small gap so the old port is released before rebind
    startServer();
    waitForServer().then(() => {
      for (const id of windows.keys()) { const w = windows.get(id); if (w && !w.isDestroyed()) w.loadURL(widgetUrl(id)); }
    });
  }, 350);
  rebuildTray();
}

// Force every open overlay to reload from disk — picks up edited html/css/js (skin.css
// included). The server's no-store headers guarantee the freshest files are fetched.
function reloadOverlays() {
  for (const id of windows.keys()) {
    const win = windows.get(id);
    if (win && !win.isDestroyed()) win.loadURL(widgetUrl(id));
  }
}

function resetPositions() {
  for (const widget of WIDGETS) {
    prefs.widgets[widget.id].x = null;
    prefs.widgets[widget.id].y = null;
    const win = windows.get(widget.id);
    if (win && !win.isDestroyed()) {
      const pos = anchoredPosition(widget);
      win.setBounds({ x: pos.x, y: pos.y, width: Math.round(widget.w * widgetScale(widget.id)), height: Math.round(widget.h * widgetScale(widget.id)) });
    }
  }
  savePrefs();
}

// Login-item launch command: dev runs `electron main.cjs`; packaged runs the app exe directly.
function loginItemSettings(open) {
  // Portable build: process.execPath is a volatile temp-extracted copy (deleted on quit).
  // Register the stable launcher path the portable target exposes instead.
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  return {
    openAtLogin: open,
    path: exe,
    args: app.isPackaged ? [] : [path.join(__dirname, 'main.cjs')],
  };
}

function setAutostart(enabled) {
  prefs.autostart = enabled;
  app.setLoginItemSettings(loginItemSettings(enabled));
  savePrefs();
  rebuildTray();
}

// --- Tray -----------------------------------------------------------------
function trayIcon() {
  const p = path.join(ASSETS, 'tray.png');
  const img = nativeImage.createFromPath(p);
  if (!img.isEmpty()) return img;
  // fallback: solid amber dot so the tray entry is never invisible
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAQUlEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKAAAuB8B/Yl3p3wAAAAASUVORK5CYII='
  );
}

// Slim tray: everything rich now lives in the settings window. Left-click opens it.
function rebuildTray() {
  if (!tray) return;
  const waitingForGame = !prefs.hidden && prefs.gateToGame && !gameActive;
  const menu = Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: prefs.hidden ? 'Show overlays' : 'Hide overlays', click: () => setHidden(!prefs.hidden) },
    { label: 'Reload overlays', click: () => reloadOverlays() },
    { type: 'separator' },
    { label: 'Quit', click: () => quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(prefs.hidden ? 'FH6 Overlay (hidden)'
    : waitingForGame ? 'FH6 Overlay (waiting for Forza)'
    : 'FH6 Overlay');
  broadcastState();   // keep the settings window in sync with tray/shortcut/foreground changes
}

// --- Settings window + IPC ------------------------------------------------
function uiState() {
  return {
    port: httpPort,
    baseUrl,
    gameActive,
    locked: prefs.locked,
    hidden: prefs.hidden,
    gateToGame: prefs.gateToGame,
    autostart: prefs.autostart,
    scales: SCALES,
    fonts: FONTS,
    skins: SKINS,
    appearance: prefs.appearance,
    network: prefs.network,                       // { udpHost, udpPort, httpPort }
    widgets: WIDGETS.map((w) => ({
      id: w.id, label: w.label, file: w.file, w: w.w, h: w.h,
      enabled: !!prefs.widgets[w.id].enabled,
      url: widgetUrl(w.id, true),                 // customized Browser-Source URL for the OBS tab (no scale)
      appearance: prefs.appearance.widgets[w.id], // { scale, op, style, fields }
      fields: FIELDS[w.id] || {},                 // available field toggles for this widget
      styles: WIDGET_STYLES[w.id] || [],          // available visual styles (e.g. digital/analog)
    })),
  };
}

function broadcastState() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('fh6:state', uiState());
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 600, height: 620,
    title: 'FH6 Overlay — Settings',
    backgroundColor: '#15171c',
    icon: path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'tray.png'),
    autoHideMenuBar: true,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  hardenNavigation(settingsWin.webContents);          // privileged window (full IPC) → block all navigation + popups
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function registerIpc() {
  ipcMain.handle('fh6:get-state', () => uiState());
  ipcMain.handle('fh6:set-widget', (_e, id, on) => { if (WIDGET_BY_ID[id]) setWidgetEnabled(id, !!on); return uiState(); });
  ipcMain.handle('fh6:set-locked', (_e, v) => { setLocked(!!v); return uiState(); });
  ipcMain.handle('fh6:set-hidden', (_e, v) => { setHidden(!!v); return uiState(); });
  ipcMain.handle('fh6:set-gate', (_e, v) => { setGateToGame(!!v); return uiState(); });
  ipcMain.handle('fh6:set-appearance', (_e, patch) => { setAppearance(patch || {}); return uiState(); });
  ipcMain.handle('fh6:set-widget-appearance', (_e, id, patch) => { if (WIDGET_BY_ID[id]) setWidgetAppearance(id, patch || {}); return uiState(); });
  ipcMain.handle('fh6:set-autostart', (_e, v) => { setAutostart(!!v); return uiState(); });
  ipcMain.handle('fh6:set-network', (_e, patch) => { setNetwork(patch || {}); return uiState(); });
  ipcMain.handle('fh6:reset-positions', () => { resetPositions(); return uiState(); });
  ipcMain.handle('fh6:reload-overlays', () => { reloadOverlays(); return uiState(); });
  ipcMain.handle('fh6:open-external', (_e, url) => {
    if (typeof url !== 'string') return;
    try { // strict origin check (not a prefix) so only our local server can be opened
      const u = new URL(url);
      if (u.protocol === 'http:' && u.hostname === 'localhost' && u.port === String(httpPort)) shell.openExternal(url);
    } catch {}
  });
  ipcMain.handle('fh6:copy', (_e, text) => { if (typeof text === 'string') clipboard.writeText(text); });
}

// --- Lifecycle ------------------------------------------------------------
function openEnabledWindows() {
  for (const w of WIDGETS) if (prefs.widgets[w.id].enabled) createWidgetWindow(w);
}

function quit() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.destroy();
  for (const win of windows.values()) if (!win.isDestroyed()) win.destroy();
  windows.clear();
  if (serverChild) { try { serverChild.kill(); } catch {} serverChild = null; }
  if (fgWatch) { try { fgWatch.kill(); } catch {} fgWatch = null; }
  app.quit();
}

async function init() {
  prefs = loadPrefs();
  applyNetwork();          // set httpPort/udpHost/udpPort/baseUrl from prefs (no .env)
  registerIpc();
  startServer();
  startForegroundWatch();  // start FIRST: its ~300ms warmup overlaps server+window startup,
                           // so the foreground is already known by the time windows appear

  tray = new Tray(trayIcon());
  tray.setToolTip('FH6 Overlay');
  rebuildTray();
  tray.on('click', () => openSettings());               // left-click opens the settings window
  tray.on('double-click', () => openSettings());

  globalShortcut.register('CommandOrControl+Alt+L', () => setLocked(!prefs.locked));
  globalShortcut.register('CommandOrControl+Alt+H', () => setHidden(!prefs.hidden));

  await waitForServer();   // reduce first-load flicker; windows self-retry regardless
  openEnabledWindows();    // foreground already detected by now → correct visibility, no delay

  // Re-apply autostart registration to match the saved preference.
  app.setLoginItemSettings(loginItemSettings(prefs.autostart));
}

// Single instance: a second launch just exits (the first keeps owning the tray).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());
  app.whenReady().then(init);
}

// Stay alive in the tray even when every widget window is closed/disabled.
app.on('window-all-closed', () => { /* no-op: tray app */ });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (serverChild) { try { serverChild.kill(); } catch {} serverChild = null; }
  if (fgWatch) { try { fgWatch.kill(); } catch {} fgWatch = null; }
});

// Don't orphan child processes (server holds UDP+HTTP ports; watcher is a PowerShell
// loop) on a crash / hard exit. A SIGKILL/Task-Manager-end can't be caught; the
// startServer() EADDRINUSE tolerance then prevents a broken restart. These cover
// uncaughtException and normal exit.
function killChildren() {
  if (serverChild) { try { serverChild.kill(); } catch {} }
  if (fgWatch) { try { fgWatch.kill(); } catch {} }
}
process.once('exit', killChildren);
process.on('uncaughtException', () => { killChildren(); app.quit(); });

// --- utils ----------------------------------------------------------------
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Keep (x,y,w,h) inside the work area of whichever display it best matches.
function clampToDisplay(x, y, w, h) {
  const area = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - w),
    y: Math.min(Math.max(y, area.y), area.y + area.height - h),
  };
}
