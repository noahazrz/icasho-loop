'use strict';

const { app, BrowserWindow, ipcMain, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// ---------------------------------------------------------------------------
// Linux / Wayland
// Wayland no deja que una app normal se ponga "siempre encima" ni elegir su
// posicion. Corriendo la app por XWayland (X11) GNOME y KDE si respetan la
// propiedad "siempre encima". Si quieres Wayland nativo: ICASHO_NATIVE_WAYLAND=1
// (en ese modo el "siempre encima" depende de tu compositor y puede no funcionar).
// ---------------------------------------------------------------------------
if (process.platform === 'linux' && process.env.DISPLAY && !process.env.ICASHO_NATIVE_WAYLAND) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}
// Sin esto, Chromium bloquea el autoplay con sonido hasta que haya un clic.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const DEFAULTS = {
  user: 'icasho',
  ids: [],
  opacity: 1,
  muted: false,
  alwaysOnTop: true,
  bounds: { width: 340, height: 640 },
};

let state = { ...DEFAULTS };
let win = null;
let scanWin = null;
let scanCancelled = false;
let server = null;
let serverPort = 0;

// ---------------------------- estado persistente ---------------------------
const stateFile = () => path.join(app.getPath('userData'), 'state.json');

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    state = { ...DEFAULTS, ...raw };
  } catch (_) {
    state = { ...DEFAULTS };
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
      fs.writeFileSync(stateFile(), JSON.stringify(state));
    } catch (e) {
      console.error('No se pudo guardar el estado:', e.message);
    }
  }, 250);
}

function boundsAreVisible(b) {
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 &&
           b.y < a.y + a.height - 40 && b.y + b.height > a.y + 20;
  });
}

// ----------------------- servidor local para la interfaz -------------------
// Se sirve la interfaz por http://127.0.0.1 (en vez de file://) para que el
// reproductor de TikTok vea un origen http normal al incrustarse.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function startServer() {
  const root = path.join(__dirname, 'renderer');
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.normalize(path.join(root, p));
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });
}

// --------------------------------- ventana ---------------------------------
function cleanUserAgent() {
  return app.userAgentFallback
    .replace(/\s?Electron\/\S+/, '')
    .replace(/\s?icasho-loop\/\S+/i, '');
}

function pinWindow() {
  if (!win || win.isDestroyed()) return;
  if (state.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver');
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  } else {
    win.setAlwaysOnTop(false);
    try { win.setVisibleOnAllWorkspaces(false); } catch (_) {}
  }
}

function createWindow() {
  const b = state.bounds || DEFAULTS.bounds;
  const opts = {
    width: b.width || DEFAULTS.bounds.width,
    height: b.height || DEFAULTS.bounds.height,
    minWidth: 220,
    minHeight: 360,
    frame: false,
    resizable: true,
    show: false,
    backgroundColor: '#07060c',
    title: 'Icasho Loop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  };
  if (boundsAreVisible(b)) { opts.x = b.x; opts.y = b.y; }

  win = new BrowserWindow(opts);
  win.setOpacity(Math.min(1, Math.max(0.25, state.opacity || 1)));
  pinWindow();

  win.once('ready-to-show', () => { win.show(); pinWindow(); });
  win.loadURL(`http://127.0.0.1:${serverPort}/index.html`);

  // Algunos gestores de ventanas pierden el "encima" al cambiar de foco:
  // se reafirma cada vez que se hace clic en otra app.
  win.on('blur', () => setTimeout(pinWindow, 50));
  win.on('focus', pinWindow);
  win.on('restore', pinWindow);

  let t = null;
  const keepBounds = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isMinimized()) {
        state.bounds = win.getBounds();
        saveState();
      }
    }, 400);
  };
  win.on('move', keepBounds);
  win.on('resize', keepBounds);

  win.on('closed', () => {
    win = null;
    if (scanWin && !scanWin.isDestroyed()) scanWin.destroy();
  });
}

