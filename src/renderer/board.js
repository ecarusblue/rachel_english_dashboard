'use strict';

const $ = (id) => document.getElementById(id);
const dateEl = $('date');
const syncEl = $('sync');
const slotsEl = $('slots');
const cardsEl = $('cards');
const mainEl = $('main');
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

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // 데이터는 항상 textContent 로만 넣는다
  return n;
}

function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showNotice(title, sub) {
  const box = el('div', null, title);
  if (sub) box.append(el('small', null, sub));
  noticeEl.replaceChildren(box);
  noticeEl.hidden = false;
}

function renderSlots(slots) {
  slotsEl.replaceChildren();
  for (const s of slots) {
    const li = el('li', `slot ${s.state}`);
    const when = el('div', 'when');
    when.append(el('span', null, s.start && s.end ? `${s.start}–${s.end}` : ''), el('span', 'label', s.label));
    li.append(when, el('div', 'who', s.students.length ? s.students.join(', ') : '배정 없음'));
    slotsEl.append(li);
  }
}

function cardNode(c) {
  const card = el('div', `card${c.computed ? ' computed' : ''}`);
  const head = el('div', 'head');
  head.append(el('span', 'name', c.name), el('span', 'book', c.book));
  const bar = el('div', 'bar');
  const track = el('div', 'track');
  const fill = el('div', 'fill');
  fill.style.width = `${c.pct}%`;
  track.append(fill);
  bar.append(track, el('span', 'num', c.progressText));
  const range = el('div', 'range');
  range.append(document.createTextNode(`추천  ${c.range}`));
  if (c.computed) range.append(el('span', 'tag', '계산값'));
  card.append(head, bar, range);
  if (c.rationale) card.append(el('div', 'why', c.rationale));
  return card;
}

// 카드가 한 화면에 안 들어가면 열 수를 늘리고 → 글자를 줄이고 → 그래도 안 되면 "외 N명" (스크롤·순환 없음)
function fitCards(cards) {
  cardsEl.replaceChildren();
  if (!cards.length) {
    cardsEl.append(el('div', 'empty', '오늘 표시할 추천 진도가 없습니다.'));
    return;
  }
  const nodes = cards.map(cardNode);
  nodes.forEach((n) => cardsEl.append(n));

  const maxCols = window.innerWidth >= 1800 ? 3 : 2;
  const overflow = () => cardsEl.scrollHeight > cardsEl.clientHeight + 1;
  const set = (cols, scale) => {
    cardsEl.style.setProperty('--cols', String(cols));
    cardsEl.style.setProperty('--scale', String(scale));
  };

  for (let cols = 1; cols <= maxCols; cols++) {
    set(cols, 1);
    if (!overflow()) return;
  }
  for (let scale = 0.95; scale >= 0.5; scale -= 0.05) {
    set(maxCols, scale);
    if (!overflow()) return;
  }

  // 최소 크기에서도 넘치면 뒤 카드를 줄이고 "외 N명" 표시
  set(maxCols, 0.5);
  const more = el('div', 'more');
  cardsEl.append(more);
  let hidden = 0;
  while (overflow() && nodes.length - hidden > 1) {
    hidden += 1;
    nodes[nodes.length - hidden].remove();
    more.textContent = `외 ${hidden}명`;
  }
}

let lastCardsKey = '';
function render({ model, status }) {
  // 안내 상태
  if (!status.configured) return showNotice('Supabase 연결 설정이 필요합니다', 'Esc 키를 눌러 설정을 여세요');
  if (!status.loggedIn) return showNotice('로그인이 필요합니다', 'Esc 키를 눌러 설정을 여세요');
  if (!model) {
    return showNotice(status.error ? '데이터를 불러오지 못했습니다' : '불러오는 중…', status.error || '');
  }

  noticeEl.hidden = true;
  dateEl.textContent = `오늘  ${model.dateLabel}`;

  if (status.error) {
    syncEl.className = 'sync warn';
    syncEl.textContent = `⚠ 갱신 실패 · 마지막 성공 ${status.lastOk ? hhmm(status.lastOk) : '-'}`;
  } else {
    syncEl.className = 'sync';
    syncEl.textContent = status.lastOk ? `마지막 갱신 ${hhmm(status.lastOk)}` : '';
  }

  if (model.dayOff) {
    return showNotice('오늘은 수업이 없습니다');
  }

  mainEl.hidden = false;
  renderSlots(model.slots);
  // 같은 내용이면 카드를 다시 그리지 않는다(깜빡임 방지)
  const key = JSON.stringify(model.cards) + window.innerWidth + 'x' + window.innerHeight;
  if (key !== lastCardsKey) {
    lastCardsKey = key;
    fitCards(model.cards);
  }
}

let current = null;
function apply(state) {
  current = state;
  render(state);
}

window.api.onState(apply);
window.api.getState().then(apply);
window.addEventListener('resize', () => {
  lastCardsKey = '';
  if (current) render(current);
});
