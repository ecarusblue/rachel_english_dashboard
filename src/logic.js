'use strict';
// 화면 계산 로직. Electron/네트워크에 의존하지 않는 순수 함수만 둔다.
// weekday 규약: schedule_slots.weekday, progress.weekdays 는 JS Date#getDay() 와 같다(0=일요일).
// 실제 데이터(시간표 1~4, 진도 {1,2,3,4})가 월~목으로 들어 있어 이 해석과 맞는다.
//
// 현황(DB)과 직접 입력은 같은 "대시보드 모델"로 모은 뒤 한 화면(board)에서 그린다.
//   { dateText, weekday, dayOff, hours:{start,end}|null,
//     slots:[{ label, start, end, students:[{ name, books:[book] }] }] }
//   book = { title, unitLabel, total, current, from, to, pct, recPct, progressText, range, computed, rationale }
// 타임의 지금/지난/예정 상태는 화면이 자기 시계로 계산한다(모델에는 넣지 않는다).

const REC_EXCLUDED_STATUS = '거절';

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function dateText(d) {
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function weekdayText(d) {
  return `${WEEKDAY_KO[d.getDay()]}요일`;
}

function toMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':');
  return Number(h) * 60 + Number(m);
}

function hhmm(t) {
  return t ? String(t).slice(0, 5) : '';
}

// 한글 초성
const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function initialOf(ch) {
  const code = ch.codePointAt(0) - 0xac00;
  if (code >= 0 && code <= 11171) return CHOSEONG[Math.floor(code / 588)];
  return ch.toUpperCase();
}

// mode: full | surname(성+○○) | given(이름만) | initial(초성)
function maskName(name, mode) {
  const chars = Array.from(String(name || '').trim());
  if (!chars.length) return '';
  switch (mode) {
    case 'surname':
      return chars[0] + '○'.repeat(chars.length - 1);
    case 'given':
      return chars.length >= 3 ? chars.slice(1).join('') : chars.join('');
    case 'initial':
      return chars.map(initialOf).join('');
    default:
      return chars.join('');
  }
}

