// 2度押しで同じ処理が2回走らないこと（2-8 の4番）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from '../js/core/once.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

test('処理中に2回目を呼んでも走らない。終わればまた呼べる', async () => {
  let n = 0;
  const save = singleFlight(async () => {
    n++;
    await tick();
    return n;
  });
  const [a, b] = await Promise.all([save(), save()]);
  assert.equal(n, 1);
  assert.equal(a, 1);
  assert.equal(b, undefined);
  assert.equal(await save(), 2);
});

test('失敗しても、また呼べるようになる', async () => {
  let n = 0;
  const save = singleFlight(async () => {
    n++;
    await tick();
    throw new Error('x');
  });
  await assert.rejects(save());
  assert.equal(save.busy(), false);
  await assert.rejects(save());
  assert.equal(n, 2);
});
