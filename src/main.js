'use strict';
const fs = require('fs');
const path = require('path');
const {
  app, BrowserWindow, Tray, Menu, screen, ipcMain, powerSaveBlocker, nativeImage, nativeTheme,
} = require('electron');
const store = require('./store');
const L = require('./logic');
const { makeClient, fetchAll } = require('./data');

const PRELOAD = path.join(__dirname, 'preload.js');
const RETRY_MS = 15000; // 갱신 실패 시 재시도 간격
const TICK_MS = 30000; // 날짜 바뀜 점검과 화면 갱신

// ---- 개발용 환경변수 (실제 사용에는 필요 없음) ----
// DASHBOARD_WINDOWED=1  현황판을 전체 화면 대신 일반 창으로
// DASHBOARD_DEMO=1      DB·로그인 없이 가짜 데이터로
// DASHBOARD_FAKE_NOW    'YYYY-MM-DDTHH:mm' 로 현재 시각 고정
// DASHBOARD_SHOT=<폴더> 화면별 스크린샷을 저장하고 종료
const SHOT_DIR = process.env.DASHBOARD_SHOT || '';
const WINDOWED = process.env.DASHBOARD_WINDOWED === '1' || !!SHOT_DIR;
const DEMO = process.env.DASHBOARD_DEMO === '1';
const FAKE_NOW = process.env.DASHBOARD_FAKE_NOW || '';

const nowDate = () => (FAKE_NOW ? new Date(FAKE_NOW) : new Date());

// 개발용 실행은 실제 앱 데이터(저장된 로그인·직접 입력 내용)와 섞이지 않게 임시 폴더를 쓴다.
if (DEMO || SHOT_DIR) app.setPath('userData', path.join(require('os').tmpdir(), 'rachel-dashboard-dev'));

let settings;
let client = null;
let control = null; // 로그인·홈·직접 입력 창
let board = null; // 전체 화면 현황판
let boardSource = null; // null(닫힘) | 'live'(현황) | 'custom'(직접 입력)
let tray = null;
let blockerId = null;
let quitting = false;

let raw = null; // 마지막으로 성공한 DB 데이터
let rawDate = null; // raw 를 가져온 날짜(dateKey)
let custom = null; // 직접 입력한 대시보드(정규화된 값)
const status = {
  configured: false,
  loggedIn: false,
  email: null,
  lastOk: null,
  error: null,
  waitingDisplay: false,
};
let fetchTimer = null;
let fetching = false;

// ---------- 화면에 보낼 상태 ----------
function dashboardFor(source, now) {
  if (source === 'custom') return L.hasCustomText(custom) ? L.buildCustom(custom, now) : null;
  if (source === 'live') return raw ? L.buildDashboard(raw, now, settings.nameMode) : null;
  return null;
}

function boardSnapshot() {
  const now = nowDate();
  return { source: boardSource, dashboard: dashboardFor(boardSource, now), status: { ...status }, serverNow: now.getTime() };
}

function displayLabel() {
  const t = pickDisplay();
  const d = t && displayList().find((x) => x.id === t.id);
  return d ? `${d.number}번 화면` : null;
}

function controlSnapshot() {
  const live = dashboardFor('live', nowDate());
  const { supabaseKey, ...publicSettings } = settings;
  return {
    status: { ...status },
    settings: { ...publicSettings, hasKey: !!supabaseKey },
    boardSource,
    boardOpen: !!board,
    displayLabel: displayLabel(),
    displays: displayList(),
    live: live
      ? {
          dayOff: live.dayOff,
          hours: live.hours,
          students: new Set(live.slots.flatMap((s) => s.students.map((x) => x.name))).size,
        }
      : null,
    hasCustom: L.hasCustomText(custom),
    secureStore: store.secureAvailable(),
    demo: DEMO,
  };
}

function pushState() {
  if (board && !board.isDestroyed()) board.webContents.send('board:update', boardSnapshot());
  if (control && !control.isDestroyed()) control.webContents.send('control:update', controlSnapshot());
}

// ---------- DB 데이터 갱신 ----------
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
    const now = nowDate();
    raw = await fetchAll(client, now);
    rawDate = L.dateKey(now);
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
// 화면이 하나뿐이면(복제 모드 포함) 그 화면, 둘 이상이면 저장된 화면. 없으면 기다린다(D-3).
function pickDisplay() {
  return L.chooseDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay().id, settings.displayId);
}