function fmtNum(n) {
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function structureItems(book) {
  return book && book.structure && Array.isArray(book.structure.items) && book.structure.items.length
    ? book.structure.items
    : null;
}

// 교재 단원 표기. structure.items 가 있으면 그 이름, 없으면 `${unit_label} N`.
// 기존 웹앱의 'Unit 2 › Part B' 하위 항목 표기는 아직 반영하지 않았다(app.js 와 대조 필요).
function unitText(book, unit) {
  const n = Number(unit);
  const items = structureItems(book);
  if (items) {
    const item = items[Math.max(0, Math.ceil(n) - 1)];
    if (item && item.name) return String(item.name);
  }
  return `${(book && book.unit_label) || 'Unit'} ${fmtNum(n)}`;
}

// 범위 표기: 'Unit 13–14' (단원 이름은 한 번만), 항목형 교재는 '26-50 ~ 51-75'
function rangeText(book, from, to) {
  const f = Number(from);
  const t = Number(to);
  if (structureItems(book)) {
    const a = unitText(book, f);
    const b = unitText(book, t);
    return a === b ? a : `${a} ~ ${b}`;
  }
  const label = (book && book.unit_label) || 'Unit';
  return f === t ? `${label} ${fmtNum(f)}` : `${label} ${fmtNum(f)}–${fmtNum(t)}`;
}

// 오늘자 추천: 거절 제외, target_date 가 오늘인 것 중 가장 최근(created_at) 것.
function pickRecommendation(recs, studentId, textbookId, todayKey) {
  const list = recs.filter(
    (r) =>
      r.student_id === studentId &&
      r.textbook_id === textbookId &&
      r.target_date === todayKey &&
      r.status !== REC_EXCLUDED_STATUS
  );
  if (!list.length) return null;
  list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return list[0];
}

// 추천이 없을 때 계산값: 현재 진도 다음 단원부터 일일 분량(daily_max → daily_min → 1) 만큼.
// 실제 추천 데이터도 from_unit 이 대체로 current_unit + 1 이다.
function computeRange(progress) {
  const cur = Number(progress.current_unit) || 0;
  const span = Number(progress.daily_max) || Number(progress.daily_min) || 1;
  const from = cur + 1;
  return { from, to: from + span - 1 };
}

const clampPct = (v) => Math.max(0, Math.min(100, v));

// book: { title, unit_label, total_units, structure? }  (DB 교재 행 모양)
function makeBook(book, current, from, to, computed, rationale) {
  const total = Number(book.total_units) || 0;
  const cur = Number(current) || 0;
  const f = Number(from);
  const t = Number(to);
  return {
    title: book.title,
    unitLabel: book.unit_label || 'Unit',
    total,
    current: cur,
    from: f,
    to: t,
    pct: total > 0 ? clampPct((cur / total) * 100) : 0,
    recPct: total > 0 ? clampPct((Math.max(t - cur, 0) / total) * 100) : 0,
    progressText: `${fmtNum(cur)}/${total}`,
    range: rangeText(book, f, t),
    computed: !!computed,
    rationale: rationale || null,
  };
}

function hoursOf(slots) {
  const starts = slots.map((s) => toMinutes(s.start)).filter((x) => x != null);
  const ends = slots.map((s) => toMinutes(s.end)).filter((x) => x != null);
  if (!starts.length || !ends.length) return null;
  const f = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  return { start: f(Math.min(...starts)), end: f(Math.max(...ends)) };
}

function shell(now, slots) {
  return {
    dateText: dateText(now),
    weekday: weekdayText(now),
    dayOff: slots.length === 0,
    hours: hoursOf(slots),
    slots,
  };
}

// ---- 현황(DB) → 대시보드 모델 ----
function buildDashboard({ students, textbooks, progress, recommendations, slots }, now, nameMode) {
  const todayKey = dateKey(now);
  const wd = now.getDay();
  const stuById = new Map(students.filter((s) => s.active !== false).map((s) => [s.id, s]));
  const bookById = new Map(textbooks.map((t) => [t.id, t]));

  const todaySlots = slots
    .filter((s) => s.weekday === wd)
    .sort((a, b) => a.slot_order - b.slot_order);

  const out = todaySlots.map((s) => ({
    label: s.label,
    start: hhmm(s.start_time),
    end: hhmm(s.end_time),
    students: (s.student_ids || [])
      .map((id) => stuById.get(id))
      .filter(Boolean)
      .map((st) => {
        const books = [];
        for (const p of progress) {
          if (p.student_id !== st.id) continue;
          const days = p.weekdays || [];
          if (days.length && !days.includes(wd)) continue; // 요일 미지정 교재는 매일 포함
          const book = bookById.get(p.textbook_id);
          if (!book) continue;
          const rec = pickRecommendation(recommendations, st.id, p.textbook_id, todayKey);
          if (rec) {
            books.push(makeBook(book, p.current_unit, rec.from_unit, rec.to_unit, false, rec.rationale));
          } else {
            const c = computeRange(p);
            books.push(makeBook(book, p.current_unit, c.from, c.to, true, null));
          }
        }
        return { name: maskName(st.name, nameMode), books };
      }),
  }));

  return shell(now, out);
}

// ---- 직접 입력 (글만 적고 정렬·글자 크기를 정한다) ----
// custom = { text, align: 'left'|'center'|'right', size }   size = 1080p 기준 글자 크기(px)
const ALIGNS = ['left', 'center', 'right'];
const LIMITS = { text: 5000, sizeMin: 20, sizeMax: 200, sizeDefault: 56 };

function normalizeCustom(input) {
  const i = input && typeof input === 'object' ? input : {};
  const size = Number(i.size);
  return {
    text: String(i.text == null ? '' : i.text).replace(/\r\n?/g, '\n').slice(0, LIMITS.text),
    align: ALIGNS.includes(i.align) ? i.align : 'left',
    size: Number.isFinite(size)
      ? Math.min(LIMITS.sizeMax, Math.max(LIMITS.sizeMin, Math.round(size)))
      : LIMITS.sizeDefault,
  };
}

const hasCustomText = (c) => !!(c && String(c.text || '').trim());

// 글 모델: 현황 모델과 같은 머리(날짜·시각)를 쓰되 본문은 글 한 덩어리
function buildCustom(custom, now) {
  const c = normalizeCustom(custom);
  return {
    kind: 'text',
    dateText: dateText(now),
    weekday: weekdayText(now),
    dayOff: false,
    hours: null,
    slots: [],
    text: c.text,
    align: c.align,
    size: c.size,
  };
}

// ---- 디스플레이 ----
// displays: [{ id, label, size:{width,height} }] (Electron screen.getAllDisplays() 모양)

// 현황판을 띄울 화면을 고른다.
// - 화면이 하나뿐이면(복제 모드 포함) 저장된 선택과 상관없이 그 화면
// - 둘 이상이면 저장된 화면. 그 화면이 지금 없으면 null(기본 화면에 띄우지 않고 기다린다)
// - 저장된 선택이 없으면 보조 화면, 없으면 주 화면
function chooseDisplay(displays, primaryId, savedId) {
  if (!displays.length) return null;
  if (displays.length === 1) return displays[0];
  if (savedId != null) return displays.find((d) => d.id === savedId) || null;
  return displays.find((d) => d.id !== primaryId) || displays.find((d) => d.id === primaryId) || displays[0];
}

// 목록에 보여줄 이름. 번호는 이 앱이 정한 것이다(Windows 설정의 번호는 프로그램에서 알 수 없다).
function describeDisplays(displays, primaryId) {
  return displays.map((d, i) => ({
    id: d.id,
    number: i + 1,
    label: [
      `${i + 1}번`,
      d.label ? String(d.label) : null,
      `${d.size.width}×${d.size.height}`,
      d.id === primaryId ? '주 화면' : '보조 화면',
    ].filter(Boolean).join(' · '),
  }));
}

module.exports = {
  dateKey, dateText, weekdayText, maskName, unitText, rangeText,
  pickRecommendation, computeRange, makeBook,
  buildDashboard, buildCustom, normalizeCustom, hasCustomText, WEEKDAY_KO, LIMITS, ALIGNS,
  chooseDisplay, describeDisplays,
};
