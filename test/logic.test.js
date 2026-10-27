'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic');

// 2026-10-27 은 화요일(getDay()=2)
const NOW = new Date(2026, 9, 27, 15, 45);

test('날짜 표기', () => {
  assert.equal(L.dateKey(NOW), '2026-10-27');
  assert.equal(L.dateText(NOW), '10월 27일');
  assert.equal(L.weekdayText(NOW), '화요일');
});

test('maskName 가림 방식', () => {
  assert.equal(L.maskName('김하늘', 'full'), '김하늘');
  assert.equal(L.maskName('김하늘', 'surname'), '김○○');
  assert.equal(L.maskName('김하늘', 'given'), '하늘');
  assert.equal(L.maskName('김하', 'given'), '김하');
  assert.equal(L.maskName('김하늘', 'initial'), 'ㄱㅎㄴ');
});

test('unitText / rangeText: 단원 이름은 한 번만, 항목형 교재는 이름 범위, 0.5 단위', () => {
  const plain = { unit_label: 'Unit' };
  assert.equal(L.unitText(plain, 13), 'Unit 13');
  assert.equal(L.unitText(plain, 2.5), 'Unit 2.5');
  assert.equal(L.rangeText(plain, 13, 14), 'Unit 13–14');
  assert.equal(L.rangeText(plain, 5, 5), 'Unit 5');
  const sw = { unit_label: 'Sight Words', structure: { items: [{ name: '1-25' }, { name: '26-50' }, { name: '51-75' }] } };
  assert.equal(L.unitText(sw, 2), '26-50');
  assert.equal(L.rangeText(sw, 2, 3), '26-50 ~ 51-75');
  assert.equal(L.rangeText(sw, 2, 2), '26-50');
});

test('pickRecommendation: 오늘자만, 거절 제외, 최신 우선', () => {
  const recs = [
    { student_id: 'a', textbook_id: 'b', target_date: '2026-10-27', status: '거절', created_at: '2026-10-27T09:00' },
    { student_id: 'a', textbook_id: 'b', target_date: '2026-10-27', status: '제안', created_at: '2026-10-26T09:00', id: 1 },
    { student_id: 'a', textbook_id: 'b', target_date: '2026-10-27', status: '수정', created_at: '2026-10-27T08:00', id: 2 },
    { student_id: 'a', textbook_id: 'b', target_date: '2026-10-28', status: '제안', created_at: '2026-10-27T10:00', id: 3 },
  ];
  assert.equal(L.pickRecommendation(recs, 'a', 'b', '2026-10-27').id, 2);
  assert.equal(L.pickRecommendation(recs, 'a', 'x', '2026-10-27'), null);
});

test('computeRange: 현재 다음 단원부터 daily_max 만큼, 값 없으면 1', () => {
  assert.deepEqual(L.computeRange({ current_unit: 12 }), { from: 13, to: 13 });
  assert.deepEqual(L.computeRange({ current_unit: 12, daily_min: 1, daily_max: 2 }), { from: 13, to: 14 });
});

test('makeBook: 진도 막대 비율과 표기', () => {
  const b = L.makeBook({ title: 'G', unit_label: 'Unit', total_units: 30 }, 12, 13, 14, false, '근거');
  assert.equal(b.progressText, '12/30');
  assert.equal(b.pct, 40);
  assert.ok(Math.abs(b.recPct - (2 / 30) * 100) < 1e-9);
  assert.equal(b.range, 'Unit 13–14');
  assert.equal(b.rationale, '근거');
});

const base = () => ({
  students: [
    { id: 's1', name: '김하늘', active: true },
    { id: 's2', name: '이서준', active: true },
    { id: 's3', name: '박퇴원', active: false },
  ],
  textbooks: [{ id: 't1', title: 'Grammar 2', total_units: 30, unit_label: 'Unit' }],
  progress: [
    { student_id: 's1', textbook_id: 't1', current_unit: 12, weekdays: [1, 2, 3, 4] },
    { student_id: 's2', textbook_id: 't1', current_unit: 5, weekdays: [3] }, // 화요일 아님
  ],
  recommendations: [
    { student_id: 's1', textbook_id: 't1', target_date: '2026-10-27', from_unit: 13, to_unit: 14, rationale: '근거', status: '제안', created_at: 'x' },
  ],
  slots: [
    { weekday: 2, slot_order: 1, label: '타임 2', start_time: '15:30:00', end_time: '16:30:00', student_ids: ['s2', 's3'] },
    { weekday: 2, slot_order: 0, label: '타임 1', start_time: '14:30:00', end_time: '15:30:00', student_ids: ['s1'] },
    { weekday: 1, slot_order: 0, label: '월', start_time: '14:30:00', end_time: '15:30:00', student_ids: ['s1'] },
  ],
});