function displayList() {
  return L.describeDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
}

// 모니터를 꽂거나 뺐을 때: 현황판을 다시 배치하고 홈 창의 목록도 바로 갱신한다
function onDisplaysChanged() {
  placeBoard();
  pushState();
}

// 연결된 모니터마다 이 앱이 정한 번호를 3초 동안 크게 띄운다(목록의 1번/2번과 같은 번호)
function identifyDisplays() {
  const html = (n) =>
    `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0f3d44;color:#fff;font-family:'Segoe UI','Malgun Gothic',sans-serif;text-align:center">` +
    `<div><div style="font-size:150px;font-weight:800;line-height:1">${n}</div><div style="font-size:30px;margin-top:8px;color:#a8c8ca">번 화면</div></div></body>`;
  screen.getAllDisplays().forEach((d, i) => {
    const w = 300;
    const win = new BrowserWindow({
      x: d.bounds.x + Math.round((d.bounds.width - w) / 2),
      y: d.bounds.y + Math.round((d.bounds.height - w) / 2),
      width: w,
      height: w,
      frame: false,
      resizable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#0f3d44',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.setIgnoreMouseEvents(true);
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html(i + 1))}`);
    win.once('ready-to-show', () => win.showInactive());
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
    }, 3000);
  });
}

function lockDown(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

const webPrefs = { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false };

// 창이 뜨는 순간 번쩍이지 않도록 웹앱 테마의 바탕색을 먼저 칠한다
const bgColor = () => (nativeTheme.shouldUseDarkColors ? '#0d1516' : '#e9f1f1');

// 현황판이 열려 있는 동안만 화면 꺼짐·절전을 막는다(P-1)
function syncBlocker() {
  const want = !!board && !board.isDestroyed();
  if (want && blockerId == null) blockerId = powerSaveBlocker.start('prevent-display-sleep');
  if (!want && blockerId != null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
}

function destroyBoard() {
  if (board && !board.isDestroyed()) {
    const b = board;
    board = null;
    b.destroy();
  }
  board = null;
}

function placeBoard() {
  if (!boardSource) {
    destroyBoard();
    status.waitingDisplay = false;
    syncBlocker();
    return;
  }
  const target = pickDisplay();
  if (!target) {
    status.waitingDisplay = true;
    destroyBoard();
    syncBlocker();
    return;
  }
  status.waitingDisplay = false;

  if (!board || board.isDestroyed()) {
    const size = SHOT_DIR ? { w: 1440, h: 810 } : { w: 1280, h: 720 };
    board = new BrowserWindow({
      x: target.bounds.x,
      y: target.bounds.y,
      width: WINDOWED ? size.w : target.bounds.width,
      height: WINDOWED ? size.h : target.bounds.height,
      useContentSize: true,
      frame: WINDOWED,
      show: false,
      skipTaskbar: !WINDOWED,
      backgroundColor: bgColor(),
      title: '공부방 현황판',
      webPreferences: webPrefs,
    });
    lockDown(board);
    const mine = board;
    board.on('closed', () => {
      if (board === mine) {
        board = null;
        boardSource = null; // 창을 직접 닫은 경우
        syncBlocker();
        pushState();
      }
    });
    board.webContents.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Escape') openControl(); // 홈 창을 앞으로
      if (input.key === 'F11') mine.setFullScreen(!mine.isFullScreen());
    });
    board.once('ready-to-show', () => {
      if (!WINDOWED) mine.setFullScreen(true);
      mine.showInactive(); // PC 본 화면 작업의 포커스를 가져가지 않는다(F-7)
      pushState();
    });
    board.loadFile(path.join(__dirname, 'renderer', 'board.html'));
  } else if (!WINDOWED) {
    board.setFullScreen(false);
    board.setBounds(target.bounds);
    board.setFullScreen(true);
  }
  syncBlocker();
}

function openBoardSource(source) {
  if (source !== 'live' && source !== 'custom') return { ok: false, error: '알 수 없는 보기입니다.' };
  if (!status.loggedIn) return { ok: false, error: '먼저 로그인해 주세요.' };
  if (source === 'custom' && !L.hasCustomText(custom)) return { ok: false, error: '직접 입력한 글이 없습니다.' };
  boardSource = source;
  placeBoard();
  pushState();
  return { ok: true, waitingDisplay: status.waitingDisplay };
}

function closeBoard() {
  boardSource = null;
  placeBoard();
  pushState();
}

function openControl() {
  if (control && !control.isDestroyed()) {
    if (control.isMinimized()) control.restore();
    control.show();
    control.focus();
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const w = 1000;
  const h = 800;
  control = new BrowserWindow({
    width: w,
    height: h,
    x: area.x + Math.round((area.width - w) / 2),
    y: area.y + Math.round((area.height - h) / 2),
    minWidth: 760,
    minHeight: 600,
    title: '공부방 현황판',
    autoHideMenuBar: true,
    backgroundColor: bgColor(),
    webPreferences: webPrefs,
  });
  control.setMenu(null);
  lockDown(control);
  control.on('closed', () => {
    control = null;
  });
  control.loadFile(path.join(__dirname, 'renderer', 'app.html'));
}

function trayIcon() {
  return nativeImage.createFromBuffer(Buffer.from(require('./assets/tray-icon'), 'base64'));
}

let trayMenu = null;

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('공부방 현황판');
  trayMenu = Menu.buildFromTemplate([
    { label: '홈 열기', click: () => openControl() },
    { label: '현황판 닫기', click: () => closeBoard() },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(trayMenu);
  tray.on('double-click', () => openControl());
}

function applyAutoLaunch() {
  // 개발 실행(electron.exe 직접 실행)에서는 로그인 항목을 건드리지 않는다.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!settings.autoLaunch });
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('board:get', () => boardSnapshot());
  ipcMain.handle('control:get', () => controlSnapshot());

  ipcMain.handle('settings:save', async (_e, input) => {
    const next = store.sanitize({ ...settings, ...input });
    // 키 입력칸을 비워서 보내면 기존 키 유지
    if (!input || !input.supabaseKey) next.supabaseKey = settings.supabaseKey;
    const err = store.validate(next);
    if (err) return { ok: false, error: err };
    const connectionChanged = next.supabaseUrl !== settings.supabaseUrl || next.supabaseKey !== settings.supabaseKey;
    settings = next;
    store.saveSettings(settings);
    nativeTheme.themeSource = settings.theme;
    applyAutoLaunch();
    placeBoard();
    if (connectionChanged) await initClient();
    else {
      pushState();
      if (status.loggedIn) scheduleFetch(settings.refreshSec * 1000);
    }
    return { ok: true };
  });

  ipcMain.handle('displays:list', () => displayList());
  ipcMain.handle('displays:identify', () => {
    identifyDisplays();
    return { ok: true };
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
    closeBoard();
    if (client) await client.auth.signOut();
    raw = null;
    rawDate = null;
    status.lastOk = null;
    store.secureRemove('cache');
    clearTimeout(fetchTimer);
    pushState();
    return { ok: true };
  });

  ipcMain.handle('board:open', (_e, source) => openBoardSource(source));
  ipcMain.handle('board:close', () => {
    closeBoard();
    return { ok: true };
  });

  ipcMain.handle('custom:get', () => L.normalizeCustom(custom));
  ipcMain.handle('custom:save', (_e, input) => {
    custom = L.normalizeCustom(input);
    const persisted = store.saveCustom(custom); // 암호화 저장소가 없으면 이번 실행에서만 유지
    pushState();
    return { ok: true, persisted, custom };
  });
  ipcMain.handle('custom:clear', () => {
    custom = null;
    store.clearCustom();
    if (boardSource === 'custom') closeBoard();
    else pushState();
    return { ok: true };
  });

  ipcMain.handle('app:quit', () => app.quit());
}

// ---------- 개발용 스크린샷 ----------
const SAMPLE_TEXT = '이번 주 안내\n\n10월 30일(금) 단어시험이 있습니다.\n숙제 노트는 월요일까지 제출해 주세요.\n\n수업 시작 전에 자리에 앉아 교재를 펴 주세요.';

async function devShots() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cap = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), img.toPNG());
  };
  const click = (win, sel) => win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel)}).click()`);
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await wait(3500);
    if (!status.loggedIn) {
      await cap(control, '0-login');
    } else {
      const js = (win, code) => win.webContents.executeJavaScript(code);
      await cap(control, '1-home');
      await click(control, '#go-custom');
      await wait(700);
      await js(control, `(() => { const t = document.getElementById('text'); t.value = ${JSON.stringify(SAMPLE_TEXT)}; t.dispatchEvent(new Event('input')); })()`);
      await click(control, '[data-align="center"]');
      await js(control, "(() => { const r = document.getElementById('size'); r.value = '72'; r.dispatchEvent(new Event('input')); })()");
      await wait(800);
      await cap(control, '2-editor');
      await click(control, '#save-view');
      await wait(3500);
      await cap(board, '3-board-custom');
      openBoardSource('live');
      await wait(2500);
      await cap(board, '4-board-live');
      nativeTheme.themeSource = 'dark'; // 같은 화면을 어두운 테마로
      await wait(1500);
      await cap(board, '5-board-live-dark');
      await cap(control, '6-editor-dark');
      openBoardSource('custom');
      await wait(2000);
      await cap(board, '7-board-custom-dark');
      await click(control, '[data-nav="home"]');
      await wait(700);
      await cap(control, '8-home-dark');
      nativeTheme.themeSource = 'light';
      await wait(1200);
      await cap(control, '9-home-light-open');
      await click(control, '[data-nav="settings"]');
      await wait(900);
      await cap(control, '10-settings');
      // "화면 번호 보기": 실제 IPC 경로로 눌러 보고, 각 모니터에 뜬 번호 창을 캡처한다
      await click(control, '#s-identify');
      await wait(1200);
      const marks = BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().startsWith('data:'));
      for (let i = 0; i < marks.length; i += 1) await cap(marks[i], `11-identify-${i + 1}`);
      await wait(2500);
      // 모니터 변화 흉내: 목록이 바뀌면 화면이 갱신되는지(실제 하드웨어를 꽂고 뽑을 수는 없다)
      const real = controlSnapshot();
      const send = (snap) => control.webContents.send('control:update', snap);
      send({ ...real, displays: real.displays.slice(0, 1) });
      await wait(700);
      await cap(control, '12-one-display');
      send({ ...real, settings: { ...real.settings, displayId: 999 } });
      await wait(700);
      await cap(control, '13-saved-missing');
      pushState();
    }
  } catch (e) {
    fs.appendFileSync(path.join(SHOT_DIR, 'error.log'), `${e && e.stack}\n`);
  } finally {
    app.quit();
  }
}

