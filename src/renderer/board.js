'use strict';

const $ = (id) => document.getElementById(id);
const topEl = $('top');
const mainEl = $('main');
const footEl = $('foot');
const noticeEl = $('notice');

// ---- 마우스 커서는 3초간 입력이 없으면 숨긴다(F-4) ----
let idleTimer = null;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
}
['mousemove', 'mousedown', 'keydown'].forEach((ev) => window.addEventListener(ev, wake));
wake();

// 데이터는 항상 textContent 로만 넣는다
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const pad = (n) => String(n).padStart(2, '0');
const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const toMin = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);

let state = null; // { source, dashboard, status, serverNow }
let offset = 0; // 앱이 알려 준 시각 - 이 창의 시계 (보통 0)

function clockNow() {
  const d = new Date(Date.now() + offset);
  return { d, min: d.getHours() * 60 + d.getMinutes() };
}

function slotStates(slots, t) {
  return slots.map((s) => {
    const a = toMin(s.start);
    const b = toMin(s.end);
    if (a == null || b == null) return 'upcoming';
    return t >= b ? 'past' : t >= a ? 'now' : 'upcoming';
  });
}

function showNotice(title, sub) {
  const big = el('div', 'big', title);
  if (sub) big.append(el('small', null, sub));
  noticeEl.replaceChildren(big);
  noticeEl.hidden = false;
}

