// Sync conflicts: a shared field changed in KIT and in Pipedrive since the last pull, so a send left it alone (it would
// overwrite someone's newer work). Each one is kept here, with both versions, until an admin picks a side in Admin
// Access › Pipedrive › Conflicts, one at a time or all at once. While it waits, pulls leave the field as it was found
// (KIT's value in KIT, the old snapshot) so neither side quietly wins, and sends keep skipping it.
//
// Every record that syncs (ticket, organization, contact, activity, product, installment, project, project task) keeps
// its Pipedrive snapshot in a pipedrive_snapshot column, and the field is a column of the same name, except a deal's
// custom fields (cf_<key>), kept in the ticket's custom_fields list.
import { db, json } from '../db.js';

const ident = /^[a-z_][a-z0-9_]*$/i;

/** A record's shared fields, from its snapshot (the snapshot has exactly the tracked keys). */
function row(tbl, id) {
  if (!ident.test(tbl)) throw new Error(`Bad table ${tbl}`);
  return db.prepare(`SELECT * FROM ${tbl} WHERE id = ?`).get(id);
}
const columns = new Map();
/** Whether `field` is one the record can hold: a column of its table, or a custom deal field on a ticket. */
function allowed(tbl, r, field) {
  if (!r?.pipedrive_snapshot || !ident.test(field)) return false;
  if (field.startsWith('cf_')) return tbl === 'tickets';
  if (!columns.has(tbl)) columns.set(tbl, new Set(db.prepare(`PRAGMA table_info(${tbl})`).all().map((c) => c.name)));
  return columns.get(tbl).has(field);
}
const same = (a, b) => String(a ?? '') === String(b ?? '');

/** Set one shared field on a record: a column, or a custom deal field inside a ticket's custom_fields. */
function setField(tbl, r, field, value) {
  if (tbl === 'tickets' && field.startsWith('cf_')) {
    const key = field.slice(3);
    const list = json.parse(r.custom_fields, []);
    const f = list.find((x) => x.key === key);
    if (f) f.value = value; else list.push({ key, value });
    db.prepare('UPDATE tickets SET custom_fields = ? WHERE id = ?').run(json.str(list), r.id);
  } else {
    db.prepare(`UPDATE ${tbl} SET ${field} = ? WHERE id = ?`).run(value, r.id);
  }
}
/** Set one field inside a record's Pipedrive snapshot. */
function setSnapshot(tbl, r, field, value) {
  const snap = json.parse(r.pipedrive_snapshot, {});
  snap[field] = value ?? null;
  db.prepare(`UPDATE ${tbl} SET pipedrive_snapshot = ? WHERE id = ?`).run(json.str(snap), r.id);
}

/**
 * Record a conflict found by a send: `kit` is KIT's value, `pipedrive` Pipedrive's now, `snapshot` what both started from.
 * Finding the same one again only refreshes Pipedrive's value.
 */
export function noteConflict({ kind, tbl, id, field, ticket_id = null, title, kit, pipedrive, snapshot }) {
  db.prepare(`INSERT INTO pipedrive_conflicts (kind, tbl, row_id, field, ticket_id, title, kit_value, pipedrive_value, snapshot_value)
    VALUES (@kind, @tbl, @id, @field, @ticket_id, @title, @kit, @pipedrive, @snapshot)
    ON CONFLICT (tbl, row_id, field) DO UPDATE SET pipedrive_value = excluded.pipedrive_value, title = excluded.title, ticket_id = excluded.ticket_id`)
    .run({ kind, tbl, id, field, ticket_id, title, kit: json.str(kit), pipedrive: json.str(pipedrive), snapshot: json.str(snapshot) });
}

/** Every open conflict, oldest first. Values come back decoded. */
export function conflicts() {
  return db.prepare('SELECT * FROM pipedrive_conflicts ORDER BY found_at, id').all().map((c) => ({
    ...c, kit_value: json.parse(c.kit_value, null), pipedrive_value: json.parse(c.pipedrive_value, null), snapshot_value: json.parse(c.snapshot_value, null),
  }));
}
export const conflictCount = () => db.prepare('SELECT COUNT(*) AS n FROM pipedrive_conflicts').get().n;

/**
 * After a pull has written its records: put each open conflict back as it was found, KIT's value in KIT and the snapshot
 * both sides started from, so the pull doesn't settle it. The value the pull just brought is Pipedrive's latest, so it's
 * kept as the conflict's Pipedrive side. A conflict whose record is gone is dropped.
 */
export function holdConflicts() {
  for (const c of conflicts()) {
    const r = row(c.tbl, c.row_id);
    if (!r || !allowed(c.tbl, r, c.field)) { db.prepare('DELETE FROM pipedrive_conflicts WHERE id = ?').run(c.id); continue; }
    const pulled = json.parse(r.pipedrive_snapshot, {})[c.field];
    // Pipedrive now holds what KIT holds: nothing is in dispute any more. The pull has written both already.
    if (same(pulled, c.kit_value)) { db.prepare('DELETE FROM pipedrive_conflicts WHERE id = ?').run(c.id); continue; }
    db.prepare('UPDATE pipedrive_conflicts SET pipedrive_value = ? WHERE id = ?').run(json.str(pulled), c.id);
    setField(c.tbl, r, c.field, c.kit_value);
    setSnapshot(c.tbl, r, c.field, c.snapshot_value);
  }
}

/**
 * Drop conflicts on which both sides hold the same value: there is nothing to settle, the snapshot just catches up.
 * (Snapshots from before a field was tracked have no baseline for it, and a send once mistook that for a dispute.)
 */
export function dropAgreed() {
  let n = 0;
  db.transaction(() => {
    for (const c of conflicts().filter((x) => same(x.kit_value, x.pipedrive_value))) {
      const r = row(c.tbl, c.row_id);
      if (r && allowed(c.tbl, r, c.field)) setSnapshot(c.tbl, r, c.field, c.pipedrive_value);
      db.prepare('DELETE FROM pipedrive_conflicts WHERE id = ?').run(c.id);
      n += 1;
    }
  })();
  return n;
}

/**
 * Settle conflicts: `winner` is 'kit' (KIT's value goes to Pipedrive with the next auto sync or push) or 'pipedrive'
 * (Pipedrive's value is written into KIT). `ids` names which; null settles them all. Returns how many were settled.
 */
export function resolveConflicts(winner, ids = null) {
  if (!['kit', 'pipedrive'].includes(winner)) throw new Error('Choose KIT or Pipedrive');
  const chosen = conflicts().filter((c) => !ids || ids.includes(c.id));
  db.transaction(() => {
    for (const c of chosen) {
      const r = row(c.tbl, c.row_id);
      if (r && allowed(c.tbl, r, c.field)) {
        // Either way the snapshot becomes Pipedrive's current value: with KIT winning, KIT's value is then a plain change
        // waiting to be sent; with Pipedrive winning, KIT takes that value too and nothing is left to send.
        setSnapshot(c.tbl, r, c.field, c.pipedrive_value);
        if (winner === 'pipedrive') setField(c.tbl, r, c.field, c.pipedrive_value);
      }
      db.prepare('DELETE FROM pipedrive_conflicts WHERE id = ?').run(c.id);
    }
  })();
  return chosen.length;
}
