// 未来の自分への申し送り（X32）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  handoverFor,
  showHandover,
  handoverBrewHref,
  conditionsText,
  bestHead,
  normalizeHandoverNote,
  HANDOVER_SHOW_CUPS,
  HANDOVER_NOTE_MAX,
} from '../js/core/handover.js';
import { openDb, addBean, setHandoverNote, getBeanWithTx, updateBean } from '../js/db.js';
import { normalizeBeanInput } from '../js/core/beans.js';

const bean = (id, extra = {}) => ({
  id,
  name: 'エチオピア イルガチェフェ',
  roastLevel: 'シティ',
  process: 'ウォッシュト',
  origin: { country: 'エチオピア' },
  createdAt: `2026-0${id.length}-01T00:00:00Z`,
  deletedAt: null,
  ...extra,
});
let seq = 0;
const brew = (beanId, at, extra = {}) => ({
  id: `br${++seq}`,
  beanId,
  at,
  deletedAt: null,
  planned: { name: 'いつもの', doseG: 15, waterG: 240, tempC: 92, grind: { grinderId: 'g1', setting: '24' } },
  actual: { doseG: 15, waterG: 240, tempC: 92, grind: { grinderId: 'g1', setting: '24' }, totalSec: 185 },
  derived: { ratio: 16, daysOffRoast: 10 },
  memo: '',
  ...extra,
});
const tasting = (brewId, stars, memo = '') => ({ id: `t${brewId}`, brewId, stars, memo, by: 'me', stage: 'warm', deletedAt: null, updatedAt: '2026-01-01T00:00:00Z' });

test('同じ銘柄の前の袋：★がいちばん高い杯（同じなら新しい杯）、メモは新しい順に3つ', () => {
  const old1 = bean('a');
  const old2 = bean('bb', { roastLevel: 'フルシティ' });
  const now = bean('ccc', { name: 'エチオピア　イルガチェフェ' }); // 全角の空白でも同じ銘柄
  const b1 = brew('a', '2026-03-01T07:00:00Z', { actual: { doseG: 15, waterG: 240, tempC: 90, grind: { grinderId: 'g1', setting: '22' }, totalSec: 170 } });
  const b2 = brew('bb', '2026-05-01T07:00:00Z', { memo: '少し粗くても良い' });
  const b3 = brew('bb', '2026-05-02T07:00:00Z');
  const b4 = brew('a', '2026-03-02T07:00:00Z', { actual: { doseG: 15, waterG: 240, tempC: 90, grind: { grinderId: 'g1', setting: '22' } }, planned: { name: 'アイス' }, context: { iced: true } });
  const tastings = [tasting(b1.id, 5, '甘い'), tasting(b2.id, 4, '花の香り'), tasting(b3.id, 5), tasting(b4.id, 5, 'アイスも良い')];
  const h = handoverFor({ bean: now, beans: [old1, old2, now], brews: [b1, b2, b3, b4], tastings });
  assert.equal(h.source, 'same');
  assert.equal(h.fromLabel, '前の袋（2袋）から');
  assert.equal(h.best.brewId, b3.id); // ★5 が2杯（b1・b3）なら新しい b3
  assert.equal(h.roastNote, '前の袋はフルシティでした（今回はシティ）');
  assert.deepEqual(h.memos.map((m) => m.text), ['花の香り / 少し粗くても良い', 'アイスも良い', '甘い']);
  assert.equal(conditionsText(h.best, 'ミル'), '15g・1:16・92℃・挽き目 24（ミル）・3分05秒');
  assert.equal(bestHead(h.best), '★5（5/2、焙煎10日）');
  assert.equal(handoverBrewHref(h, now), `brew.html?brew=${b3.id}&bean=ccc`);
});

test('同じ銘柄がなければ似た豆（点数の高い豆1つ）。似ていなければ null', () => {
  const now = bean('n', { name: 'エチオピア シダモ' });
  const near = bean('s1', { name: 'エチオピア グジ' }); // 焙煎度・精製・産地が同じ
  const far = bean('s2', { name: 'ブラジル', origin: { country: 'ブラジル' }, process: 'ナチュラル' });
  const dark = bean('s3', { name: 'マンデリン', roastLevel: 'イタリアン' });
  const b1 = brew('s1', '2026-04-01T07:00:00Z');
  const b2 = brew('s2', '2026-04-02T07:00:00Z');
  const b3 = brew('s3', '2026-04-03T07:00:00Z');
  const tastings = [tasting(b1.id, 4), tasting(b2.id, 5), tasting(b3.id, 5)];
  const h = handoverFor({ bean: now, beans: [now, near, far, dark], brews: [b1, b2, b3], tastings });
  assert.equal(h.source, 'similar');
  assert.equal(h.fromLabel, '似た豆「エチオピア グジ」から');
  assert.deepEqual(h.why, ['焙煎度が同じ', '精製が同じ', '産地が同じ']);
  assert.equal(h.best.brewId, b1.id);
  assert.equal(handoverFor({ bean: now, beans: [now, far, dark], brews: [b2, b3], tastings }), null);
});