// ------------------------------ escaneo del perfil -------------------------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cleanUser = (u) => String(u || '').trim().replace(/^@/, '').replace(/[^\w.]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scanProfile(user, sender) {
  if (scanWin && !scanWin.isDestroyed()) return { ok: false, error: 'Ya hay un escaneo en curso.' };
  user = cleanUser(user);
  if (!user) return { ok: false, error: 'Escribe un usuario.' };

  scanCancelled = false;
  const ses = session.fromPartition('persist:tiktok-scan');
  ses.setUserAgent(cleanUserAgent());

  scanWin = new BrowserWindow({
    width: 900,
    height: 800,
    show: false,
    title: 'Escaneando perfil de TikTok',
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false },
  });
  scanWin.on('closed', () => { scanCancelled = true; scanWin = null; });

  const re = new RegExp(`/@${escapeRe(user)}/video/(\\d+)`, 'i');
  const found = new Set();
  let shown = false;

  try { await scanWin.loadURL(`https://www.tiktok.com/@${user}`); } catch (_) { /* redirecciones */ }

  let stagnant = 0;
  let rounds = 0;
  while (!scanCancelled && scanWin && !scanWin.isDestroyed() && stagnant < 8 && rounds < 400) {
    rounds++;
    let res = { hrefs: [], cap: false };
    try {
      res = await scanWin.webContents.executeJavaScript(`(() => {
        const hrefs = [...document.querySelectorAll('a[href*="/video/"]')].map(a => a.href);
        const cap = !!document.querySelector('[id*="captcha" i],[class*="captcha" i],iframe[src*="captcha" i]');
        window.scrollTo(0, document.documentElement.scrollHeight);
        return { hrefs, cap };
      })()`);
    } catch (_) { /* la pagina esta navegando */ }

    const before = found.size;
    for (const h of res.hrefs) {
      const m = re.exec(h);
      if (m) found.add(m[1]);
    }

    const needsHuman = res.cap || (found.size === 0 && rounds >= 6);
    if (needsHuman && !shown && scanWin && !scanWin.isDestroyed()) {
      scanWin.show();
      shown = true;
    }

    if (found.size > before || res.cap) stagnant = 0; else stagnant++;

    if (!sender.isDestroyed()) {
      sender.send('scan:progress', { count: found.size, needsHuman });
    }
    await sleep(1500);
  }

  if (scanWin && !scanWin.isDestroyed()) scanWin.destroy();
  scanWin = null;

  const merged = new Set(state.user === user ? state.ids : []);
  found.forEach((id) => merged.add(id));
  state.user = user;
  state.ids = [...merged];
  saveState();
  return { ok: true, user, ids: state.ids, found: found.size };
}

// ----------------------------------- IPC -----------------------------------
function registerIpc() {
  ipcMain.handle('state:get', () => ({
    ...state,
    platform: process.platform,
    sessionType: process.env.XDG_SESSION_TYPE || '',
  }));

  ipcMain.handle('state:set', (_e, patch) => {
    const allowed = ['user', 'ids', 'muted'];
    for (const k of allowed) if (k in patch) state[k] = patch[k];
    if (typeof state.user === 'string') state.user = cleanUser(state.user) || DEFAULTS.user;
    if (!Array.isArray(state.ids)) state.ids = [];
    state.ids = [...new Set(state.ids.map(String).filter((x) => /^\d{8,25}$/.test(x)))];
    saveState();
    return true;
  });

  ipcMain.handle('scan:start', (e, user) => scanProfile(user, e.sender));
  ipcMain.handle('scan:cancel', () => { scanCancelled = true; return true; });

  ipcMain.handle('win:alwaysOnTop', (_e, on) => {
    state.alwaysOnTop = !!on;
    pinWindow();
    saveState();
    return state.alwaysOnTop;
  });

  ipcMain.handle('win:opacity', (_e, v) => {
    state.opacity = Math.min(1, Math.max(0.25, Number(v) || 1));
    if (win) win.setOpacity(state.opacity);
    saveState();
    return state.opacity;
  });

  ipcMain.handle('win:minimize', () => { if (win) win.minimize(); });
  ipcMain.handle('win:close', () => { app.quit(); });
}

// ---------------------------------- arranque -------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      pinWindow();
    }
  });

  app.whenReady().then(async () => {
    loadState();
    const ua = cleanUserAgent();
    const ses = session.defaultSession;
    ses.setUserAgent(ua);

    // El reproductor embebido de TikTok prohibe iframes con estas cabeceras.
    // Solo se tocan las respuestas de /player/ cargadas como subframe.
    ses.webRequest.onHeadersReceived(
      { urls: ['https://*.tiktok.com/player/*'] },
      (details, cb) => {
        const headers = { ...details.responseHeaders };
        if (details.resourceType === 'subFrame') {
          for (const k of Object.keys(headers)) {
            const l = k.toLowerCase();
            if (l === 'x-frame-options' || l === 'content-security-policy' ||
                l === 'content-security-policy-report-only') {
              delete headers[k];
            }
          }
        }
        cb({ responseHeaders: headers });
      }
    );

    registerIpc();
    await startServer();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (server) server.close(); });
}
