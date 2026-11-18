import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autosaveStatus, AUTOSAVE_FILE_NAME } from '../js/core/autosave.js';

test('使えないブラウザでは出さない', () => {
  assert.deepEqual(autosaveStatus({ supported: false }), { show: false, on: false, needsPermission: false, text: '' });
});

test('フォルダを選ぶ前・保存中・止まっている・許可がない・失敗', () => {
  assert.equal(autosaveStatus({ supported: true }).on, false);
  const lastAt = new Date(2026, 10, 18, 7, 42).toISOString();
  const ok = autosaveStatus({ supported: true, folderName: 'Pourfolio', permission: 'granted', lastAt });
  assert.equal(ok.on, true);
  assert.equal(ok.needsPermission, false);
  assert.match(ok.text, new RegExp(AUTOSAVE_FILE_NAME.replace('.', '\.')));
  assert.match(ok.text, /2026\/11\/18 07:42/);
  const paused = autosaveStatus({ supported: true, folderName: 'Pourfolio', permission: 'prompt', lastAt: null });
  assert.equal(paused.needsPermission, true);
  assert.equal(paused.on, true);
  assert.match(paused.text, /再開する/);
  const denied = autosaveStatus({ supported: true, folderName: 'Pourfolio', permission: 'denied' });
  assert.equal(denied.on, false);
  assert.match(denied.text, /選び直して/);
  assert.match(autosaveStatus({ supported: true, folderName: 'P', permission: 'granted', lastError: '書き込みに失敗' }).text, /保存できませんでした/);
});

test('記録が空（設定だけ・削除済みだけ）なら、フォルダのファイルを上書きしない（2-8 の18番）', async () => {
  const { hasRecordsToSave } = await import('../js/core/autosave.js');
  assert.equal(hasRecordsToSave({ beans: [], brews: [], settings: [{ id: 'app', deletedAt: null }] }), false);
  assert.equal(hasRecordsToSave({ beans: [{ id: 'b', deletedAt: '2026-11-18T00:00:00Z' }] }), false);
  assert.equal(hasRecordsToSave({ beans: [{ id: 'b', deletedAt: null }] }), true);
  assert.equal(hasRecordsToSave({}), false);
});
