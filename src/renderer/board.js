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
  // 글자만: 타임 이름과 시간. 지금 타임은 주황 알약, 끝난 타임은 옅게(스타일은 board.css)
  dashboard.slots.forEach((s, i) => {
    const seg = el('div', `seg ${sts[i]}`);
    seg.append(
      el('div', 'lb', s.label),
      el('div', 'tm', s.start && s.end ? `${s.start}–${s.end}` : '')
    );
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
  // 글자만: 교재명(작게) 위에 오늘 범위(크게). 막대와 분수는 없다.
  const tt = el('div', 'tt', b.title);
  tt.title = b.title;
  cell.append(tt, el('div', 'rg', b.range));
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

// 한 화면에 맞추는 단계(스크롤·순환 없음). 이름과 오늘 범위는 읽을 수 있는 크기 아래로 줄이지 않는다.
//  0) 줄이 적으면 오히려 키워서 빈 공간을 채운다(최대 1.25배)
//  1) 교재를 한 줄에 4칸으로
//  1-2) 학생이 4명 이상이면 학생을 2열로
//  2) 교재명을 작게(최소 22px)
//  3) 이름·범위를 최소 72%까지(이름 46px, 범위 36px 이상)
//  4) 그래도 넘치면 뒤쪽 학생을 "외 N명"으로
function fitMain() {
  const rows = mainEl.querySelector('.rows');
  const set = (o) => Object.entries(o).forEach(([k, v]) => mainEl.style.setProperty(k, String(v)));
  const over = () => mainEl.scrollHeight > mainEl.clientHeight + 1;
  rows.classList.remove('twocol');
  mainEl.querySelectorAll('.more').forEach((n) => n.remove());
  set({ '--s': 1, '--g': 1, '--sec': 1, '--cols': 3 });

  if (!over()) {
    let g = 1;
    for (let t = 1.05; t <= 1.251; t += 0.05) {
      set({ '--g': t });
      if (over()) break;
      g = t;
    }
    set({ '--g': g });
    return;
  }
  set({ '--cols': 4 });
  if (!over()) return;
  // 학생이 4명 이상이면 학생을 2열로 나란히(모두 읽을 수 있는 크기로 보이게)
  if (rows.children.length >= 4) {
    rows.classList.add('twocol');
    if (!over()) return;
  }
  set({ '--sec': 0.85 });
  if (!over()) return;
  for (let s = 0.95; s >= 0.719; s -= 0.04) {
    set({ '--s': Math.round(s * 100) / 100 });
    if (!over()) return;
  }
  // 4단계: 최소 크기에서도 넘치면 뒤쪽 학생을 접는다
  const stus = [...rows.children];
  const more = el('div', 'more');
  rows.append(more);
  const hidden = [];
  while (over() && stus.length - hidden.length > 1) {
    const last = stus[stus.length - 1 - hidden.length];
    hidden.unshift(last.querySelector('.nm').textContent);
    last.remove();
    more.textContent = `외 ${hidden.length}명  ${hidden.join('  ')}`;
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
  if (slot.students.some((st) => st.books.some((b) => b.computed))) {
    const demo = el('b', 'calcdemo', 'Unit 5');
    demo.style.fontWeight = '700';
    legend.append(item(demo, '추천이 없어 계산한 값'));
  }
  footEl.append(next, legend);
  footEl.hidden = false;
  fitMain(); // 하단 영역이 자리를 잡은 뒤에 맞춘다(전에는 하단이 비어 있을 때 맞춰서 아래가 잘릴 수 있었다)
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