test('★のない杯・消した杯・消した豆は使わない。一言だけの前の袋でも出す', () => {
  const old = bean('a', { handoverNote: '焙煎10日からが良い', handoverNoteAt: '2026-04-01T00:00:00Z' });
  const gone = bean('bb', { deletedAt: '2026-04-01T00:00:00Z' });
  const now = bean('ccc');
  const b1 = brew('a', '2026-03-01T07:00:00Z');
  const b2 = brew('a', '2026-03-02T07:00:00Z', { deletedAt: '2026-03-03T00:00:00Z' });
  const b3 = brew('bb', '2026-03-04T07:00:00Z');
  const tastings = [tasting(b2.id, 5, '消した杯'), tasting(b3.id, 5, '消した豆')];
  const h = handoverFor({ bean: now, beans: [old, gone, now], brews: [b1, b2, b3], tastings });
  assert.equal(h.best, null);
  assert.deepEqual(h.notes.map((n) => [n.text, n.ymd]), [['焙煎10日からが良い', '2026-04-01']]);
  assert.deepEqual(h.memos, []);
  assert.equal(handoverBrewHref(h, now), '');
  // 前の袋に何もなければ null
  assert.equal(handoverFor({ bean: now, beans: [bean('a'), now], brews: [b1], tastings: [] }), null);
  assert.equal(handoverFor({ bean: null }), null);
});

test('この袋の杯は前回に数えない。飲み頃の山はベストの袋の日誌から', () => {
  const old = bean('a');
  const now = bean('bb');
  const days = [4, 5, 9, 10, 12];
  const stars = [3, 3, 5, 5, 4];
  const brews = days.map((d, i) => brew('a', `2026-03-${String(10 + i).padStart(2, '0')}T07:00:00Z`, { derived: { ratio: 16, daysOffRoast: d } }));
  const tastings = brews.map((b, i) => tasting(b.id, stars[i]));
  const mine = brew('bb', '2026-06-01T07:00:00Z');
  const h = handoverFor({ bean: now, beans: [old, now], brews: [...brews, mine], tastings: [...tastings, tasting(mine.id, 1, 'この袋')] });
  assert.equal(h.cups, 5);
  assert.ok(h.peak, '山がある');
  assert.ok(h.peak.mean >= 4.5);
  assert.ok(!h.memos.some((m) => m.text === 'この袋'));
});

test('出すのは、この袋で淹れた杯が3杯より少なく、飲み切りでないあいだ', () => {
  const b = bean('a', { status: 'open' });
  const two = Array.from({ length: HANDOVER_SHOW_CUPS - 1 }, (_, i) => brew('a', `2026-01-0${i + 1}T00:00:00Z`));
  assert.equal(showHandover(b, two), true);
  assert.equal(showHandover(b, [...two, brew('a', '2026-01-09T00:00:00Z')]), false);
  assert.equal(showHandover(b, [...two, brew('a', '2026-01-09T00:00:00Z', { deletedAt: '2026-01-10T00:00:00Z' })]), true);
  assert.equal(showHandover({ ...b, status: 'finished' }, []), false);
});

test('一言：整えて保存し、豆の編集では消えない', async () => {
  assert.deepEqual(normalizeHandoverNote('  次は93℃で \r\n'), { value: '次は93℃で', error: '' });
  assert.ok(normalizeHandoverNote('あ'.repeat(HANDOVER_NOTE_MAX + 1)).error);
  const db = openDb('pourfolio-handover-test', { indexedDB: new IDBFactory(), IDBKeyRange });
  const NOW = new Date('2026-11-18T08:00:00Z');
  const b = await addBean(db, normalizeBeanInput({ name: 'ケニア', labelWeightG: '200', labelWeightBasis: 'green' }).value, NOW);
  await setHandoverNote(db, b.id, '粗めが合う', NOW);
  let found = await getBeanWithTx(db, b.id);
  assert.deepEqual([found.bean.handoverNote, found.bean.handoverNoteAt], ['粗めが合う', NOW.toISOString()]);
  await updateBean(db, b.id, normalizeBeanInput({ name: 'ケニア AA', labelWeightG: '200', labelWeightBasis: 'green' }).value, NOW);
  found = await getBeanWithTx(db, b.id);
  assert.equal(found.bean.handoverNote, '粗めが合う');
  await setHandoverNote(db, b.id, '', NOW);
  found = await getBeanWithTx(db, b.id);
  assert.deepEqual([found.bean.handoverNote, found.bean.handoverNoteAt], ['', null]);
});
