// 器具のお手入れ（D4）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  maintenanceOf,
  maintenanceStatus,
  dueMaintenance,
  maintenanceLine,
  markDone,
  snooze,
  normalizeMaintenanceInput,
  mergeMaintenance,
  maintenanceToFormValues,
  brewUsesEquipment,
  LOG_MAX,
} from '../js/core/maintenance.js';
import { openDb, addEquipment, getEquipment, markMaintenanceDone, snoozeMaintenance, updateEquipment, exportAll, clearAll, restoreBackup } from '../js/db.js';
import { parseBackup } from '../js/core/backup.js';

const NOW = new Date('2026-11-18T08:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const grinder = (extra = {}) => ({ id: 'g1', kind: 'grinder', name: 'ミル', createdAt: daysAgo(10), deletedAt: null, ...extra });
const kettle = (extra = {}) => ({ id: 'k1', kind: 'kettle', name: 'ケトル', createdAt: daysAgo(10), deletedAt: null, ...extra });
const brewAt = (d, extra = {}) => ({ id: `b${d}${Math.random()}`, at: daysAgo(d), deletedAt: null, equipment: { grinderId: 'g1', kettleId: 'k1' }, ...extra });

test('設定のない器具（3-5 より前）は種類ごとの初期値で読む。お手入れのない種類は null', () => {
  assert.deepEqual(
    (({ label, enabled, everyDays, everyCups, lastDoneAt }) => ({ label, enabled, everyDays, everyCups, lastDoneAt }))(maintenanceOf(grinder())),
    { label: '刃の掃除', enabled: true, everyDays: 30, everyCups: 50, lastDoneAt: null },
  );
  assert.equal(maintenanceOf(kettle()).everyCups, null);
  assert.equal(maintenanceOf({ kind: 'dripper' }), null);
  assert.equal(maintenanceStatus({ kind: 'water', id: 'w' }, [], NOW), null);
  // 杯数だけにした（日数を空にした）設定は、空のまま読む
  assert.equal(maintenanceOf(grinder({ maintenance: { everyDays: null, everyCups: 20 } })).everyDays, null);
});

test('時期：日数か杯数のどちらかに届いたら。前回がなければ登録した日から', () => {
  const s = maintenanceStatus(grinder({ createdAt: daysAgo(31) }), [], NOW);
  assert.equal(s.due, true);
  assert.equal(s.why, '登録から31日・0杯');
  // 杯数で数えないケトルは日数だけ
  assert.equal(maintenanceStatus(kettle({ createdAt: daysAgo(61) }), [brewAt(1)], NOW).why, '登録から61日');
  const few = maintenanceStatus(grinder(), [brewAt(1), brewAt(2)], NOW);
  assert.deepEqual([few.due, few.daysLeft, few.cupsLeft, few.cups], [false, 20, 48, 2]);
  assert.equal(maintenanceLine(few), '刃の掃除：あと20日か48杯');

  const brews = Array.from({ length: 50 }, (_, i) => brewAt(1 + i * 0.1));
  const byCups = maintenanceStatus(grinder({ maintenance: { lastDoneAt: daysAgo(9) } }), brews, NOW);
  assert.equal(byCups.due, true);
  assert.equal(byCups.why, '前回から9日・50杯');
  assert.equal(maintenanceLine(byCups), '刃の掃除：時期です（前回から9日・50杯）');
});

test('杯数：前回より後の、その器具を使った杯だけ。消した杯・ほかの器具・未来の杯は数えない', () => {
  const brews = [
    brewAt(1),
    brewAt(2, { deletedAt: daysAgo(1) }),
    brewAt(3, { equipment: { grinderId: 'other' } }),
    brewAt(4, { equipment: {}, actual: { grind: { grinderId: 'g1' } } }), // 器具の欄がなく挽き目だけの杯
    brewAt(6), // 前回（5日前）より前
    brewAt(-1), // 未来
  ];
  const s = maintenanceStatus(grinder({ maintenance: { lastDoneAt: daysAgo(5) } }), brews, NOW);
  assert.equal(s.cups, 2);
  assert.equal(brewUsesEquipment(brews[0], kettle()), true);
  assert.equal(brewUsesEquipment({ equipment: { kettleId: 'x' } }, kettle()), false);
});

test('もうすぐ・知らせない・あとで', () => {
  const soon = maintenanceStatus(grinder({ createdAt: daysAgo(25) }), [], NOW);
  assert.equal(soon.soon, true);
  assert.match(maintenanceLine(soon), /もうすぐ/);
  const off = maintenanceStatus(grinder({ createdAt: daysAgo(90), maintenance: { enabled: false } }), [], NOW);
  assert.deepEqual([off.due, off.reached], [false, false]);
  assert.equal(maintenanceLine(off), '刃の掃除：知らせない');

  const eq = grinder({ createdAt: daysAgo(40) });
  const snoozed = { ...eq, maintenance: snooze(eq.maintenance, NOW) };
  const s1 = maintenanceStatus(snoozed, [], NOW);
  assert.deepEqual([s1.due, s1.snoozed], [false, true]);
  const s2 = maintenanceStatus(snoozed, [], new Date(NOW.getTime() + 3 * 86400000 + 1000));
  assert.equal(s2.due, true);
});

test('済んだ：前回を今に、あとでを消し、日時を新しい順に12件まで残す', () => {
  let m = { snoozedUntil: daysAgo(-2), log: [] };
  for (let i = 0; i < LOG_MAX + 3; i++) m = markDone(m, new Date(NOW.getTime() + i * 1000));
  assert.equal(m.snoozedUntil, null);
  assert.equal(m.log.length, LOG_MAX);
  assert.equal(m.lastDoneAt, m.log[0]);
  const s = maintenanceStatus(grinder({ createdAt: daysAgo(100), maintenance: m }), [brewAt(1)], new Date(NOW.getTime() + 60000));
  assert.deepEqual([s.due, s.days, s.cups], [false, 0, 0]);
});

test('ホームの一覧：時期が来たものだけ、過ぎた日数の多い順。消した器具は出さない', () => {
  const list = [
    grinder({ createdAt: daysAgo(35) }),
    kettle({ createdAt: daysAgo(90) }),
    kettle({ id: 'k2', createdAt: daysAgo(90), deletedAt: daysAgo(1) }),
    { id: 'd', kind: 'dripper', createdAt: daysAgo(400), deletedAt: null },
  ];
  assert.deepEqual(dueMaintenance(list, [], NOW).map((s) => s.eq.id), ['k1', 'g1']);
});

test('編集の欄：範囲の確かめ、知らせるなら日数か杯数が要る、日付', () => {
  assert.deepEqual(normalizeMaintenanceInput({ mtEnabled: 'on', mtDays: '３０', mtCups: '', mtLast: '2026-11-01' }, 'grinder'), {
    value: { enabled: true, everyDays: 30, everyCups: null, lastDoneYmd: '2026-11-01' },
    errors: {},
  });
  assert.ok(normalizeMaintenanceInput({ mtEnabled: 'on', mtDays: '0' }, 'grinder').errors.mtDays);
  assert.ok(normalizeMaintenanceInput({ mtEnabled: 'on', mtCups: '2.5' }, 'grinder').errors.mtCups);
  assert.ok(normalizeMaintenanceInput({ mtEnabled: 'on' }, 'kettle').errors.mtDays);
  assert.deepEqual(normalizeMaintenanceInput({ mtEnabled: '' }, 'kettle').errors, {});
  assert.ok(normalizeMaintenanceInput({ mtEnabled: 'on', mtDays: '30', mtLast: '2026-02-31' }, 'kettle').errors.mtLast);
  assert.deepEqual(normalizeMaintenanceInput({ mtDays: 'x' }, 'dripper'), { value: null, errors: {} });
});

test('編集の値を重ねる：記録とあとでは残し、前回の日を変えたときだけ前回を直す', () => {
  const cur = { enabled: true, everyDays: 30, everyCups: 50, lastDoneAt: '2026-11-10T21:00:00.000Z', snoozedUntil: daysAgo(-1), log: ['2026-11-10T21:00:00.000Z'] };
  const same = mergeMaintenance(cur, { enabled: true, everyDays: 20, everyCups: null, lastDoneYmd: maintenanceToFormValues({ kind: 'grinder', maintenance: cur }).mtLast });
  assert.deepEqual([same.everyDays, same.everyCups, same.lastDoneAt, same.snoozedUntil, same.log.length], [20, null, cur.lastDoneAt, cur.snoozedUntil, 1]);
  const moved = mergeMaintenance(cur, { enabled: true, everyDays: 30, everyCups: 50, lastDoneYmd: '2026-11-15' });
  assert.equal(moved.lastDoneAt, new Date('2026-11-15T12:00:00').toISOString());
  assert.equal(moved.snoozedUntil, null);
  assert.deepEqual(maintenanceToFormValues(grinder()), { mtEnabled: true, mtDays: '30', mtCups: '50', mtLast: '' });
  assert.deepEqual(maintenanceToFormValues({ kind: 'scale' }), {});
});

test('DB：済んだ・あとで を器具に書き、書き出し → 復元で残る。古い器具の記録はそのまま読める', async () => {
  const db = openDb('pourfolio-mt-test', { indexedDB: new IDBFactory(), IDBKeyRange });
  const eq = await addEquipment(db, { kind: 'grinder', name: 'ミル', attrs: {}, isDefault: true, memo: '' }, new Date(daysAgo(40)));
  assert.equal(maintenanceStatus(await getEquipment(db, eq.id), [], NOW).due, true);
  await snoozeMaintenance(db, eq.id, NOW);
  assert.equal(maintenanceStatus(await getEquipment(db, eq.id), [], NOW).due, false);
  await markMaintenanceDone(db, eq.id, NOW);
  const done = await getEquipment(db, eq.id);
  assert.deepEqual([done.maintenance.lastDoneAt, done.maintenance.snoozedUntil, done.maintenance.log.length], [NOW.toISOString(), null, 1]);
  // 編集で名前を直しても、お手入れの記録は消えない（画面は mergeMaintenance で重ねて保存する）
  await updateEquipment(db, eq.id, { name: 'ミル2', maintenance: mergeMaintenance(done.maintenance, { enabled: true, everyDays: 14, everyCups: null, lastDoneYmd: null }) }, NOW);
  const backup = await exportAll(db, NOW);
  await clearAll(db);
  await restoreBackup(db, parseBackup(JSON.stringify(backup)));
  const back = await getEquipment(db, eq.id);
  assert.deepEqual([back.name, back.maintenance.everyDays, back.maintenance.lastDoneAt, back.maintenance.log.length], ['ミル2', 14, NOW.toISOString(), 1]);
  await assert.rejects(markMaintenanceDone(db, 'no-such', NOW));
});

test('「いつも使う」の器具を削除したら、同じ種類でいちばん新しく直したものを「いつも使う」にする（総仕上げの69番）', async () => {
  const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb');
  const { deleteEquipment, listEquipment } = await import('../js/db.js');
  const { defaultEquipmentIds } = await import('../js/core/equipment.js');
  const db = openDb('pf-eq-default', { indexedDB: new IDBFactory(), IDBKeyRange });
  const t = (m) => new Date(Date.UTC(2026, 10, 18, 0, m));
  const a = await addEquipment(db, { kind: 'grinder', name: 'A', attrs: {}, isDefault: true }, t(0));
  await addEquipment(db, { kind: 'grinder', name: 'B', attrs: {} }, t(1));
  const c = await addEquipment(db, { kind: 'grinder', name: 'C', attrs: {} }, t(2));
  await addEquipment(db, { kind: 'dripper', name: 'D', attrs: {} }, t(3));
  await deleteEquipment(db, a.id, t(4));
  assert.equal(defaultEquipmentIds(await listEquipment(db)).grinderId, c.id);
  db.close();
});
