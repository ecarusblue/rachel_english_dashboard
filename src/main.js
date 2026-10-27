'use strict';
const path = require('path');
const {
  app, BrowserWindow, Tray, Menu, screen, ipcMain, powerSaveBlocker, nativeImage,
} = require('electron');
const store = require('./store');
const { makeClient, fetchAll } = require('./data');
const { buildBoard, dateKey } = require('./logic');

const PRELOAD = path.join(__dirname, 'preload.js');
const RETRY_MS = 15000; // 갱신 실패 시 재시도 간격
const TICK_MS = 30000; // 진행 중 타임 강조·자정 롤오버 점검
// 개발용: DASHBOARD_WINDOWED=1 이면 전체 화면 대신 일반 창, DASHBOARD_DEMO=1 이면 가짜 데이터(DB·로그인 없이)
const WINDOWED = process.env.DASHBOARD_WINDOWED === '1';
const DEMO = process.env.DASHBOARD_DEMO === '1';

let settings;
let client = null;
let board = null;
let settingsWin = null;
let tray = null;
let blockerId = null;
let quitting = false;

let raw = null; // 마지막으로 성공한 원본 데이터
let rawDate = null; // raw 를 가져온 날짜(dateKey)
const status = {
  configured: false,
  loggedIn: false,
  email: null,
  lastOk: null,
  error: null,
  waitingDisplay: false,
  noSecureStore: false,
};
let fetchTimer = null;
let fetching = false;

// ---------- 상태 전송 ----------
function snapshot() {
  const model = raw ? buildBoard(raw, new Date(), settings.nameMode) : null;
  return { model, status: { ...status, now: Date.now() } };
}

function pushState() {
  if (board && !board.isDestroyed()) board.webContents.send('state:update', snapshot());
}

// ---------- 데이터 갱신 ----------
function scheduleFetch(ms) {
  clearTimeout(fetchTimer);
  fetchTimer = setTimeout(refresh, ms);
}

async function refresh() {
  clearTimeout(fetchTimer);
  if (!client || !status.loggedIn) return;
  if (fetching) return;
  fetching = true;
  try {
    const now = new Date();
    const data = await fetchAll(client, now);
    raw = data;
    rawDate = dateKey(now);
    status.lastOk = now.toISOString();
    status.error = null;
    store.secureSet('cache', JSON.stringify({ raw, rawDate, lastOk: status.lastOk }));
    scheduleFetch(settings.refreshSec * 1000);
  } catch (err) {
    status.error = String((err && err.message) || err);
    scheduleFetch(RETRY_MS);
  } finally {
    fetching = false;
    pushState();
  }
}

function loadCache() {
  try {
    const c = JSON.parse(store.secureGet('cache') || 'null');
    if (c && c.raw) {
      raw = c.raw;
      rawDate = c.rawDate;
      status.lastOk = c.lastOk;
    }
  } catch {
    /* 캐시 없음 */
  }
}

// ---------- Supabase 연결·로그인 ----------
async function initClient() {
  clearTimeout(fetchTimer);
  client = null;
  status.configured = !!(settings.supabaseUrl && settings.supabaseKey);
  status.loggedIn = false;
  status.email = null;
  if (!status.configured) {
    pushState();
    return;
  }
  client = makeClient(settings.supabaseUrl, settings.supabaseKey);
  client.auth.onAuthStateChange((_event, session) => {
    status.loggedIn = !!session;
    status.email = session && session.user ? session.user.email : null;
    pushState();
  });
  try {
    const { data } = await client.auth.getSession();
    status.loggedIn = !!data.session;
    status.email = data.session && data.session.user ? data.session.user.email : null;
  } catch (err) {
    status.error = String((err && err.message) || err);
  }
  pushState();
  if (status.loggedIn) refresh();
}

// ---------- 디스플레이·창 ----------
function pickDisplay() {
  const all = screen.getAllDisplays();
  if (settings.displayId != null) {
    // 지정한 화면이 없으면 기본 화면에 띄우지 않고 대기(D-3)
    return all.find((d) => d.id === settings.displayId) || null;
  }
  return all.find((d) => d.id !== screen.getPrimaryDisplay().id) || screen.getPrimaryDisplay();
}

