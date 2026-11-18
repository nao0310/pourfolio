import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  APP_VERSION,
  CHANGELOG,
  parseVersion,
  compareVersions,
  versionLabel,
  stepToVersion,
  latestDoneStep,
  whatsNew,
} from '../js/core/version.js';

test('番号の読み取りと比べ方', () => {
  assert.deepEqual(parseVersion('2.1'), [2, 1]);
  assert.deepEqual(parseVersion('2.1.3'), [2, 1, 3]);
  for (const bad of ['2', 'v2.1', '2.1.', '2.1.1.1', '', null, undefined]) assert.equal(parseVersion(bad), null, String(bad));
  assert.ok(compareVersions('2.2', '2.1') > 0);
  assert.ok(compareVersions('2.10', '2.9') > 0, '数として比べる');
  assert.ok(compareVersions('2.1.1', '2.1') > 0);
  assert.equal(compareVersions('2.1', '2.1.0'), 0);
  assert.ok(compareVersions('1.7', '2.1') < 0);
  assert.equal(versionLabel('2.2'), 'Ver 2.2');
});

test('ROADMAPのステップ番号から番号を作る', () => {
  assert.equal(stepToVersion('2-1'), '2.1');
  assert.equal(stepToVersion('0-2'), '0.2');
  assert.equal(stepToVersion('2-1b'), null);
  const md = '- [x] 1-6 ダイヤルイン\n- [ ] 1-7 ホーム\n- [x] 2-1 強化\n- [ ] 2-2 問屋\n  - [x] 9-9 字下げは数えない\n';
  assert.equal(latestDoneStep(md), '2.1');
  assert.equal(latestDoneStep('なし'), null);
});

test('今の番号が、ROADMAPでチェックの付いた最後のステップと合っている（ステップを仕上げたら APP_VERSION と更新履歴を足す）', async () => {
  const roadmap = await readFile(new URL('../docs/ROADMAP.md', import.meta.url), 'utf8');
  const done = latestDoneStep(roadmap);
  const [a, b] = parseVersion(APP_VERSION);
  assert.equal(`${a}.${b}`, done, `ROADMAPは ${done} まで済み、APP_VERSION は ${APP_VERSION}`);
});

test('更新履歴：新しい順で、先頭が今の番号。どの版にも変更点が1〜3個', () => {
  assert.equal(CHANGELOG[0].version, APP_VERSION);
  for (let i = 1; i < CHANGELOG.length; i += 1) {
    assert.ok(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version) > 0, `${CHANGELOG[i - 1].version} → ${CHANGELOG[i].version}`);
  }
  for (const e of CHANGELOG) {
    assert.ok(parseVersion(e.version), e.version);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.items.length >= 1 && e.items.length <= 3, e.version);
  }
});

const LOG = [
  { version: '2.3', items: ['c1'] },
  { version: '2.2.1', items: ['b2'] },
  { version: '2.2', items: ['b1', 'b1x'] },
  { version: '2.1', items: ['a1'] },
];

test('更新後の表示：前に見た番号より新しい版の変更点だけ', () => {
  assert.deepEqual(whatsNew({ lastSeen: '2.1', current: '2.3', changelog: LOG }), { show: true, version: '2.3', items: ['c1', 'b2', 'b1', 'b1x'] });
  assert.deepEqual(whatsNew({ lastSeen: '2.2', current: '2.2.1', changelog: LOG }).items, ['b2']);
  assert.equal(whatsNew({ lastSeen: '2.3', current: '2.3', changelog: LOG }).show, false, '同じ番号なら出さない（1回だけ）');
  assert.equal(whatsNew({ lastSeen: '2.4', current: '2.3', changelog: LOG }).show, false, '古い版に戻ったときも出さない');
});

test('更新後の表示：前に見た番号がないとき', () => {
  assert.equal(whatsNew({ lastSeen: null, hasRecords: false, current: '2.2', changelog: LOG }).show, false, '初めて使う人には出さない');
  assert.deepEqual(whatsNew({ lastSeen: null, hasRecords: true, current: '2.2', changelog: LOG }).items, ['b1', 'b1x'], '記録があれば2.1から上げたとみなす');
  assert.equal(whatsNew({ lastSeen: 'こわれた値', hasRecords: false, current: '2.2', changelog: LOG }).show, false);
});
