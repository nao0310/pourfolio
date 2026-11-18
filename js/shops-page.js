// 焙煎所・店の台帳（C7）：店ごとの平均評価・買った回数・買った額・お気に入り
import { openDb, readAll, getSettings, updateSettings } from './db.js';
import { shopLedger, toggleFavorite } from './core/shops.js';
import { yen } from './core/cost.js';
import { formatYmdJa } from './core/format.js';
import { $, el, showMessage } from './ui.js';
import { registerServiceWorker } from './pwa.js';
import { serialQueue } from './core/once.js';

const db = openDb();
const alive = (r) => r && r.deletedAt == null;

function shopCard(s, favorites) {
  const facts = [
    ['買った', `${s.bags}袋・${s.purchases}回${s.lastBoughtYmd ? `（最後は${formatYmdJa(s.lastBoughtYmd, { withYear: true })}）` : ''}`],
    ['買った額', `${yen(s.spentJpy)}${s.unpricedBags ? `（価格未入力の${s.unpricedBags}袋を除く）` : ''}`],
    ['平均★', s.avgStars != null ? `★${s.avgStars}（${s.rated}杯）` : 'まだ評価なし'],
    ['1杯の平均', s.avgCostJpy != null ? yen(s.avgCostJpy) : '—'],
    ['★1つあたり', s.yenPerStar != null ? yen(s.yenPerStar) : '—'],
    ['よく買う豆', s.topBeans.map((b) => (b.bags > 1 ? `${b.name}（${b.bags}袋）` : b.name)).join('、')],
  ];
  const canFav = s.key !== '';
  return el(
    'section',
    { class: `card shop-card${s.favorite ? ' favorite' : ''}` },
    el(
      'div',
      { class: 'bean-card-top' },
      el('h2', {}, s.name),
      canFav &&
        el(
          'button',
          {
            type: 'button',
            class: 'fav-btn',
            'aria-pressed': s.favorite ? 'true' : 'false',
            'aria-label': s.favorite ? `${s.name}をお気に入りから外す` : `${s.name}をお気に入りにする`,
            // 押したときの設定を読み直してから、1つずつ順番に保存する。押した☆は終わるまで押せない
            //（続けて押すと、描いたときの古い値で上書きして1つ目が消えていた。総仕上げの64番）
            onclick: (event) => {
              const btn = event.currentTarget;
              if (btn.disabled) return;
              btn.disabled = true;
              favQueue
                .run(async () => {
                  const cur = await getSettings(db);
                  const list = Array.isArray(cur.favoriteShops) ? cur.favoriteShops : [];
                  const was = list.includes(s.key);
                  await updateSettings(db, { favoriteShops: toggleFavorite(list, s.key) });
                  showMessage(was ? `${s.name}をお気に入りから外しました` : `${s.name}をお気に入りにしました`);
                })
                .catch((err) => {
                  console.error(err);
                  showMessage('お気に入りを保存できませんでした。もう一度押してください', 'error');
                })
                .then(() => favQueue.idle())
                .then(() => render());
            },
          },
          s.favorite ? '★' : '☆',
        ),
    ),
    el('dl', { class: 'plan-numbers' }, ...facts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
  );
}

const favQueue = serialQueue();

async function render() {
  const [all, settings] = await Promise.all([readAll(db), getSettings(db)]);
  const favorites = Array.isArray(settings.favoriteShops) ? settings.favoriteShops : [];
  const rows = shopLedger({
    beans: all.beans.filter(alive),
    orders: all.orders.filter(alive),
    brews: all.brews.filter(alive),
    tastings: all.tastings,
    favorites,
  });
  if (!rows.length) {
    $('shops').replaceChildren(el('div', { class: 'card' }, el('p', { class: 'muted' }, '豆を登録すると、購入先ごとにここにまとまります。')));
    return;
  }
  $('shops').replaceChildren(...rows.map((s) => shopCard(s, favorites)));
}

registerServiceWorker();
render().catch((err) => {
  console.error(err);
  $('shops').replaceChildren(el('p', { class: 'error' }, '読み込めませんでした。開き直してください'));
});