test('buildDashboard: 오늘 슬롯만, 순서, 퇴원생 제외, 요일 불일치 교재 제외, 수업 시간대', () => {
  const m = L.buildDashboard(base(), NOW, 'full');
  assert.equal(m.dateText, '10월 27일');
  assert.equal(m.weekday, '화요일');
  assert.equal(m.dayOff, false);
  assert.deepEqual(m.hours, { start: '14:30', end: '16:30' });
  assert.deepEqual(m.slots.map((s) => [s.label, s.start, s.end, s.students.map((x) => x.name)]), [
    ['타임 1', '14:30', '15:30', ['김하늘']],
    ['타임 2', '15:30', '16:30', ['이서준']],
  ]);
  const hana = m.slots[0].students[0];
  assert.equal(hana.books.length, 1);
  assert.equal(hana.books[0].range, 'Unit 13–14');
  assert.equal(hana.books[0].computed, false);
  assert.equal(m.slots[1].students[0].books.length, 0); // 이서준 교재는 수요일 배정
});

test('buildDashboard: 추천 없으면 계산값, 요일 미지정 교재는 포함, 이름 가림', () => {
  const d = base();
  d.recommendations = [];
  d.progress[1].weekdays = [];
  const m = L.buildDashboard(d, NOW, 'surname');
  const b1 = m.slots[0].students[0];
  assert.equal(b1.name, '김○○');
  assert.equal(b1.books[0].computed, true);
  assert.equal(b1.books[0].range, 'Unit 13');
  assert.equal(m.slots[1].students[0].books.length, 1);
});

test('buildDashboard: 수업 없는 날', () => {
  const sun = new Date(2026, 9, 25, 10, 0);
  const m = L.buildDashboard(base(), sun, 'full');
  assert.equal(m.dayOff, true);
  assert.equal(m.hours, null);
  assert.equal(m.slots.length, 0);
});

test('normalizeCustom: 기본값, 정렬 검증, 글자 크기 범위, 길이 제한, 줄바꿈 통일', () => {
  assert.deepEqual(L.normalizeCustom(null), { text: '', align: 'left', size: 56 });
  assert.deepEqual(L.normalizeCustom({ text: 'a\r\nb\rc', align: 'center', size: 80.4 }), { text: 'a\nb\nc', align: 'center', size: 80 });
  assert.equal(L.normalizeCustom({ align: 'justify' }).align, 'left'); // 허용하지 않는 값은 왼쪽
  assert.equal(L.normalizeCustom({ size: 5 }).size, L.LIMITS.sizeMin);
  assert.equal(L.normalizeCustom({ size: 9999 }).size, L.LIMITS.sizeMax);
  assert.equal(L.normalizeCustom({ size: 'abc' }).size, L.LIMITS.sizeDefault);
  assert.equal(L.normalizeCustom({ text: 'x'.repeat(L.LIMITS.text + 50) }).text.length, L.LIMITS.text);
});

test('hasCustomText: 공백만 있으면 내용 없음', () => {
  assert.equal(L.hasCustomText({ text: '  \n ' }), false);
  assert.equal(L.hasCustomText({ text: '안내' }), true);
  assert.equal(L.hasCustomText(null), false);
});

test('buildCustom: 날짜 머리 + 글 한 덩어리, 이름 가림은 적용하지 않는다', () => {
  const m = L.buildCustom({ text: '오늘은 단어시험이 있습니다.\n김하늘 2번', align: 'right', size: 72 }, NOW);
  assert.equal(m.kind, 'text');
  assert.equal(m.dateText, '10월 27일');
  assert.equal(m.weekday, '화요일');
  assert.equal(m.text, '오늘은 단어시험이 있습니다.\n김하늘 2번');
  assert.equal(m.align, 'right');
  assert.equal(m.size, 72);
  assert.equal(m.dayOff, false);
  assert.deepEqual(m.slots, []);
});

const D = (id, w, h, label) => ({ id, label, size: { width: w, height: h } });

test('chooseDisplay: 화면이 하나뿐이면 저장된 선택과 상관없이 그 화면(복제 모드)', () => {
  const only = [D(7, 1920, 1080)];
  assert.equal(L.chooseDisplay(only, 7, 99).id, 7);
  assert.equal(L.chooseDisplay(only, 7, null).id, 7);
  assert.equal(L.chooseDisplay([], 1, null), null);
});

test('chooseDisplay: 둘 이상이면 저장된 화면, 없으면 기다림(null), 미지정이면 보조 화면', () => {
  const two = [D(1, 1920, 1080), D(2, 3840, 2160)];
  assert.equal(L.chooseDisplay(two, 1, 2).id, 2);
  assert.equal(L.chooseDisplay(two, 1, 1).id, 1);
  assert.equal(L.chooseDisplay(two, 1, 99), null);
  assert.equal(L.chooseDisplay(two, 1, null).id, 2);
  assert.equal(L.chooseDisplay(two, 2, null).id, 1);
});

test('describeDisplays: 1번/2번 번호, 모니터 이름, 해상도, 주/보조', () => {
  const list = L.describeDisplays([D(1, 1920, 1080, 'DELL U2412M'), D(2, 3840, 2160, '')], 1);
  assert.deepEqual(list.map((x) => x.number), [1, 2]);
  assert.equal(list[0].label, '1번 · DELL U2412M · 1920×1080 · 주 화면');
  assert.equal(list[1].label, '2번 · 3840×2160 · 보조 화면');
  assert.equal(list[1].id, 2);
});
