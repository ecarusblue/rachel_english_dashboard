'use strict';
// 설정(일반 JSON)과 비밀 저장소(Windows DPAPI = Electron safeStorage)를 다룬다.
// 로그인 세션·오프라인 캐시는 암호화할 수 있을 때만 디스크에 쓴다(평문 저장 금지, 요구사항 A-2).
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { normalizeCustom } = require('./logic');

const NAME_MODES = ['full', 'surname', 'given', 'initial'];

const DEFAULTS = {
  supabaseUrl: '',
  supabaseKey: '', // 공개용(anon/publishable) 키만. secret/service_role 은 받지 않는다.
  displayId: null, // 현황판을 띄울 디스플레이 id (screen.getAllDisplays()[].id)
  refreshSec: 60,
  nameMode: 'full',
  theme: 'system', // 화면 색상: system(PC 설정 따름) | light | dark
  autoLaunch: false, // 개인 PC → 기본 꺼짐
};

const THEMES = ['system', 'light', 'dark'];

function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(userFile(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, obj) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userFile(name), JSON.stringify(obj, null, 2), 'utf8');
}

// secret 키(service_role 등)를 실수로 넣는 것을 막는다. JWT 의 role 클레임과 sb_secret_ 접두어를 본다.
function isSecretKey(key) {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

function sanitize(input) {
  const s = { ...DEFAULTS, ...input };
  s.supabaseUrl = String(s.supabaseUrl || '').trim().replace(/\/+$/, '');
  s.supabaseKey = String(s.supabaseKey || '').trim();
  s.refreshSec = Math.min(3600, Math.max(15, Math.round(Number(s.refreshSec) || DEFAULTS.refreshSec)));
  if (!NAME_MODES.includes(s.nameMode)) s.nameMode = 'full';
  if (!THEMES.includes(s.theme)) s.theme = 'system';
  s.autoLaunch = !!s.autoLaunch;
  s.displayId = s.displayId == null || s.displayId === '' ? null : Number(s.displayId);
  if (Number.isNaN(s.displayId)) s.displayId = null;
  return s;
}

function validate(s) {
  if (s.supabaseUrl && !/^https:\/\/[a-z0-9.-]+$/i.test(s.supabaseUrl)) {
    return 'Supabase URL 은 https://… 형식이어야 합니다.';
  }
  if (isSecretKey(s.supabaseKey)) {
    return 'secret/service_role 키는 사용할 수 없습니다. 공개용(anon/publishable) 키를 넣어 주세요.';
  }
  return null;
}

function loadSettings() {
  const saved = readJson('settings.json', {});
  const s = sanitize(saved);
  // 개발 편의: 설정이 비어 있으면 프로젝트 루트의 config.local.json(.gitignore 대상)으로 채운다.
  if (!s.supabaseUrl || !s.supabaseKey) {
    try {
      const local = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'config.local.json'), 'utf8'));
      if (!s.supabaseUrl) s.supabaseUrl = String(local.supabaseUrl || '').trim().replace(/\/+$/, '');
      if (!s.supabaseKey) s.supabaseKey = String(local.supabaseKey || '').trim();
    } catch {
      /* 없으면 무시 */
    }
  }
  if (isSecretKey(s.supabaseKey)) s.supabaseKey = '';
  return s;
}

function saveSettings(s) {
  writeJson('settings.json', s);
}

// ---- 암호화 저장소 ----
function secureAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function secureName(key) {
  return `secure-${String(key).replace(/[^a-z0-9_-]/gi, '_')}.bin`;
}

function secureGet(key) {
  if (!secureAvailable()) return null;
  try {
    return safeStorage.decryptString(fs.readFileSync(userFile(secureName(key))));
  } catch {
    return null;
  }
}

function secureSet(key, value) {
  if (!secureAvailable()) return false;
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userFile(secureName(key)), safeStorage.encryptString(String(value)));
  return true;
}

function secureRemove(key) {
  try {
    fs.unlinkSync(userFile(secureName(key)));
  } catch {
    /* 없으면 무시 */
  }
}

// 직접 입력한 대시보드(학생 이름 포함)도 암호화할 수 있을 때만 디스크에 둔다.
function loadCustom() {
  try {
    const raw = secureGet('custom');
    return raw ? normalizeCustom(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveCustom(custom) {
  return secureSet('custom', JSON.stringify(custom));
}

function clearCustom() {
  secureRemove('custom');
}

// supabase-js 가 세션을 저장하는 용도의 storage 어댑터
const authStorage = {
  getItem: (k) => secureGet(`auth-${k}`),
  setItem: (k, v) => {
    secureSet(`auth-${k}`, v);
  },
  removeItem: (k) => secureRemove(`auth-${k}`),
};

module.exports = {
  NAME_MODES, DEFAULTS, sanitize, validate, isSecretKey,
  loadSettings, saveSettings,
  secureAvailable, secureGet, secureSet, secureRemove, authStorage,
  loadCustom, saveCustom, clearCustom,
};
