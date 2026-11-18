// 画面スリープ防止（A3）：Screen Wake Lock API
// 別のアプリを開くと自動で外れるので、画面に戻ったら掛け直す。
// 使えない端末（iPhoneのホーム画面アプリは iOS 18.4 より前）では、自動ロックを延ばすよう画面で案内する。

export const canWakeLock = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/**
 * @param {(state:'on'|'off'|'unsupported'|'failed') => void} onState 状態が変わったら呼ぶ
 */
export function createWakeLock(onState = () => {}) {
  let sentinel = null;
  let wanted = false;
  let pending = false;

  async function acquire() {
    if (!canWakeLock) {
      onState('unsupported');
      return;
    }
    if (sentinel || pending || document.visibilityState !== 'visible') return;
    pending = true;
    try {
      const s = await navigator.wakeLock.request('screen');
      // 取れるのを待っている間に「やめる」が押されていたら、すぐ外す（外れないまま残らないように。2-8 の16番）
      if (!wanted) {
        await s.release().catch(() => {});
        return;
      }
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
        if (wanted) onState('off');
      });
      onState('on');
    } catch (err) {
      console.warn('画面スリープ防止を使えませんでした', err);
      onState('failed');
    } finally {
      pending = false;
    }
  }

  const onVisible = () => {
    if (wanted && document.visibilityState === 'visible') acquire();
  };
  document.addEventListener('visibilitychange', onVisible);

  return {
    /** 画面を消さないようにする */
    async start() {
      wanted = true;
      await acquire();
    },
    /** 元に戻す */
    async stop() {
      wanted = false;
      const s = sentinel;
      sentinel = null;
      if (s) await s.release().catch(() => {});
    },
  };
}
