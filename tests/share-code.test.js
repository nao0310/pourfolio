import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sharePayload,
  encodeShare,
  decodeShare,
  shareUrl,
  codeFromHash,
  recipeInputFromShare,
  beanLine,
  toBase64Url,
  fromBase64Url,
  QR_MAX_CHARS,
} from '../js/core/share-code.js';
import { normalizeRecipeInput, make46 } from '../js/core/recipes.js';

function recipe() {
  const made = make46({ doseG: 20, ratio: 15 });
  const { value } = normalizeRecipeInput({
    name: '朝の4:6',
    doseG: 20,
    waterG: made.waterG,
    tempC: 92,
    grinderId: 'g-1',
    grindSetting: '24',
    dripperId: 'd-1',
    pours: made.pours,
    targetTotalSec: made.targetTotalSec,
    template: { kind: '46', ratio: 15, taste: 'sweet', strength: 'standard' },
    favorite: true,
    memo: '自分だけのメモ',
  });
  return { id: 'r-1', ...value };
}
const bean = {
  id: 'b-1',
  name: 'ケニア ニエリ',
  shop: '珈琲問屋',
  productUrl: 'https://example.com/item/1',
  origin: { country: 'ケニア', region: 'ニエリ', farm: '' },
  process: 'ウォッシュト',
  roastLevel: 'シティ',
  priceJpy: 1500,
  roastDate: '2026-11-10',
  memo: '家族用',
};

test('圧縮して戻すと中身が同じ', async () => {
  const p = sharePayload({ recipe: recipe(), bean, grinderName: 'C40' });
  const code = await encodeShare(p);
  assert.match(code, /^1\.[A-Za-z0-9_-]+$/);
  const back = await decodeShare(code);
  assert.equal(back.ok, true);
  assert.deepEqual(back.payload, p);
});

test('圧縮できない端末の形（0.）も読める', async () => {
  const p = sharePayload({ recipe: recipe() });
  const code = await encodeShare(p, { compress: false });
  assert.match(code, /^0\./);
  assert.deepEqual((await decodeShare(code)).payload, p);
});

test('メモ・価格・日付・器具のID・お気に入りを入れない', () => {
  const p = sharePayload({ recipe: recipe(), bean });
  const s = JSON.stringify(p);
  for (const word of ['自分だけのメモ', '家族用', '1500', '2026-11-10', 'g-1', 'd-1', 'favorite']) assert.ok(!s.includes(word), word);
  assert.equal(p.recipe.grindSetting, '24');
});

test('壊れた・別のアプリ・新しすぎる共有を弾く', async () => {
  assert.equal((await decodeShare('')).ok, false);
  assert.equal((await decodeShare('1.abc!')).ok, false);
  assert.equal((await decodeShare('1.AAAA')).ok, false);
  const other = await encodeShare({ app: 'other', recipe: {} });
  assert.match((await decodeShare(other)).error, /Pourfolio/);
  const future = await encodeShare({ app: 'pourfolio', v: 99, recipe: {} });
  assert.match((await decodeShare(future)).error, /更新/);
  // 途中で切れたリンク
  const code = await encodeShare(sharePayload({ recipe: recipe(), bean }));
  assert.equal((await decodeShare(code.slice(0, code.length - 10))).ok, false);
});

test('リンクはQRに入る長さに収まる', async () => {
  const code = await encodeShare(sharePayload({ recipe: recipe(), bean, grinderName: 'コマンダンテ C40 MK4', dripperName: 'ハリオ V60 02' }));
  const url = shareUrl('https://nao0310.github.io/pourfolio/', code);
  assert.ok(url.length < QR_MAX_CHARS, `${url.length}文字`);
  assert.equal(codeFromHash(new URL(url).hash), code);
  assert.ok(url.startsWith('https://nao0310.github.io/pourfolio/share.html#r=1.'));
});

test('取り込むレシピ：注湯・雛形はそのまま、器具は選ばず、豆はメモに', async () => {
  const r = recipe();
  const back = await decodeShare(await encodeShare(sharePayload({ recipe: r, bean, grinderName: 'C40' })));
  const { value, errors } = recipeInputFromShare(back.payload);
  assert.deepEqual(errors, {});
  assert.equal(value.name, '朝の4:6');
  assert.deepEqual(value.pours, r.pours);
  assert.equal(value.waterG, r.waterG);
  assert.deepEqual(value.template, r.template);
  assert.equal(value.grind.grinderId, null);
  assert.equal(value.grind.setting, '24');
  assert.equal(value.equipment.dripperId, null);
  assert.equal(value.favorite, false);
  // メモは保存のときに全角の記号が半角になる（NFKC）
  assert.match(value.memo, /挽き目:C40 24/);
  assert.match(value.memo, /豆:ケニア ニエリ\(ケニア ニエリ・ウォッシュト・シティ\)\/珈琲問屋/);
});

test('おかしな注湯はエラーとして返す', () => {
  const { errors } = recipeInputFromShare({ app: 'pourfolio', v: 1, recipe: { name: 'x', doseG: 20, waterG: 300, pours: [{ atSec: 0, toG: 50 }, { atSec: 0, toG: 300 }] } });
  assert.ok(errors.pours);
});

test('base64url の行き来と豆の1行', () => {
  const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  assert.equal(beanLine({ name: 'A', roastLevel: 'ふつう' }), 'A');
  assert.equal(beanLine(null), '');
});
