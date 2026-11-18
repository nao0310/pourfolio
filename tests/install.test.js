import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIos, installAdvice } from '../js/core/install.js';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
};

test('iPhone・iPad を見分ける（Mac と同じ名乗りの iPad はタッチの点数で）', () => {
  assert.equal(isIos({ userAgent: UA.iphoneSafari, maxTouchPoints: 5 }), true);
  assert.equal(isIos({ userAgent: UA.iphoneChrome, maxTouchPoints: 5 }), true);
  assert.equal(isIos({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 }), true);
  assert.equal(isIos({ userAgent: UA.macSafari, maxTouchPoints: 0 }), false);
  assert.equal(isIos({ userAgent: UA.winChrome, maxTouchPoints: 0 }), false);
  assert.equal(isIos({ userAgent: UA.android, maxTouchPoints: 5 }), false);
  assert.equal(isIos({}), false);
});

test('iPhone のブラウザで開いたときだけ目立つ警告', () => {
  assert.equal(installAdvice({ userAgent: UA.iphoneSafari, maxTouchPoints: 5, standalone: false }), 'ios-browser');
  assert.equal(installAdvice({ userAgent: UA.iphoneChrome, maxTouchPoints: 5, standalone: false }), 'ios-browser');
  assert.equal(installAdvice({ userAgent: UA.ipadDesktop, maxTouchPoints: 5, standalone: false }), 'ios-browser');
});

test('ホーム画面のアプリなら何も出さない', () => {
  assert.equal(installAdvice({ userAgent: UA.iphoneSafari, maxTouchPoints: 5, standalone: true }), 'installed');
  assert.equal(installAdvice({ userAgent: UA.winEdge, maxTouchPoints: 0, standalone: true }), 'installed');
});

test('PC・Android のブラウザは小さい一文だけ', () => {
  for (const ua of [UA.winChrome, UA.winEdge, UA.macSafari, UA.android]) {
    assert.equal(installAdvice({ userAgent: ua, maxTouchPoints: ua === UA.android ? 5 : 0, standalone: false }), 'other-browser');
  }
});
