'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic');

// 2026-10-27 은 화요일(getDay()=2)
const NOW = new Date(2026, 9, 27, 15, 45);

test('dateKey / dateLabel', () => {
  assert.equal(L.dateKey(NOW), '2026-10-27');
  assert.equal(L.dateLabel(NOW), '10월 27일 (화)');
});

test('slotState 진행 중/지난/예정', () => {
  const mk = (s, e) => ({ start_time: s, end_time: e });
  assert.equal(L.slotState(mk('14:30:00', '15:30:00'), NOW), 'past');
  assert.equal(L.slotState(mk('15:30:00', '16:30:00'), NOW), 'now');
  assert.equal(L.slotState(mk('16:30:00', '17:30:00'), NOW), 'upcoming');
  assert.equal(L.slotState({}, NOW), 'upcoming');
});

test('maskName 가림 방식', () => {
  assert.equal(L.maskName('김하늘', 'full'), '김하늘');
  assert.equal(L.maskName('김하늘', 'surname'), '김○○');
  assert.equal(L.maskName('김하늘', 'given'), '하늘');
  assert.equal(L.maskName('김하', 'given'), '김하');
  assert.equal(L.maskName('김하늘', 'initial'), 'ㄱㅎㄴ');
});

test('unitText: structure.items 이름 / 기본 라벨 / 0.5 단위', () => {
  const plain = { unit_label: 'Unit' };
  assert.equal(L.unitText(plain, 13), 'Unit 13');
  assert.equal(L.unitText(plain, 2.5), 'Unit 2.5');
  const sw = { unit_label: 'Sight Words', structure: { items: [{ name: '1-25' }, { name: '26-50' }] } };
  assert.equal(L.unitText(sw, 2), '26-50');
  assert.equal(L.rangeText(plain, 13, 14), 'Unit 13 – Unit 14');
  assert.equal(L.rangeText(plain, 5, 5), 'Unit 5');
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

test('buildBoard: 오늘 슬롯만, 순서·상태, 퇴원생 제외, 요일 불일치 교재 제외', () => {
  const b = L.buildBoard(base(), NOW, 'full');
  assert.equal(b.dayOff, false);
  assert.deepEqual(b.slots.map((s) => [s.label, s.state, s.students]), [
    ['타임 1', 'past', ['김하늘']],
    ['타임 2', 'now', ['이서준']],
  ]);
  assert.equal(b.cards.length, 1); // s2 의 교재는 수요일 배정이라 화요일엔 없음
  assert.equal(b.cards[0].range, 'Unit 13 – Unit 14');
  assert.equal(b.cards[0].computed, false);
  assert.equal(b.cards[0].progressText, '12 / 30');
});

test('buildBoard: 추천 없으면 계산값 표시, 요일 미지정 교재는 포함', () => {
  const d = base();
  d.recommendations = [];
  d.progress[1].weekdays = [];
  const b = L.buildBoard(d, NOW, 'surname');
  assert.equal(b.cards.length, 2);
  assert.equal(b.cards[0].computed, true);
  assert.equal(b.cards[0].range, 'Unit 13');
  assert.equal(b.cards[0].name, '김○○');
});

test('buildBoard: 수업 없는 날', () => {
  const sun = new Date(2026, 9, 25, 10, 0);
  const b = L.buildBoard(base(), sun, 'full');
  assert.equal(b.dayOff, true);
  assert.equal(b.cards.length, 0);
});
