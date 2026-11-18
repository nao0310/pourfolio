// 画面スリープ防止（A3）：取れるのを待っている間に「やめる」と、外れないまま残らないこと（2-8 の16番）
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ブラウザの代わり（Wake Lock は少し遅れて取れる）
let held = 0;
globalThis.document = { visibilityState: 'visible', addEventListener() {} };
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    wakeLock: {
      request: () =>
        new Promise((res) =>
          setTimeout(() => {
            held++;
            let released = false;
            res({
              addEventListener() {},
              release: async () => {
                if (!released) {
                  released = true;
                  held--;
                }
              },
            });
          }, 10),
        ),
    },
  },
});
const { createWakeLock } = await import('../js/wake-lock.js');

test('取れる前に止めても、取れたあとすぐ外れる', async () => {
  held = 0;
  const states = [];
  const w = createWakeLock((s) => states.push(s));
  const started = w.start();
  await w.stop();
  await started;
  assert.equal(held, 0);
  assert.deepEqual(states, []);
});

test('ふつうに始めて止めると外れる。2回続けて始めても1つだけ取る', async () => {
  held = 0;
  const w = createWakeLock();
  await Promise.all([w.start(), w.start()]);
  assert.equal(held, 1);
  await w.stop();
  assert.equal(held, 0);
});
