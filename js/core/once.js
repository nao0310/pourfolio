// 押したボタンの処理が終わるまで、2回目を受け付けない（純粋な道具、2-8 の4番）
// 素早く2回押すと、同じ記録が2件できてしまうため。

/**
 * 処理中は呼んでも何もしない関数にする。処理が終わる（成功・失敗とも）と、また呼べる
 * @template {(...args: any[]) => Promise<any>} F
 * @param {F} fn
 * @returns {F & { busy: () => boolean }}
 */
export function singleFlight(fn) {
  let running = false;
  const wrapped = async (...args) => {
    if (running) return undefined;
    running = true;
    try {
      return await fn(...args);
    } finally {
      running = false;
    }
  };
  wrapped.busy = () => running;
  return wrapped;
}