// ---------- 시작 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openControl());

  app.whenReady().then(async () => {
    settings = store.loadSettings();
    nativeTheme.themeSource = settings.theme;
    custom = store.loadCustom();
    loadCache();
    registerIpc();
    createTray();
    applyAutoLaunch();

    screen.on('display-added', onDisplaysChanged);
    screen.on('display-removed', onDisplaysChanged);
    screen.on('display-metrics-changed', onDisplaysChanged);

    openControl();
    if (DEMO) {
      raw = require('./demo-data').makeDemo(nowDate());
      status.configured = true;
      status.loggedIn = true;
      status.email = 'demo@example.com';
      status.lastOk = nowDate().toISOString();
      pushState();
    } else {
      await initClient();
    }

    if (SHOT_DIR) devShots();
    // 개발용: 트레이 메뉴의 "종료" 항목을 실제로 눌러 앱이 끝나는지 확인한다
    if (process.env.DASHBOARD_TEST_TRAY_QUIT) {
      setTimeout(() => trayMenu.items.find((i) => i.label === '종료').click(), 4000);
    }

    setInterval(() => {
      // 날짜가 바뀌면 오늘 기준으로 다시 읽고, 아니면 화면만 다시 계산한다(N-3)
      if (!DEMO && status.loggedIn && rawDate && rawDate !== L.dateKey(nowDate())) refresh();
      else pushState();
    }, TICK_MS);
  });

  // 홈 창을 닫아도 현황판과 트레이는 계속 살아 있다.
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });
  app.on('before-quit', () => {
    quitting = true;
    if (blockerId != null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
    if (tray && !tray.isDestroyed()) tray.destroy(); // 종료 뒤 트레이에 빈 아이콘이 남지 않게
    // 종료가 어떤 이유로 지연되더라도 프로세스가 백그라운드에 남지 않게 한다
    setTimeout(() => app.exit(0), 4000);
  });
}