// ---------- 상단 ----------
function renderTop() {
  const { dashboard, status, source } = state;
  const { min, d } = clockNow();
  $('date-d').textContent = dashboard.dateText;
  $('date-w').textContent = dashboard.weekday;
  $('clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const hours = $('hours');
  hours.replaceChildren();
  if (dashboard.hours) {
    hours.append(el('span', null, '오늘 수업'), document.createTextNode(`${dashboard.hours.start} – ${dashboard.hours.end}`));
  }

  const sts = slotStates(dashboard.slots, min);
  const strip = $('strip');
  strip.replaceChildren();
  dashboard.slots.forEach((s, i) => {
    const a = toMin(s.start);
    const b = toMin(s.end);
    const dur = a != null && b != null && b > a ? b - a : 60;
    const seg = el('div', `seg ${sts[i]}`);
    seg.style.flex = `${dur} 1 0`;
    const bar = el('div', 'bar');
    const fill = el('div', 'fill');
    bar.append(fill);
    if (sts[i] === 'now') {
      const frac = Math.min(Math.max((min - a) / dur, 0), 1);
      fill.style.width = `${frac * 100}%`;
      const needle = el('div', 'needle');
      needle.style.left = `${frac * 100}%`;
      bar.append(needle);
    }
    seg.append(el('div', 'lb', s.label), el('div', 'tm', s.start && s.end ? `${s.start}–${s.end}` : ''), bar);
    strip.append(seg);
  });

  const sync = $('sync');
  sync.replaceChildren(el('i'));
  if (source === 'custom') {
    sync.className = 'sync custom';
    sync.append(document.createTextNode('직접 입력한 현황판'));
  } else if (status.error) {
    sync.className = 'sync warn';
    sync.append(document.createTextNode(`갱신 실패, 마지막 성공 ${status.lastOk ? hhmmLocal(status.lastOk) : '-'}`));
  } else {
    sync.className = 'sync';
    sync.append(document.createTextNode(status.lastOk ? `${hhmmLocal(status.lastOk)} 갱신` : ''));
  }
}

function hhmmLocal(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- 중앙 ----------
function bookCell(b) {
  const cell = el('div', `bk${b.computed ? ' calc' : ''}`);
  const l1 = el('div', 'l1');
  const tt = el('span', 'tt', b.title);
  tt.title = b.title;
  l1.append(tt, el('span', 'fr', b.progressText));
  const l2 = el('div', 'l2');
  const bar = el('div', 'bar2');
  const cur = el('i', 'cur');
  cur.style.width = `${b.pct}%`;
  const rec = el('i', 'rec');
  rec.style.left = `${b.pct}%`;
  rec.style.width = `${Math.max(b.recPct, 3)}%`;
  bar.append(cur, rec);
  l2.append(el('span', 'rg', b.range), bar);
  cell.append(l1, l2);
  return cell;
}

function studentRow(st) {
  const row = el('div', 'stu');
  row.append(el('div', 'nm', st.name));
  const bks = el('div', 'bks');
  if (st.books.length) st.books.forEach((b) => bks.append(bookCell(b)));
  else bks.append(el('div', 'none', '배정된 교재가 없습니다'));
  row.append(bks);
  return row;
}

// 학생 줄이 넘치면 글자를 줄여 한 화면에 맞춘다(스크롤·순환 없음)
function fitMain() {
  let s = 1;
  mainEl.style.setProperty('--s', s);
  while (mainEl.scrollHeight > mainEl.clientHeight + 1 && s > 0.55) {
    s = Math.round((s - 0.04) * 100) / 100;
    mainEl.style.setProperty('--s', s);
  }
}

// 직접 입력한 글: 정렬과 글자 크기는 입력한 대로, 넘치면 글자를 줄여 한 화면에 맞춘다
function renderText(d) {
  const box = el('div', 'textbox', d.text);
  box.style.setProperty('--ta', d.align);
  box.style.setProperty('--fs', String(d.size));
  mainEl.append(box);
  let s = 1;
  while (box.scrollHeight > box.clientHeight + 1 && s > 0.3) {
    s = Math.round((s - 0.05) * 100) / 100;
    box.style.setProperty('--ts', String(s));
  }
}

function renderMain() {
  const { dashboard, source } = state;
  const { min } = clockNow();
  const sts = slotStates(dashboard.slots, min);
  const nowIdx = sts.indexOf('now');
  const focus = nowIdx >= 0 ? nowIdx : sts.indexOf('upcoming'); // 수업 중이 아니면 다음 타임을 크게

  mainEl.replaceChildren();
  footEl.replaceChildren();
  footEl.hidden = true;

  if (dashboard.kind === 'text') {
    renderText(dashboard);
    return;
  }
  if (dashboard.slots.length === 0) {
    mainEl.append(el('div', 'big', source === 'custom' ? '입력한 타임이 없습니다' : '오늘은 수업이 없습니다'));
    return;
  }
  if (focus < 0) {
    const big = el('div', 'big dim', '오늘 수업이 모두 끝났습니다');
    big.append(el('small', null, '수고하셨습니다.'));
    mainEl.append(big);
    return;
  }

  const slot = dashboard.slots[focus];
  const gh = el('div', 'gh');
  gh.append(
    el('span', 'pill', sts[focus] === 'now' ? '지금' : '다음'),
    el('span', 't', slot.label),
    el('span', 'r', slot.start && slot.end ? `${slot.start}–${slot.end}` : ''),
    el('span', 'c', `${slot.students.length}명`)
  );
  const rows = el('div', 'rows');
  if (slot.students.length) slot.students.forEach((st) => rows.append(studentRow(st)));
  else rows.append(el('div', 'empty', '이 타임에 배정된 학생이 없습니다'));
  mainEl.append(gh, rows);
  fitMain();

  // 하단: 이어지는 타임(이름만) + 범례
  const later = dashboard.slots.map((s, i) => ({ s, i })).filter(({ i }) => i > focus);
  const next = el('div', 'next');
  later.forEach(({ s }) => {
    const line = el('div', 'line');
    line.append(
      el('b', null, `이어서 ${s.label}`),
      el('span', 'tm', s.start && s.end ? `${s.start}–${s.end}` : '')
    );
    s.students.forEach((x) => line.append(el('span', 'chip', x.name)));
    next.append(line);
  });
  const legend = el('div', 'legend');
  const item = (swatch, text) => {
    const sp = el('span');
    sp.append(swatch, document.createTextNode(text));
    return sp;
  };
  const dot = (color) => {
    const i = el('i');
    i.style.background = color;
    return i;
  };
  legend.append(item(dot('var(--progress)'), '지금까지 한 진도'), item(dot('var(--accent)'), '오늘 나갈 범위'));
  if (slot.students.some((st) => st.books.some((b) => b.computed))) {
    const demo = el('b', 'calcdemo', 'Unit 5');
    demo.style.fontWeight = '700';
    legend.append(item(demo, '추천이 없어 계산한 값'));
  }
  footEl.append(next, legend);
  footEl.hidden = false;
}

// ---------- 전체 ----------
let lastMainKey = '';
function render(force) {
  if (!state) return;
  const { dashboard, status, source } = state;

  if (!source) return showNotice('현황판이 닫혔습니다');
  if (source === 'live' && !status.configured) return showNotice('Supabase 연결 설정이 필요합니다', 'Esc 키로 홈 창을 열어 주세요');
  if (!status.loggedIn) return showNotice('로그인이 필요합니다', 'Esc 키로 홈 창을 열어 주세요');
  if (!dashboard) {
    return showNotice(status.error ? '데이터를 불러오지 못했습니다' : '불러오는 중…', status.error || '');
  }
  noticeEl.hidden = true;

  renderTop();
  // 내용이 같으면 목록을 다시 그리지 않는다(깜빡임 방지)
  const { min } = clockNow();
  const key = JSON.stringify([dashboard, slotStates(dashboard.slots, min), source, window.innerWidth, window.innerHeight]);
  if (force || key !== lastMainKey) {
    lastMainKey = key;
    renderMain();
  }
}

function apply(next) {
  state = next;
  offset = next.serverNow - Date.now();
  render(false);
}

window.api.onBoard(apply);
window.api.getBoard().then(apply);
setInterval(() => render(false), 5000); // 시계와 지금 타임 표시를 갱신
window.addEventListener('resize', () => render(true));