function lockDown(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function placeBoard() {
  const target = pickDisplay();
  if (!target) {
    status.waitingDisplay = true;
    if (board && !board.isDestroyed()) {
      board.destroy();
      board = null;
    }
    return;
  }
  status.waitingDisplay = false;

  if (!board || board.isDestroyed()) {
    board = new BrowserWindow({
      x: target.bounds.x,
      y: target.bounds.y,
      width: WINDOWED ? 1280 : target.bounds.width,
      height: WINDOWED ? 720 : target.bounds.height,
      frame: WINDOWED,
      show: false,
      skipTaskbar: !WINDOWED,
      backgroundColor: '#0b0f14',
      title: '공부방 진도 현황판',
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    lockDown(board);
    board.on('closed', () => {
      board = null;
    });
    board.webContents.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Escape') openSettings();
      if (input.key === 'F11') board.setFullScreen(!board.isFullScreen());
    });
    board.once('ready-to-show', () => {
      if (!WINDOWED) board.setFullScreen(true);
      board.showInactive(); // PC 본 화면 작업의 포커스를 가져가지 않는다(F-7)
      pushState();
    });
    board.loadFile(path.join(__dirname, 'renderer', 'board.html'));
  } else if (!WINDOWED) {
    board.setFullScreen(false);
    board.setBounds(target.bounds);
    board.setFullScreen(true);
  }
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const primary = screen.getPrimaryDisplay().workArea;
  settingsWin = new BrowserWindow({
    width: 560,
    height: 720,
    x: primary.x + Math.round((primary.width - 560) / 2),
    y: primary.y + Math.round((primary.height - 720) / 2),
    title: '현황판 설정',
    autoHideMenuBar: true,
    backgroundColor: '#11161d',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  settingsWin.setMenu(null);
  lockDown(settingsWin);
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
}

function trayIcon() {
  return nativeImage.createFromBuffer(Buffer.from(require('./assets/tray-icon'), 'base64'));
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('공부방 진도 현황판');
  const menu = Menu.buildFromTemplate([
    { label: '현황판 보이기', click: () => placeBoard() },
    { label: '현황판 숨기기', click: () => board && !board.isDestroyed() && board.hide() },
    { label: '설정', click: () => openSettings() },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => openSettings());
}

function applyAutoLaunch() {
  // 개발 실행(electron.exe 직접 실행)에서는 로그인 항목을 건드리지 않는다.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!settings.autoLaunch });
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('state:get', () => snapshot());
  ipcMain.handle('settings:get', () => ({ ...settings, hasKey: !!settings.supabaseKey, status: { ...status } }));

  ipcMain.handle('settings:save', async (_e, input) => {
    const next = store.sanitize({ ...settings, ...input });
    // 키 입력칸을 비워서 보내면 기존 키 유지
    if (!input || !input.supabaseKey) next.supabaseKey = settings.supabaseKey;
    const err = store.validate(next);
    if (err) return { ok: false, error: err };
    const connectionChanged = next.supabaseUrl !== settings.supabaseUrl || next.supabaseKey !== settings.supabaseKey;
    settings = next;
    store.saveSettings(settings);
    applyAutoLaunch();
    placeBoard();
    if (connectionChanged) await initClient();
    else {
      pushState();
      if (status.loggedIn) scheduleFetch(settings.refreshSec * 1000);
    }
    return { ok: true };
  });

  ipcMain.handle('displays:list', () => {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: `${d.label || `디스플레이 ${i + 1}`} · ${d.size.width}×${d.size.height}${d.id === primaryId ? ' · 주 화면' : ' · 보조 화면'}`,
    }));
  });

  ipcMain.handle('auth:login', async (_e, { email, password }) => {
    if (!client) return { ok: false, error: 'Supabase URL 과 공개용 키를 먼저 저장해 주세요.' };
    const { error } = await client.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
    if (error) return { ok: false, error: error.message };
    status.error = null;
    refresh();
    return { ok: true };
  });

  ipcMain.handle('auth:logout', async () => {
    if (client) await client.auth.signOut();
    raw = null;
    rawDate = null;
    status.lastOk = null;
    store.secureRemove('cache');
    clearTimeout(fetchTimer);
    pushState();
    return { ok: true };
  });

  ipcMain.handle('settings:close', () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  });
  ipcMain.handle('app:quit', () => app.quit());
}

// ---------- 시작 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());

  app.whenReady().then(async () => {
    settings = store.loadSettings();
    status.noSecureStore = !store.secureAvailable();
    loadCache();
    registerIpc();
    createTray();
    blockerId = powerSaveBlocker.start('prevent-display-sleep'); // P-1
    applyAutoLaunch();

    placeBoard();
    screen.on('display-added', placeBoard);
    screen.on('display-removed', placeBoard);
    screen.on('display-metrics-changed', placeBoard);

    if (DEMO) {
      raw = require('./demo-data').makeDemo(new Date());
      status.configured = true;
      status.loggedIn = true;
      status.lastOk = new Date().toISOString();
      pushState();
    } else {
      await initClient();
      if (!status.configured || !status.loggedIn) openSettings();
    }

    // 개발용: DASHBOARD_SHOT=<png 경로> 이면 잠시 뒤 현황판 화면을 저장하고 종료한다.
    if (process.env.DASHBOARD_SHOT) {
      setTimeout(async () => {
        try {
          const img = await board.webContents.capturePage();
          require('fs').writeFileSync(process.env.DASHBOARD_SHOT, img.toPNG());
        } finally {
          app.quit();
        }
      }, 4000);
    }

    setInterval(() => {
      // 날짜가 바뀌면 오늘 기준으로 다시 읽고, 아니면 화면만 다시 계산한다(N-3)
      if (!DEMO && status.loggedIn && rawDate && rawDate !== dateKey(new Date())) refresh();
      else pushState();
    }, TICK_MS);
  });

  // 설정 창을 닫아도 현황판은 계속 떠 있어야 한다.
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });
  app.on('before-quit', () => {
    quitting = true;
    if (blockerId != null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
  });
}
