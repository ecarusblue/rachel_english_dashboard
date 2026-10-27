'use strict';

const $ = (id) => document.getElementById(id);

function say(el, text, ok) {
  el.textContent = text || '';
  el.className = `msg${text ? (ok ? ' ok' : ' err') : ''}`;
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

let ctl = null; // 앱이 알려 주는 상태
let view = null; // 'login' | 'home' | 'editor' | 'settings'
let doc = { text: '', align: 'left', size: 56 }; // 직접 입력 중인 글
let settingsLoaded = false;

function showView(name) {
  view = name;
  $('view-login').hidden = name !== 'login';
  $('shell').hidden = name === 'login';
  if (name === 'login') return;
  for (const v of ['home', 'editor', 'settings']) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
}

// ================= 로그인 =================
let connFilled = false;
function enterLogin() {
  if (view !== 'login') showView('login');
  settingsLoaded = false;
  if (!connFilled && ctl) {
    $('c-url').value = ctl.settings.supabaseUrl || '';
    $('c-key').placeholder = ctl.settings.hasKey ? '저장된 키 있음 (비워 두면 그대로)' : 'sb_publishable_… 또는 anon 키';
    connFilled = true;
  }
  if (!ctl.status.configured) $('conn').open = true;
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('login-msg');
  if (!ctl.status.configured) {
    $('conn').open = true;
    return say(msg, '아래 연결 설정을 먼저 저장해 주세요.', false);
  }
  const btn = $('login');
  btn.disabled = true;
  say(msg, '');
  const res = await window.api.login($('email').value, $('password').value);
  btn.disabled = false;
  $('password').value = ''; // 비밀번호는 화면에도 남기지 않는다
  if (!res.ok) return say(msg, `로그인하지 못했습니다. ${res.error}`, false);
  renderCtl(await window.api.getControl());
});

$('c-save').addEventListener('click', async () => {
  const res = await window.api.saveSettings({ supabaseUrl: $('c-url').value, supabaseKey: $('c-key').value });
  say($('login-msg'), res.ok ? '연결 설정을 저장했습니다.' : res.error, res.ok);
  if (res.ok) {
    $('c-key').value = '';
    connFilled = false;
  }
});

// ================= 사이드바 =================
document.querySelectorAll('.nav').forEach((b) =>
  b.addEventListener('click', () => {
    const to = b.dataset.nav;
    if (to === 'editor') enterEditor();
    else if (to === 'settings') enterSettings();
    else {
      showView('home');
      updateHome();
    }
  })
);
$('close-board').addEventListener('click', () => window.api.closeBoard());
$('logout').addEventListener('click', async () => {
  await window.api.logout();
  say($('home-msg'), '');
});
$('quit').addEventListener('click', () => window.api.quit());

function updateSide() {
  const s = ctl;
  $('account').textContent = s.status.email || '';
  const open = !!s.boardSource;
  $('board-state').hidden = !open;
  if (open) {
    $('board-state-text').textContent = s.boardSource === 'live' ? '현황판 표시 중 (DB 현황)' : '현황판 표시 중 (직접 입력)';
  }
}

// ================= 홈 =================
function updateHome() {
  const s = ctl;
  let sub;
  if (!s.status.configured) sub = '연결 설정이 필요합니다.';
  else if (!s.live) sub = s.status.error ? '현황을 불러오지 못했습니다.' : '현황을 불러오는 중…';
  else if (s.live.dayOff) sub = '오늘은 수업이 없습니다.';
  else sub = `오늘 수업 ${s.live.hours ? `${s.live.hours.start} – ${s.live.hours.end}` : ''}, 학생 ${s.live.students}명. 수업 중인 타임의 이름과 진도를 크게 보여줍니다.`;
  $('live-sub').textContent = sub;

  $('custom-sub').textContent = s.hasCustom
    ? '저장해 둔 글이 있습니다. 고쳐서 다시 보여줄 수 있습니다.'
    : '글을 적고 정렬과 글자 크기를 정해 현황판으로 보여줍니다.';
  $('view-custom').hidden = !s.hasCustom;

  $('wait-note').hidden = !s.status.waitingDisplay;
  const err = $('err-note');
  err.hidden = !s.status.error;
  if (s.status.error) err.textContent = `DB에서 현황을 읽지 못했습니다. ${s.status.error}`;

  $('sync-note').textContent = s.demo ? '데모 데이터.' : s.status.lastOk ? `마지막 갱신 ${hhmm(s.status.lastOk)}.` : '';
}

async function openBoard(source) {
  const res = await window.api.openBoard(source);
  say($('home-msg'), res.ok ? '' : res.error, false);
  if (res.ok && res.waitingDisplay) say($('home-msg'), '선택한 디스플레이가 없어 연결되기를 기다립니다.', false);
  return res;
}

$('go-live').addEventListener('click', () => openBoard('live'));
$('view-custom').addEventListener('click', () => openBoard('custom'));
$('go-custom').addEventListener('click', enterEditor);

// ================= 직접 입력 (글 + 정렬 + 글자 크기) =================
const SIZE_MIN = 20;
const SIZE_MAX = 200;
const clampSize = (n) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n)));

