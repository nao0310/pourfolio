// QRを読む（X10・X14、D-143）：アプリの中でカメラを使って QR を読み、このアプリの画面ならそのまま開く
// 読み取りは同梱の jsQR（vendor/jsqr、classic script で self.jsQR に入る）。画像はどこにも送らない。
import { scanTarget } from './core/scan-target.js';
import { $, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';

const appBase = new URL('./', location.href).href;
let stream = null;
let raf = 0;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

function stop() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('video').srcObject = null;
  $('startBtn').hidden = false;
  $('stopBtn').hidden = true;
}

/** 読んだ文字の行き先へ。アプリの画面でなければ見せるだけ */
function go(text) {
  const t = scanTarget(text, appBase);
  if (t.kind === 'other') {
    $('resultCard').hidden = false;
    $('resultText').textContent = t.text;
    return false;
  }
  location.href = t.href;
  return true;
}

function tick() {
  const v = $('video');
  if (v.readyState >= 2 && v.videoWidth) {
    // 大きすぎる画像は縮めて読む（速さのため）
    const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found = self.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    if (found?.data) {
      stop();
      $('camState').textContent = '読み取りました';
      go(found.data);
      return;
    }
  }
  raf = requestAnimationFrame(tick);
}

async function start() {
  $('resultCard').hidden = true;
  $('camState').textContent = 'カメラを準備しています…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (err) {
    console.error(err);
    $('camState').textContent = 'カメラを使えませんでした。カメラの使用を許可するか、下の欄にリンクを貼り付けてください';
    return;
  }
  $('video').srcObject = stream;
  await $('video').play().catch(() => {});
  $('startBtn').hidden = true;
  $('stopBtn').hidden = false;
  $('camState').textContent = 'QRを枠の中に写してください';
  raf = requestAnimationFrame(tick);
}

const canUseCamera = Boolean(navigator.mediaDevices?.getUserMedia) && typeof self.jsQR === 'function';
if (canUseCamera) {
  $('camCard').hidden = false;
  $('camState').textContent = '「カメラで読む」を押すと、カメラの使用の許可を聞かれます';
  $('startBtn').addEventListener('click', () => start());
  $('stopBtn').addEventListener('click', () => {
    stop();
    $('camState').textContent = 'やめました';
  });
  // ほかの画面へ移るときや隠れたときはカメラを止める
  addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) {
      stop();
      $('camState').textContent = 'カメラを止めました。もう一度読むときは「カメラで読む」を押してください';
    }
  });
} else {
  $('noCam').hidden = false;
}

$('pasteBtn').addEventListener('click', () => {
  const text = $('pasteInput').value.trim();
  if (!text) {
    showMessage('リンクを貼り付けてください', 'error');
    return;
  }
  // share.html#r=… だけを貼った場合も開けるように、アプリの場所を補う
  const full = /^share\.html#/.test(text) ? new URL(text, appBase).href : text;
  if (!go(full)) showMessage('Pourfolioのリンクではないので開きません', 'error');
});

registerServiceWorker();
