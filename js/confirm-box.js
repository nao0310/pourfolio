// アプリの中の確認の箱（2-8の33番）。iPhone の標準の確認（上にサイトの名前が出る）の代わりに使う。
// <dialog> が使えないブラウザでは、今までどおり標準の確認を出す。

/**
 * 確認の箱を出し、「はい」側を押したら true
 * @param {string} message 確認の文（「〜しますか？」）
 * @param {{ok?:string, cancel?:string, danger?:boolean}} [opts] ok は押すと進むボタンの名前（「削除する」など）。
 *   danger なら赤い枠のボタンにする（削除・やめるなど元に戻せない操作）
 * @returns {Promise<boolean>}
 */
export function askConfirm(message, { ok = 'はい', cancel = 'いいえ', danger = false } = {}) {
  const Dialog = globalThis.HTMLDialogElement;
  if (!Dialog || typeof Dialog.prototype.showModal !== 'function') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    const box = document.createElement('dialog');
    box.className = 'confirm-box';
    const text = document.createElement('p');
    text.className = 'confirm-text';
    text.textContent = message;
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn secondary';
    no.textContent = cancel;
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = danger ? 'btn danger' : 'btn';
    yes.textContent = ok;
    const row = document.createElement('div');
    row.className = 'confirm-actions';
    row.append(no, yes);
    box.append(text, row);
    no.addEventListener('click', () => box.close('no'));
    yes.addEventListener('click', () => box.close('yes'));
    // 箱の外（暗い所）を押したら「いいえ」
    box.addEventListener('click', (e) => {
      if (e.target === box) box.close('no');
    });
    box.addEventListener(
      'close',
      () => {
        box.remove();
        resolve(box.returnValue === 'yes');
      },
      { once: true },
    );
    document.body.append(box);
    box.showModal();
    no.focus(); // 間違えて Enter を押しても進まないよう、「いいえ」を選んでおく
  });
}
