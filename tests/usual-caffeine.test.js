import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usualCup, usualReason, bandOf, USUAL_DAYS } from '../js/core/usual.js';
import { coffeeDayStart, todayCaffeine, caffeineKeeper, durationText } from '../js/core/caffeine.js';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
let seq = 0;
const brew = (o) => ({ id: `w${++seq}`, recipeId: 'r1', beanId: 'b1', deletedAt: null, ...o });
const tasting = (brewId, stars) => ({ id: `t-${brewId}`, brewId, by: 'me', stage: 'warm', stars, deletedAt: null, updatedAt: '2026-11-01' });
const recipes = [
  { id: 'r1', name: '朝の4:6', deletedAt: null },
  { id: 'r2', name: '夜のやさしい', deletedAt: null },
];

test('時間帯の境目（5時・11時・17時）', () => {
  assert.equal(bandOf(new Date(2026, 10, 18, 4, 59)).key, 'night');
  assert.equal(bandOf(new Date(2026, 10, 18, 5, 0)).key, 'morning');
  assert.equal(bandOf(new Date(2026, 10, 18, 10, 59)).key, 'morning');
  assert.equal(bandOf(new Date(2026, 10, 18, 11, 0)).key, 'day');
  assert.equal(bandOf(new Date(2026, 10, 18, 17, 0)).key, 'night');
});

test('今の時間帯でいちばん多い豆＋レシピ', () => {
  const brews = [
    brew({ at: at(10, 7), recipeId: 'r1', beanId: 'b1' }),
    brew({ at: at(11, 8), recipeId: 'r1', beanId: 'b1' }),
    brew({ at: at(12, 21), recipeId: 'r2', beanId: 'b2' }),
    brew({ at: at(13, 22), recipeId: 'r2', beanId: 'b2' }),
    brew({ at: at(14, 23), recipeId: 'r2', beanId: 'b2' }),
  ];
  const morning = usualCup({ brews, recipes, usableBeanIds: ['b1', 'b2'], now: new Date(2026, 10, 18, 7) });
  assert.equal(morning.recipe.id, 'r1');
  assert.equal(morning.beanId, 'b1');
  assert.equal(morning.count, 2);
  assert.equal(morning.href, 'brew.html?recipe=r1&bean=b1');
  assert.equal(usualReason(morning), `朝によく淹れる組み合わせ（直近${USUAL_DAYS}日で2回）`);
  const night = usualCup({ brews, recipes, usableBeanIds: ['b1', 'b2'], now: new Date(2026, 10, 18, 1) });
  assert.equal(night.recipe.id, 'r2');
  // 昼は記録がないので、時間帯を問わず多いもの
  const day = usualCup({ brews, recipes, usableBeanIds: ['b1', 'b2'], now: new Date(2026, 10, 18, 13) });
  assert.equal(day.recipe.id, 'r2');
  assert.equal(day.allDay, true);
});

test('★3未満の杯・削除した杯・60日より前の杯・レシピのない杯は数えない', () => {
  const low = [brew({ at: at(10, 7), recipeId: 'r2' }), brew({ at: at(11, 7), recipeId: 'r2' })];
  const brews = [
    ...low,
    brew({ at: at(12, 7), recipeId: 'r1' }),
    brew({ at: at(12, 8), recipeId: 'r2', deletedAt: '2026-11-12' }),
    brew({ at: new Date(2026, 8, 1, 7).toISOString(), recipeId: 'r2' }),
    brew({ at: at(13, 7), recipeId: null }),
    brew({ at: at(13, 8), recipeId: 'gone' }),
  ];
  const tastings = low.map((b) => tasting(b.id, 2));
  const u = usualCup({ brews, tastings, recipes, usableBeanIds: ['b1'], now: new Date(2026, 10, 18, 7) });
  assert.equal(u.recipe.id, 'r1');
  assert.equal(u.count, 1);
});

test('記録がなければ出さない', () => {
  assert.equal(usualCup({ brews: [], recipes, usableBeanIds: ['b1'], now: new Date() }), null);
});

