'use strict';
// 개발용 가짜 데이터(DASHBOARD_DEMO=1 로 실행할 때만 사용). 실제 학생 정보가 아니다.
const { dateKey } = require('./logic');

function makeDemo(now) {
  const wd = now.getDay();
  const today = dateKey(now);
  const names = ['김가나', '이다라', '박마바', '최사아', '정자차', '한카타', '오파하', '윤가온', '서나래', '문보람'];
  const students = names.map((name, i) => ({ id: `s${i}`, name, grade: '초5', active: true }));
  const textbooks = [
    { id: 't1', title: 'Grammar Inside 2', total_units: 30, unit_label: 'Unit', structure: null },
    { id: 't2', title: 'Reading Explorer', total_units: 20, unit_label: 'Chapter', structure: null },
    { id: 't3', title: 'Sight Words', total_units: 12, unit_label: 'Sight Words', structure: { items: Array.from({ length: 12 }, (_, i) => ({ name: `${i * 25 + 1}-${(i + 1) * 25}` })) } },
  ];
  const progress = students.flatMap((s, i) => [
    { student_id: s.id, textbook_id: 't1', current_unit: 5 + i, weekdays: [], daily_min: null, daily_max: i % 3 === 0 ? 2 : null, daily_unit: 'leaf' },
    ...(i % 2 === 0 ? [{ student_id: s.id, textbook_id: i % 4 === 0 ? 't3' : 't2', current_unit: 2 + (i % 5) + 0.5, weekdays: [wd], daily_min: null, daily_max: null, daily_unit: 'leaf' }] : []),
  ]);
  const recommendations = students.slice(0, 6).map((s, i) => ({
    student_id: s.id, textbook_id: 't1', target_date: today, from_unit: 6 + i, to_unit: 7 + i,
    rationale: i % 2 ? '지난 수업 숙제를 모두 제출해 한 단원 더 나갑니다.' : '문법 시험 점수가 높아 속도를 조금 올립니다.',
    status: '제안', created_at: `${today}T08:00:00Z`,
  }));
  const slot = (order, start, end, ids) => ({
    weekday: wd, slot_order: order, label: `타임 ${order + 1}`, start_time: start, end_time: end, student_ids: ids,
  });
  const slots = [
    slot(0, '14:30:00', '15:30:00', students.slice(0, 4).map((s) => s.id)),
    slot(1, '15:30:00', '16:30:00', students.slice(4, 8).map((s) => s.id)),
    slot(2, '16:30:00', '17:30:00', students.slice(8).map((s) => s.id)),
  ];
  return { students, textbooks, progress, recommendations, slots };
}

module.exports = { makeDemo };
