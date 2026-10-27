'use strict';
// Supabase 읽기 전용 접근. SELECT 만 사용하고 쓰기 호출은 두지 않는다.
// 필요한 컬럼만 고른다 — 선생님 메모(memo, teacher_comment)는 요청하지 않는다.
const { createClient } = require('@supabase/supabase-js');
const { authStorage } = require('./store');
const { dateKey } = require('./logic');

function makeClient(url, key) {
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: authStorage,
      storageKey: 'dashboard',
    },
  });
}

function unwrap(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data || [];
}

async function fetchAll(client, now) {
  // 자정 경계에서도 오늘/어제 추천을 모두 갖고 있도록 하루 전부터 읽는다.
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const [students, textbooks, progress, recommendations, slots] = await Promise.all([
    client.from('students').select('id,name,grade,active').eq('active', true),
    client.from('textbooks').select('id,title,total_units,unit_label,structure'),
    client.from('progress').select('student_id,textbook_id,current_unit,weekdays,daily_min,daily_max,daily_unit'),
    client
      .from('recommendations')
      .select('student_id,textbook_id,target_date,from_unit,to_unit,rationale,status,created_at')
      .gte('target_date', dateKey(y))
      .neq('status', '거절'),
    client.from('schedule_slots').select('weekday,slot_order,label,start_time,end_time,student_ids'),
  ]);
  return {
    students: unwrap(students, 'students'),
    textbooks: unwrap(textbooks, 'textbooks'),
    progress: unwrap(progress, 'progress'),
    recommendations: unwrap(recommendations, 'recommendations'),
    slots: unwrap(slots, 'schedule_slots'),
  };
}

module.exports = { makeClient, fetchAll };