test('いつもの豆が残っていなければ、同じレシピで最近淹れた今ある豆', () => {
  const brews = [
    brew({ at: at(10, 7), beanId: 'old' }),
    brew({ at: at(11, 7), beanId: 'old' }),
    brew({ at: at(12, 20), beanId: 'b3', recipeId: 'r2' }),
    brew({ at: at(9, 20), beanId: 'b2', recipeId: 'r2' }),
  ];
  const u = usualCup({ brews, recipes, usableBeanIds: ['b2', 'b3'], now: new Date(2026, 10, 18, 8) });
  assert.equal(u.recipe.id, 'r1');
  assert.equal(u.beanId, 'b3');
  assert.equal(u.beanChanged, true);
  assert.match(usualReason(u), /今ある豆にしました/);
  // 今ある豆がなければ豆を選ばない
  const none = usualCup({ brews, recipes, usableBeanIds: [], now: new Date(2026, 10, 18, 8) });
  assert.equal(none.beanId, null);
  assert.equal(none.href, 'brew.html?recipe=r1');
});

test('1日の区切りは朝5時', () => {
  assert.equal(coffeeDayStart(new Date(2026, 10, 18, 4, 59)).getTime(), new Date(2026, 10, 17, 5).getTime());
  assert.equal(coffeeDayStart(new Date(2026, 10, 18, 5, 0)).getTime(), new Date(2026, 10, 18, 5).getTime());
});

test('今日のカフェイン：朝5時から今まで、カフェインレスは数えない', () => {
  const row = (d, h, mg, o = {}) => ({ brew: { at: at(d, h) }, bean: o.bean ?? null, metrics: { caffeineMg: mg } });
  const rows = [
    row(17, 23, 100), // 昨日の夜（今日ではない）
    row(18, 2, 80), // 夜中2時は前の日
    row(18, 6, 120),
    row(18, 9, 90),
    row(18, 10, 50, { bean: { decaf: true } }),
    row(18, 11, null),
    row(18, 15, 70), // まだ先
  ];
  assert.deepEqual(todayCaffeine(rows, new Date(2026, 10, 18, 12)), { mg: 210, cups: 4, unknown: 1 });
  assert.deepEqual(todayCaffeine(rows, new Date(2026, 10, 18, 3)), { mg: 180, cups: 2, unknown: 0 });
});

test('控える時刻までの残りと、過ぎたとき・目安を超えたとき', () => {
  const k = caffeineKeeper({ now: new Date(2026, 10, 18, 12, 50), cutoff: '15:00', mg: 120 });
  assert.equal(k.minutesLeft, 130);
  assert.equal(k.late, false);
  assert.equal(k.main, '今日のカフェイン 約120mg／目安400mg');
  assert.equal(k.sub, '控える時刻 15:00 まで、あと2時間10分');
  assert.equal(k.pct, 30);
  const past = caffeineKeeper({ now: new Date(2026, 10, 18, 15, 0), cutoff: '15:00', mg: 120 });
  assert.equal(past.late, true);
  assert.match(past.sub, /15:00を過ぎました/);
  const night = caffeineKeeper({ now: new Date(2026, 10, 18, 3, 0), cutoff: '23:00', mg: 0 });
  assert.equal(night.late, true);
  const over = caffeineKeeper({ now: new Date(2026, 10, 18, 9, 0), cutoff: null, mg: 450 });
  assert.equal(over.over, true);
  assert.equal(over.pct, 100);
  assert.match(over.sub, /目安に届きました/);
  const none = caffeineKeeper({ now: new Date(2026, 10, 18, 9, 0), cutoff: null, mg: 0 });
  assert.equal(none.minutesLeft, null);
  assert.match(none.sub, /今日の一杯/);
});

test('残り時間の言い方', () => {
  assert.equal(durationText(45), '45分');
  assert.equal(durationText(60), '1時間');
  assert.equal(durationText(61), '1時間1分');
});
