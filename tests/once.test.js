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

test('保存の列：あとから頼んだ保存は、前の保存が終わってから走る。失敗しても次は走る（2-8 の11番）', async () => {
  const { serialQueue } = await import('../js/core/once.js');
  const q = serialQueue();
  const log = [];
  const job = (name, ms, fail = false) => () =>
    new Promise((res, rej) => setTimeout(() => (log.push(name), fail ? rej(new Error(name)) : res(name)), ms));
  const a = q.run(job('a', 20));
  const b = q.run(job('b', 1, true));
  const c = q.run(job('c', 1));
  await assert.rejects(b);
  assert.equal(await a, 'a');
  assert.equal(await c, 'c');
  await q.idle();
  assert.deepEqual(log, ['a', 'b', 'c']);
});
