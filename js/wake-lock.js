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

  async function acquire() {
    if (!canWakeLock) {
      onState('unsupported');
      return;
    }
    if (sentinel || document.visibilityState !== 'visible') return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
        if (wanted) onState('off');
      });
      onState('on');
    } catch (err) {
      console.warn('画面スリープ防止を使えませんでした', err);
      onState('failed');
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
