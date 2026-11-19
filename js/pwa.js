// ホーム画面アプリ（PWA）まわりの共通処理：service worker の登録、新しい版の知らせ（G3）、消されにくい保存
import { watchPageLife } from './page-life.js';
import { checkStorage } from './storage-check.js';

/** ホーム画面から開いているか */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

/** 新しい版の確認の間隔（アプリに戻ってきたときに確かめる） */
const UPDATE_CHECK_MS = 10 * 60 * 1000;

let registration = null;
let blocker = () => false;
let reloading = false;

/**
 * 新しい版の知らせを出さない間の条件を決める（抽出のタイマー中など）
 * @param {() => boolean} isBlocked
 */
export function blockUpdatePrompt(isBlocked) {
  blocker = isBlocked;
}

/** 知らせを出し直す：止める条件に当たれば隠し、外れていて新しい版が待っていれば出す */
export function recheckUpdatePrompt() {
  if (blocker()) {
    document.getElementById('updateBar')?.remove();
    return;
  }
  if (registration?.waiting && navigator.serviceWorker.controller) showUpdatePrompt(registration.waiting);
}

function showUpdatePrompt(worker) {
  if (blocker() || document.getElementById('updateBar')) return;
  const bar = document.createElement('div');
  bar.id = 'updateBar';
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = '新しい版があります';
  // 待っている新しい版に番号を聞いて「新しい版（Ver 2.3）があります」にする
  askStatus(worker).then((st) => {
    if (st?.label) text.textContent = `新しい版（Ver ${st.label}）があります`;
  });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = '更新する';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = '更新中…';
    reloading = true;
    worker.postMessage({ type: 'skipWaiting' });
  });
  bar.append(text, btn);
  const main = document.querySelector('main');
  if (main) main.prepend(bar);
  else document.body.prepend(bar);
}

function watchInstalling(worker) {
  worker.addEventListener('statechange', () => {
    // 前の版が画面を受け持っているときだけ知らせる（初めて保存するときは、そのまま切り替わる）
    if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt(worker);
  });
}

/** service worker を登録し、新しい版が準備できたら知らせる（使えない環境では何もしない） */
export async function registerServiceWorker() {
  watchPageLife(); // 「戻る」や日の区切りのあとに戻ったときの読み直し（全画面で呼ばれるのでここで）
  checkStorage(); // 記録の保存場所が使えなければ、画面の上に原因を出す
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    registration = reg;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) window.location.reload();
    });
    if (reg.installing) watchInstalling(reg.installing);
    reg.addEventListener('updatefound', () => reg.installing && watchInstalling(reg.installing));
    recheckUpdatePrompt();
    // ホーム画面のアプリは開いたまま裏に回ることが多いので、戻ってきたときにも新しい版を確かめる
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = Date.now();
      reg.update().catch(() => {});
    });
    return true;
  } catch (err) {
    console.warn('service worker の登録に失敗しました', err);
    return false;
  }
}

/** service worker に状況（版・番号・準備済みか）を聞く。答えがなければ null */
function askStatus(worker) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data);
    };
    worker.postMessage({ type: 'status' }, [ch.port2]);
  });
}

/**
 * オフラインの準備の状況
 * @returns {Promise<{supported:boolean, version:string|null, ready:boolean, updateWaiting:boolean, waitingLabel?:string|null}>}
 */
export async function getOfflineStatus() {
  if (!('serviceWorker' in navigator)) return { supported: false, version: null, ready: false, updateWaiting: false };
  const reg = await navigator.serviceWorker.getRegistration('./');
  const updateWaiting = Boolean(reg?.waiting && navigator.serviceWorker.controller);
  const worker = navigator.serviceWorker.controller ?? reg?.active;
  if (!worker) return { supported: true, version: null, ready: false, updateWaiting };
  const answer = await askStatus(worker);
  const waiting = updateWaiting ? await askStatus(reg.waiting) : null;
  return {
    supported: true,
    version: answer?.version ?? null,
    ready: Boolean(answer?.ready),
    updateWaiting,
    waitingLabel: waiting?.label ?? null,
  };
}

/** 「消されにくい保存」を要求し、結果を返す（true / false / null=非対応） */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
