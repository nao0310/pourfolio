// キーボードが出たときに入力中の欄を見せる計算（js/core/keyboard.js、3.6.3、D-185）
// ユーザーの報告「ページの下側の入力をしようとすると、キーボードで入力したい欄が隠れて見えなくなる」の再発を防ぐ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTypingTarget, keyboardInset, revealDelta, visibleArea, opensKeyboard, guessKeyboardInset } from '../js/core/keyboard.js';

test('キーボードが出る欄だけを入力中として扱う', () => {
  for (const type of ['', 'text', 'number', 'url', 'date', 'time', 'search', 'TEXT']) assert.equal(isTypingTarget({ tag: 'INPUT', type }), true, type);
  for (const type of ['button', 'submit', 'checkbox', 'radio', 'range', 'file', 'hidden']) assert.equal(isTypingTarget({ tag: 'input', type }), false, type);
  assert.equal(isTypingTarget({ tag: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tag: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tag: 'BUTTON' }), false);
  assert.equal(isTypingTarget({ tag: 'DIV', editable: true }), true);
  assert.equal(isTypingTarget({ tag: 'A' }), false);
  assert.equal(isTypingTarget(), false);
});

test('キーボードの高さ：画面の高さから見える範囲を引く', () => {
  // iPhone 13：画面 664px、キーボード 336px
  assert.equal(keyboardInset({ innerHeight: 664, vvHeight: 328 }), 336);
  // Safari がページをずらしているとき（見える範囲が下へ動く）
  assert.equal(keyboardInset({ innerHeight: 664, vvHeight: 328, vvOffsetTop: 100 }), 236);
  assert.equal(keyboardInset({ innerHeight: 664, vvHeight: 664 }), 0);
  assert.equal(keyboardInset({ innerHeight: 664, vvHeight: 700 }), 0);
  // 2本指で拡大しているときは数えない
  assert.equal(keyboardInset({ innerHeight: 664, vvHeight: 300, scale: 2 }), 0);
  assert.equal(keyboardInset({ innerHeight: 664, vvHeight: undefined }), 0);
});

test('欄がキーボードに隠れていれば、その分だけ中身を下へ動かす', () => {
  const vis = { top: 0, bottom: 328 };
  assert.equal(revealDelta({ top: 604, bottom: 656 }, vis), 656 + 12 - 328);
  // 見えていれば動かさない
  assert.equal(revealDelta({ top: 100, bottom: 152 }, vis), 0);
  // 上に隠れていれば上へ
  assert.equal(revealDelta({ top: -100, bottom: -48 }, vis), -112);
  // 見える範囲より高い欄（大きなメモ欄）は、上の端を見せる
  assert.equal(revealDelta({ top: 500, bottom: 900 }, vis), 488);
  // 見える範囲がない
  assert.equal(revealDelta({ top: 500, bottom: 550 }, { top: 300, bottom: 300 }), 0);
});

test('余白が取れないほど狭いときも、欄は見える範囲に収まる', () => {
  const vis = { top: 0, bottom: 60 };
  const d = revealDelta({ top: 200, bottom: 250 }, vis);
  assert.ok(200 - d >= 0 && 250 - d <= 60, String(d));
});

test('見える範囲：キーボード・中身の箱・下に付けるボタンのいちばん上が下の端', () => {
  assert.deepEqual(visibleArea({ vvTop: 0, vvBottom: 328, boxTop: 0, boxBottom: 606 }), { top: 0, bottom: 328 });
  // キーボードがなく、下に付けるボタンが見えている（PC など）
  assert.deepEqual(visibleArea({ vvTop: 0, vvBottom: 664, boxTop: 0, boxBottom: 606, barTop: 530 }), { top: 0, bottom: 530 });
  // ボタンがキーボードの裏にあるときは、キーボードの上の端
  assert.deepEqual(visibleArea({ vvTop: 0, vvBottom: 328, boxTop: 0, boxBottom: 606, barTop: 530 }), { top: 0, bottom: 328 });
  // Safari がページをずらしているとき
  assert.deepEqual(visibleArea({ vvTop: 120, vvBottom: 448, boxTop: 0, boxBottom: 606 }), { top: 120, bottom: 448 });
});

test('読むだけの欄（AI相談の文など）は入力中として扱わない', () => {
  assert.equal(isTypingTarget({ tag: 'TEXTAREA', readOnly: true }), false);
  assert.equal(isTypingTarget({ tag: 'INPUT', type: 'text', readOnly: true }), false);
});

// 3.6.4（D-186）：ホーム画面のアプリでは、iPhone がキーボードの高さを伝えないことがある（ユーザーの画面写真）
test('文字盤が出る欄だけを、見込みで動かす対象にする', () => {
  for (const type of ['', 'text', 'number', 'url', 'search', 'email', 'tel']) assert.equal(opensKeyboard({ tag: 'INPUT', type }), true, type);
  assert.equal(opensKeyboard({ tag: 'TEXTAREA' }), true);
  assert.equal(opensKeyboard({ tag: 'DIV', editable: true }), true);
  // 欄の近くに部品が出るだけの欄は動かさない
  assert.equal(opensKeyboard({ tag: 'SELECT' }), false);
  for (const type of ['date', 'time', 'datetime-local', 'month', 'week', 'DATE']) assert.equal(opensKeyboard({ tag: 'INPUT', type }), false, type);
  assert.equal(opensKeyboard({ tag: 'INPUT', type: 'checkbox' }), false);
  assert.equal(opensKeyboard({ tag: 'TEXTAREA', readOnly: true }), false);
  assert.equal(opensKeyboard({ tag: 'BUTTON' }), false);
});

test('キーボードの高さの見込み：縦は画面の半分、横は65%', () => {
  assert.equal(guessKeyboardInset({ innerHeight: 800, innerWidth: 390 }), 400);
  assert.equal(guessKeyboardInset({ innerHeight: 390, innerWidth: 844 }), 254);
  assert.equal(guessKeyboardInset({ innerHeight: 0, innerWidth: 390 }), 0);
  // ユーザーの画面写真（キーボードと上の帯で画面の45%）より大きく見込む
  assert.ok(guessKeyboardInset({ innerHeight: 874, innerWidth: 402 }) >= 874 * 0.45);
});

test('見込みのときも、画面の下の端の欄は上半分まで動く', () => {
  const H = 800;
  const inset = guessKeyboardInset({ innerHeight: H, innerWidth: 390 });
  const vis = visibleArea({ vvTop: 0, vvBottom: H - inset, boxTop: 0, boxBottom: H });
  const d = revealDelta({ top: 700, bottom: 752 }, vis);
  assert.ok(752 - d <= H * 0.55 - 12, String(d));
});
