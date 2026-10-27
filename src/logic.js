'use strict';
// 화면 계산 로직. Electron/네트워크에 의존하지 않는 순수 함수만 둔다.
// weekday 규약: schedule_slots.weekday, progress.weekdays 는 JS Date#getDay() 와 같다(0=일요일).
// 실제 데이터(시간표 1~4, 진도 {1,2,3,4})가 월~목으로 들어 있어 이 해석과 맞는다.

const REC_EXCLUDED_STATUS = '거절';

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function dateLabel(d) {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KO[d.getDay()]})`;
}

function toMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':');
  return Number(h) * 60 + Number(m);
}

function hhmm(t) {
  return t ? String(t).slice(0, 5) : '';
}

function slotState(slot, now) {
  const s = toMinutes(slot.start_time);
  const e = toMinutes(slot.end_time);
  if (s == null || e == null) return 'upcoming';
  const cur = now.getHours() * 60 + now.getMinutes();
  if (cur >= e) return 'past';
  if (cur >= s) return 'now';
  return 'upcoming';
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

// 교재 단원 표기. structure.items 가 있으면 그 이름, 없으면 `${unit_label} N`.
// 기존 웹앱의 'Unit 2 › Part B' 하위 항목 표기는 아직 반영하지 않았다(app.js 와 대조 필요).
function unitText(book, unit) {
  const n = Number(unit);
  const items = book && book.structure && Array.isArray(book.structure.items) ? book.structure.items : null;
  if (items && items.length) {
    const item = items[Math.max(0, Math.ceil(n) - 1)];
    if (item && item.name) return String(item.name);
  }
  return `${(book && book.unit_label) || 'Unit'} ${fmtNum(n)}`;
}

function rangeText(book, from, to) {
  const a = unitText(book, from);
  const b = unitText(book, to);
  return Number(from) === Number(to) || a === b ? a : `${a} – ${b}`;
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

function buildBoard({ students, textbooks, progress, recommendations, slots }, now, nameMode) {
  const todayKey = dateKey(now);
  const wd = now.getDay();
  const stuById = new Map(students.filter((s) => s.active !== false).map((s) => [s.id, s]));
  const bookById = new Map(textbooks.map((t) => [t.id, t]));

  const todaySlots = slots
    .filter((s) => s.weekday === wd)
    .sort((a, b) => a.slot_order - b.slot_order);

  const slotRows = todaySlots.map((s) => ({
    label: s.label,
    start: hhmm(s.start_time),
    end: hhmm(s.end_time),
    state: slotState(s, now),
    students: (s.student_ids || [])
      .map((id) => stuById.get(id))
      .filter(Boolean)
      .map((st) => maskName(st.name, nameMode)),
  }));

  // 오늘 수업이 있는 학생(시간표 등장 순서대로, 중복 제거)
  const order = [];
  for (const s of todaySlots) {
    for (const id of s.student_ids || []) {
      if (stuById.has(id) && !order.includes(id)) order.push(id);
    }
  }

  const cards = [];
  for (const id of order) {
    const st = stuById.get(id);
    const mine = progress.filter((p) => {
      if (p.student_id !== id) return false;
      const days = p.weekdays || [];
      return days.length === 0 || days.includes(wd); // 요일 미지정 교재는 매일 포함
    });
    for (const p of mine) {
      const book = bookById.get(p.textbook_id);
      if (!book) continue;
      const rec = pickRecommendation(recommendations, id, p.textbook_id, todayKey);
      let range = null;
      let computed = false;
      let rationale = null;
      if (rec) {
        range = rangeText(book, rec.from_unit, rec.to_unit);
        rationale = rec.rationale || null;
      } else {
        const c = computeRange(p);
        range = rangeText(book, c.from, c.to);
        computed = true;
      }
      const total = Number(book.total_units) || 0;
      const current = Number(p.current_unit) || 0;
      cards.push({
        name: maskName(st.name, nameMode),
        book: book.title,
        current,
        total,
        pct: total > 0 ? Math.max(0, Math.min(100, (current / total) * 100)) : 0,
        progressText: `${fmtNum(current)} / ${total}`,
        range,
        computed,
        rationale,
      });
    }
  }

  return {
    dateLabel: dateLabel(now),
    dayOff: todaySlots.length === 0,
    slots: slotRows,
    cards,
  };
}

module.exports = {
  dateKey, dateLabel, slotState, maskName, unitText, rangeText,
  pickRecommendation, computeRange, buildBoard, WEEKDAY_KO,
};
