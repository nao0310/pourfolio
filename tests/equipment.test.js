import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEquipmentInput,
  equipmentToFormValues,
  sortEquipment,
  groupEquipmentByKind,
  defaultEquipmentIds,
  equipmentSummary,
} from '../js/core/equipment.js';

test('種類と名前は必須', () => {
  const { errors } = normalizeEquipmentInput({ kind: '', name: ' ' });
  assert.ok(errors.kind);
  assert.ok(errors.name);
  assert.deepEqual(normalizeEquipmentInput({ kind: 'kettle', name: '細口ケトル' }).errors, {});
});

test('ドリッパーは形状・穴の数・素材を持つ', () => {
  const { value, errors } = normalizeEquipmentInput({ kind: 'dripper', name: 'V60 02', shape: 'cone', holes: '１', material: 'セラミック', isDefault: 'on' });
  assert.deepEqual(errors, {});
  assert.deepEqual(value.attrs, { shape: 'cone', holes: 1, material: 'セラミック' });
  assert.equal(value.isDefault, true);
  assert.equal(equipmentSummary(value), '円錐・1つ穴・セラミック');
  assert.ok(normalizeEquipmentInput({ kind: 'dripper', name: 'x', holes: '1.5' }).errors.holes);
});

test('フィルターの漂白は紙のときだけ残す', () => {
  assert.deepEqual(normalizeEquipmentInput({ kind: 'filter', name: 'a', filterMaterial: 'paper', bleach: 'unbleached' }).value.attrs, {
    material: 'paper',
    bleach: 'unbleached',
  });
  assert.equal(normalizeEquipmentInput({ kind: 'filter', name: 'a', filterMaterial: 'metal', bleach: 'unbleached' }).value.attrs.bleach, '');
});

test('グラインダーは刃・目盛りの刻み・ゼロ点を持つ', () => {
  const { value } = normalizeEquipmentInput({ kind: 'grinder', name: 'C40', burr: 'conical', step: '1', zeroPoint: '0' });
  assert.deepEqual(value.attrs, { burr: 'conical', step: 1, zeroPoint: '0' });
  assert.equal(equipmentSummary(value), 'コニカル・刻み1・ゼロ点0');
  assert.ok(normalizeEquipmentInput({ kind: 'grinder', name: 'x', step: '-1' }).errors.step);
});

test('保存した形 → フォーム → 保存した形 で値が変わらない', () => {
  for (const raw of [
    { kind: 'dripper', name: 'V60', shape: 'cone', holes: '1', material: '樹脂', isDefault: 'on', memo: 'm' },
    { kind: 'filter', name: 'F', filterMaterial: 'paper', bleach: 'bleached' },
    { kind: 'grinder', name: 'G', burr: 'flat', step: '0.5', zeroPoint: '2' },
  ]) {
    const { value } = normalizeEquipmentInput(raw);
    const form = equipmentToFormValues(value);
    const again = normalizeEquipmentInput({ ...form, isDefault: form.isDefault ? 'on' : '' }).value;
    assert.deepEqual(again, value);
  }
});

test('並び：種類の順、いつも使うが先。いつも使うがなくても1つだけならそれを初期値にする', () => {
  const e = (id, kind, extra = {}) => ({ id, kind, name: id, createdAt: `2026-11-1${id.length}T00:00:00Z`, ...extra });
  const list = [e('g', 'grinder'), e('d2', 'dripper'), e('d', 'dripper'), e('k', 'kettle'), e('d33', 'dripper', { isDefault: true })];
  assert.deepEqual(sortEquipment(list).map((x) => x.id), ['d33', 'd', 'd2', 'g', 'k']);
  assert.deepEqual(groupEquipmentByKind(list).filter, []);
  assert.deepEqual(defaultEquipmentIds(list), { dripperId: 'd33', filterId: null, grinderId: 'g', kettleId: 'k', scaleId: null });
  assert.equal(defaultEquipmentIds([e('a', 'dripper'), e('b', 'dripper')]).dripperId, null);
});