function applyDoc() {
  const ta = $('text');
  ta.style.textAlign = doc.align;
  $('count').textContent = `${doc.text.length} / 5000자`;
  document.querySelectorAll('[data-align]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.align === doc.align)));
  $('size').value = String(doc.size);
  $('size-val').textContent = String(doc.size);
  const pv = $('pv-text');
  pv.textContent = doc.text;
  pv.style.setProperty('--ta', doc.align);
  pv.style.setProperty('--fs', String(doc.size));
}

function updatePreviewHeader() {
  const now = new Date();
  $('pv-date').textContent = `${now.getMonth() + 1}월 ${now.getDate()}일`;
  $('pv-time').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

async function enterEditor() {
  showView('editor');
  doc = await window.api.getCustom();
  $('text').value = doc.text;
  updatePreviewHeader();
  applyDoc();
  say($('editor-msg'), ctl.secureStore ? '' : '이 PC에서는 암호화 저장소를 쓸 수 없어 프로그램을 닫으면 글이 사라집니다.', false);
}

$('text').addEventListener('input', () => {
  doc.text = $('text').value;
  applyDoc();
});
document.querySelectorAll('[data-align]').forEach((b) =>
  b.addEventListener('click', () => {
    doc.align = b.dataset.align;
    applyDoc();
  })
);
$('size').addEventListener('input', () => {
  doc.size = clampSize(Number($('size').value));
  applyDoc();
});
$('size-dec').addEventListener('click', () => {
  doc.size = clampSize(doc.size - 4);
  applyDoc();
});
$('size-inc').addEventListener('click', () => {
  doc.size = clampSize(doc.size + 4);
  applyDoc();
});

async function saveDoc() {
  const res = await window.api.saveCustom(doc);
  doc = res.custom;
  applyDoc();
  return res;
}

$('save-only').addEventListener('click', async () => {
  const res = await saveDoc();
  say($('editor-msg'), res.persisted ? '저장했습니다.' : '저장했습니다. 이 PC에서는 암호화 저장소를 쓸 수 없어 프로그램을 닫으면 사라집니다.', true);
});

$('save-view').addEventListener('click', async () => {
  if (!doc.text.trim()) return say($('editor-msg'), '보여줄 글을 입력해 주세요.', false);
  await saveDoc();
  const res = await window.api.openBoard('custom');
  if (!res.ok) return say($('editor-msg'), res.error, false);
  say($('editor-msg'), res.waitingDisplay
    ? '저장했습니다. 선택한 디스플레이가 연결되면 현황판이 나타납니다.'
    : '현황판을 열었습니다. 현황판에서 Esc 키를 누르면 이 창이 앞으로 나옵니다.', true);
});

$('clear-custom').addEventListener('click', async () => {
  if (!doc.text && !ctl.hasCustom) return;
  if (!window.confirm('입력한 글을 지웁니다. 계속할까요?')) return;
  await window.api.clearCustom();
  doc = { text: '', align: 'left', size: 56 };
  $('text').value = '';
  applyDoc();
  say($('editor-msg'), '글을 지웠습니다.', true);
});

// ================= 설정 =================
async function enterSettings() {
  showView('settings');
  say($('s-msg'), '');
  await loadSettingsForm();
}

async function loadSettingsForm() {
  const displays = await window.api.listDisplays();
  const s = ctl.settings;
  $('s-url').value = s.supabaseUrl || '';
  $('s-key').value = '';
  $('s-key').placeholder = s.hasKey ? '저장된 키 있음 (비워 두면 그대로)' : 'sb_publishable_… 또는 anon 키';
  $('s-refresh').value = s.refreshSec;
  $('s-name').value = s.nameMode;
  $('s-theme').value = s.theme;
  $('s-auto').checked = !!s.autoLaunch;
  const sel = $('s-display');
  sel.replaceChildren();
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = '자동 (보조 화면이 있으면 보조 화면)';
  sel.append(auto);
  displays.forEach((d) => {
    const o = document.createElement('option');
    o.value = String(d.id);
    o.textContent = d.label;
    sel.append(o);
  });
  sel.value = s.displayId == null ? '' : String(s.displayId);
  settingsLoaded = true;
}

$('s-save').addEventListener('click', async () => {
  const res = await window.api.saveSettings({
    supabaseUrl: $('s-url').value,
    supabaseKey: $('s-key').value,
    displayId: $('s-display').value,
    refreshSec: Number($('s-refresh').value),
    nameMode: $('s-name').value,
    theme: $('s-theme').value,
    autoLaunch: $('s-auto').checked,
  });
  say($('s-msg'), res.ok ? '저장했습니다.' : res.error, res.ok);
  if (res.ok) await loadSettingsForm();
});

// ================= 상태 반영 =================
function renderCtl(s) {
  ctl = s;
  if (!s.status.loggedIn) {
    enterLogin();
    return;
  }
  connFilled = false;
  if (view == null || view === 'login') {
    showView('home');
    if (!settingsLoaded) loadSettingsForm();
  }
  updateSide();
  if (view === 'home') updateHome();
}

window.api.onControl(renderCtl);
window.api.getControl().then(renderCtl);
