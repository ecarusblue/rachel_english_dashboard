'use strict';

const $ = (id) => document.getElementById(id);
const msg = $('msg');

function say(text, ok) {
  msg.textContent = text || '';
  msg.className = `msg ${text ? (ok ? 'ok' : 'err') : ''}`;
}

function showAuth(status) {
  const el = $('auth-state');
  if (!status.configured) {
    el.textContent = '연결 설정을 먼저 저장해 주세요.';
    el.className = 'state bad';
  } else if (status.loggedIn) {
    el.textContent = `로그인됨${status.email ? ` · ${status.email}` : ''}`;
    el.className = 'state ok';
  } else {
    el.textContent = '로그인되지 않음';
    el.className = 'state bad';
  }
  if (status.noSecureStore) {
    el.textContent += ' (이 PC에서는 암호화 저장소를 쓸 수 없어 로그인이 유지되지 않습니다)';
  }
  $('logout').disabled = !status.loggedIn;
}

async function load() {
  const [s, displays] = await Promise.all([window.api.getSettings(), window.api.listDisplays()]);
  $('url').value = s.supabaseUrl || '';
  $('key').value = '';
  $('key').placeholder = s.hasKey ? '저장된 키 있음 (비워 두면 그대로)' : 'sb_publishable_… 또는 anon 키';
  $('refresh').value = s.refreshSec;
  $('nameMode').value = s.nameMode;
  $('autoLaunch').checked = !!s.autoLaunch;

  const sel = $('display');
  sel.replaceChildren();
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = '자동 (보조 화면이 있으면 보조 화면)';
  sel.append(auto);
  for (const d of displays) {
    const o = document.createElement('option');
    o.value = String(d.id);
    o.textContent = d.label;
    sel.append(o);
  }
  sel.value = s.displayId == null ? '' : String(s.displayId);
  showAuth(s.status);
}

async function save() {
  const res = await window.api.saveSettings({
    supabaseUrl: $('url').value,
    supabaseKey: $('key').value,
    displayId: $('display').value,
    refreshSec: Number($('refresh').value),
    nameMode: $('nameMode').value,
    autoLaunch: $('autoLaunch').checked,
  });
  if (!res.ok) {
    say(res.error, false);
    return false;
  }
  say('저장했습니다.', true);
  await load();
  return true;
}

$('save').addEventListener('click', save);
$('close').addEventListener('click', () => window.api.closeSettings());
$('quit').addEventListener('click', () => window.api.quit());

$('login').addEventListener('click', async () => {
  const email = $('email').value;
  const password = $('password').value;
  if (!email || !password) return say('이메일과 비밀번호를 입력해 주세요.', false);
  if (!(await save())) return;
  $('login').disabled = true;
  const res = await window.api.login(email, password);
  $('login').disabled = false;
  $('password').value = ''; // 비밀번호는 화면에도 남기지 않는다
  if (!res.ok) return say(`로그인 실패: ${res.error}`, false);
  say('로그인했습니다.', true);
  await load();
});

$('logout').addEventListener('click', async () => {
  await window.api.logout();
  say('로그아웃했습니다.', true);
  await load();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closeSettings();
});

load();
