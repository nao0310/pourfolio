// 抽出の合図：音（Web Audio）・読み上げ（speechSynthesis）・振動（Vibration API）
// どれも使えるかを確かめてから使う。iPhoneのSafariは振動に対応していないので、振動は何もしない。
// iPhoneでは音と読み上げは「ボタンを押した時」に1回鳴らしておかないと、その後も鳴らないことがある。
// そのため unlock() をスタートボタンの押下の中で呼ぶ。

const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;

export const canBeep = Boolean(AudioCtx);
export const canSpeak = 'speechSynthesis' in globalThis && 'SpeechSynthesisUtterance' in globalThis;
export const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let ctx = null;
let jaVoice = null;

function pickVoice() {
  if (!canSpeak) return;
  const voices = speechSynthesis.getVoices();
  jaVoice = voices.find((v) => v.lang === 'ja-JP' && v.localService) ?? voices.find((v) => v.lang?.startsWith('ja')) ?? null;
}
if (canSpeak) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

/** スタートを押したときに呼ぶ（音と読み上げを使える状態にする） */
export function unlock() {
  if (canBeep) {
    ctx ??= new AudioCtx();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    // 無音を一瞬鳴らしておく（iPhoneで後の音が鳴るように）
    tone(0, 0.01, 0);
  }
}

/** 画面に戻ったときに音を使える状態に戻す */
export function resume() {
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
}

function tone(freq, durSec, gain = 0.25, delaySec = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq || 440;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.setValueAtTime(gain, t + Math.max(0.01, durSec - 0.03));
  g.gain.linearRampToValueAtTime(0, t + durSec);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + durSec + 0.02);
}

/** 読み上げる（前の読み上げは止める） */
export function speak(text) {
  if (!canSpeak || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  if (jaVoice) u.voice = jaVoice;
  u.rate = 1.1;
  speechSynthesis.speak(u);
}

/** 読み上げを止める */
export function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
}

function vibrate(pattern) {
  if (canVibrate) navigator.vibrate(pattern);
}

/**
 * 合図を1つ鳴らす（js/core/timer.js の cueSchedule の1件）
 * @param {{kind:'count'|'go'|'target', speech?:string}} cue
 * @param {{speech:boolean}} opts 読み上げるか
 */
export function playCue(cue, { speech }) {
  if (cue.kind === 'count') {
    tone(880, 0.08);
    return;
  }
  if (cue.kind === 'go') {
    tone(1320, 0.35);
    vibrate(200);
  } else if (cue.kind === 'target') {
    tone(990, 0.15);
    tone(990, 0.15, 0.25, 0.22);
    vibrate([100, 80, 100]);
  }
  // 音と重ならないよう少し遅らせて読み上げる
  if (speech && cue.speech) setTimeout(() => speak(cue.speech), 350);
}
