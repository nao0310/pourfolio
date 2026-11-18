// エイジング日誌（X31）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agingOf, agingAll, standardWindow, AGING_MIN } from '../js/core/aging.js';
import { analysisRows } from '../js/core/analysis.js';
import { makeDemoData } from '../js/core/demo-data.js';

const bean = { id: 'b1', name: 'ケニア', roastLevel: 'ハイ' };
let n = 0;
function row(days, stars, { b = bean, frozen = false, tasting = undefined, iceG } = {}) {
  n += 1;
  const at = new Date(2026, 9, 1 + n, 7).toISOString();
  return {
    at,
    stars,
    bean: b,
    brew: { id: `w${n}`, at, derived: { daysOffRoast: days }, frozenPortionId: frozen ? 'p1' : null, memo: '', context: iceG ? { iceG } : {} },
    tasting: tasting ?? (stars == null ? null : { stars, tags: [], jar: {}, memo: '' }),
  };
}

test('焙煎度の目安の飲み頃', () => {
  assert.equal(standardWindow('ハイ').text, '3〜10日');
  assert.equal(standardWindow('シティ').text, '2〜8日');
  assert.equal(standardWindow('ライト').text, '5〜12日');
  assert.equal(standardWindow('').text, '3〜10日', 'わからなければ中煎り');
});

test('3杯から山。山は2杯以上の区切りで★の平均がいちばん高い所', () => {
  assert.equal(AGING_MIN, 3);
  const few = agingOf(bean, [row(2, 3), row(5, 4)]);
  assert.equal(few.ready, false);
  assert.equal(few.peak, null);
  assert.match(few.line, /あと1杯/);
  const a = agingOf(bean, [row(2, 3), row(3, 3), row(5, 4), row(6, 5), row(9, 5), row(25, 2)]);
  assert.equal(a.ready, true);
  assert.equal(a.peak.label, '4〜7日');
  assert.equal(a.peak.mean, 4.5);
  assert.match(a.line, /飲み頃の山は 4〜7日（平均★4.5・2杯）。焙煎度の目安（3〜10日）と重なっています/);
  // 1杯だけの 8〜11日（★5）は山にしない
  assert.equal(a.bins.find((b) => b.label === '8〜11日').n, 1);
});

test('山が目安とずれているとき・2杯の区切りがないとき', () => {
  const late = agingOf(bean, [row(20, 5), row(21, 5), row(3, 2), row(4, 2)]);
  assert.match(late.line, /16〜21日.*ずれています/);
  const spread = agingOf(bean, [row(1, 3), row(5, 4), row(9, 5)]);
  assert.equal(spread.peak, null);
  assert.match(spread.line, /2杯ある所がまだありません/);
});

test('日誌の並び：日数順、日数のない杯は入れない。★のない杯・冷凍・アイス・評価の言葉', () => {
  const a = agingOf(bean, [
    row(9, 4, { tasting: { stars: 4, tags: ['甘い'], jar: { acidity: 1, bitterness: 0 }, memo: '冷めると甘い' } }),
    row(3, null),
    row(null, 5),
    row(5, 3, { frozen: true, iceG: 80 }),
  ]);
  assert.deepEqual(a.entries.map((e) => e.days), [3, 5, 9]);
  assert.equal(a.rated, 2);
  assert.equal(a.entries[1].frozen, true);
  assert.equal(a.entries[1].iced, true);
  assert.deepEqual(a.entries[2].jar, ['酸味 やや強い']);
  assert.deepEqual(a.entries[2].tags, ['甘い']);
  assert.equal(a.entries[2].memo, '冷めると甘い');
});

test('全部の豆：山のある豆が先、削除した豆と杯のない豆は出さない', () => {
  const b2 = { id: 'b2', name: 'ブラジル', roastLevel: 'フルシティ' };
  const b3 = { id: 'b3', name: '消した豆', deletedAt: '2026-10-01' };
  const b4 = { id: 'b4', name: '杯なし' };
  const rows = [row(3, 4), row(4, 4), row(5, 4), row(2, 3, { b: b2 }), row(2, 3, { b: b3 })];
  const all = agingAll([b2, bean, b3, b4], rows);
  assert.deepEqual(all.map((a) => a.bean.id), ['b1', 'b2']);
});

test('デモデータ：山のある豆がある', () => {
  const d = makeDemoData();
  const all = agingAll(d.beans, analysisRows(d));
  assert.ok(all.length >= 5);
  assert.ok(all.some((a) => a.peak));
});
