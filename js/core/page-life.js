// 画面に戻ってきたときに読み直すかを決める（純粋関数、総仕上げの54・59番、D-178）
// - 「戻る」で前の画面がそのまま出たとき（bfcache、pageshow の persisted）：消した記録や直す前の内容が見えるので、いつも読み直す
// - 開いたまま裏に回して、日の区切りを越えてから戻ったとき：日付で数える画面だけ読み直す
//   （ホーム・今日の1杯・分析は朝5時区切り、カレンダー・月次レポート・年間まとめは0時の区切り）
// どちらも、淹れている途中（タイマー）や入力の途中の画面は読み直さない（呼ぶ側の blocked）
import { coffeeDayStart } from './caffeine.js';
import { localYmd } from './format.js';

/** 日の区切りで読み直す画面（ファイル名） */
export const DAY_PAGES = Object.freeze(['index.html', 'today.html', 'analysis.html', 'calendar.html', 'report.html', 'wrapped.html', 'cost.html', 'life.html']);

/** 画面のファイル名（"/" は index.html） */
export function pageName(pathname) {
  const last = String(pathname ?? '').split('/').pop();
  return last === '' ? 'index.html' : last;
}

/** その時刻の「日の印」：朝5時区切りの日と、暦の日付 */
export function dayKey(now) {
  return `${localYmd(coffeeDayStart(now))}|${localYmd(now)}`;
}

/**
 * @param {{event:'pageshow'|'visible', persisted?:boolean, pathname:string, loadedKey:string, now:Date|number, blocked?:boolean}} p
 * @returns {boolean}
 */
export function shouldReload({ event, persisted = false, pathname, loadedKey, now, blocked = false }) {
  if (blocked) return false;
  if (event === 'pageshow') return persisted === true;
  if (event === 'visible') return DAY_PAGES.includes(pageName(pathname)) && dayKey(now) !== loadedKey;
  return false;
}
