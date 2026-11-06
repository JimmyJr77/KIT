// Pipedrive's field definitions, kept in KIT so its forms show every field Pipedrive has (with its options), and so a
// value can be turned into what Pipedrive stores (option ids, dates, numbers) and back into text for people.
//
// Every pull saves the deal, person, organization and project fields as Pipedrive has them right then, so a custom
// field or option added in Pipedrive shows up in KIT without anyone doing anything.
import { db, json } from '../db.js';

export const ENTITIES = ['deal', 'person', 'organization', 'project'];
// The deal's "Account" field is KIT's territory, with its own column, so it isn't a custom field here.
export const ACCOUNT_FIELD = 'Account';
// Built-in fields with options worth keeping (so KIT can offer the same choices), by entity.
const KEEP_BUILTIN = {
  deal: ['label', 'lost_reason', 'origin', 'channel', 'status'],
  person: ['label', 'label_ids'],
  organization: ['label', 'label_ids', 'industry', 'annual_revenue'],
  project: ['labels', 'label', 'status'],
};

/** Save one entity's fields as Pipedrive lists them. Fields no longer in Pipedrive are marked inactive (never deleted). */
export function saveFields(entity, list) {
  const keep = KEEP_BUILTIN[entity] || [];
  const rows = (list || []).filter((f) => f.edit_flag || keep.includes(f.key));
  const up = db.prepare(`INSERT INTO pipedrive_fields (entity, key, pipedrive_id, name, field_type, options, position, custom, important, active, updated_at)
    VALUES (@entity, @key, @pipedrive_id, @name, @field_type, @options, @position, @custom, @important, 1, datetime('now'))
    ON CONFLICT(entity, key) DO UPDATE SET pipedrive_id = excluded.pipedrive_id, name = excluded.name, field_type = excluded.field_type,
      options = excluded.options, position = excluded.position, custom = excluded.custom, important = excluded.important, active = 1, updated_at = excluded.updated_at`);
  db.transaction(() => {
    rows.forEach((f, i) => up.run({
      entity, key: f.key, pipedrive_id: f.id ?? null, name: f.name, field_type: f.field_type || 'varchar',
      options: f.options ? json.str(f.options.map((o) => ({ id: o.id, label: o.label, ...(o.color ? { color: o.color } : {}) }))) : null,
      // Pipedrive's Summary section: fields flagged important, or (how this account lays its deals out) custom fields in a field group.
      position: f.order_nr ?? i, custom: f.edit_flag ? 1 : 0, important: f.important_flag || (f.edit_flag && f.group_id != null) ? 1 : 0,
    }));
    db.prepare('UPDATE pipedrive_fields SET active = 0 WHERE entity = ? AND key NOT IN (SELECT value FROM json_each(?))').run(entity, json.str(rows.map((f) => f.key)));
  })();
}

/** An entity's active fields, in Pipedrive's order, options parsed. */
export function fieldsOf(entity) {
  return db.prepare('SELECT * FROM pipedrive_fields WHERE entity = ? AND active = 1 ORDER BY position, name').all(entity)
    .map((f) => ({ ...f, options: json.parse(f.options, null), custom: !!f.custom, important: !!f.important }));
}
export const fieldByKey = (entity, key) => fieldsOf(entity).find((f) => f.key === key) || null;
export const fieldByName = (entity, name) => fieldsOf(entity).find((f) => f.name === name) || null;
/** The deal's custom fields, apart from Account (which is the territory). */
export const customDealFields = () => fieldsOf('deal').filter((f) => f.custom && f.name !== ACCOUNT_FIELD);

const isOptionField = (f) => Array.isArray(f.options) && ['enum', 'set', 'varchar_options', 'status'].includes(f.field_type);
const optionLabel = (f, id) => f.options.find((o) => String(o.id) === String(id).trim())?.label;
const optionId = (f, label) => {
  const want = String(label ?? '').trim().toLowerCase();
  return f.options.find((o) => String(o.label).trim().toLowerCase() === want)?.id ?? null;
};

/** A field's stored value as text people read: option ids become labels, objects their name or value. */
export function fieldText(field, value) {
  if (value == null || value === '') return null;
  if (isOptionField(field)) {
    const ids = Array.isArray(value) ? value : String(value).split(',');
    const labels = ids.map((id) => optionLabel(field, id) ?? (field.field_type === 'varchar_options' ? String(id).trim() : null)).filter(Boolean);
    return labels.join(', ') || null;
  }
  if (Array.isArray(value)) return value.map((v) => fieldText({ ...field, field_type: 'varchar' }, v)).filter(Boolean).join(', ') || null;
  if (typeof value === 'object') return value.formatted_address ?? value.name ?? value.value ?? null;
  if (field.field_type === 'double' || field.field_type === 'monetary') {
    const n = Number(value);
    return Number.isFinite(n) ? String(Number.isInteger(n) ? n : Math.round(n * 100) / 100) : String(value);
  }
  return String(value);
}

/**
 * Text as Pipedrive's v2 API takes it for a custom field: option ids for enum and set fields, numbers for double and
 * monetary, dates and text as they are. undefined means the field can't be set from text (users, people, organizations…).
 * An option label Pipedrive doesn't have gives { error }.
 */
export function fieldValue(field, text) {
  const t = String(text ?? '').trim();
  if (isOptionField(field)) {
    if (!t) return field.field_type === 'set' ? [] : null;
    const ids = t.split(',').map((x) => x.trim()).filter(Boolean).map((label) => ({ label, id: optionId(field, label) }));
    const missing = ids.filter((x) => x.id == null).map((x) => x.label);
    if (missing.length) return { error: `${field.name}: Pipedrive has no option "${missing.join('", "')}"` };
    return field.field_type === 'set' ? ids.map((x) => x.id) : ids[0].id;
  }
  switch (field.field_type) {
    case 'double': case 'monetary': {
      if (!t) return null;
      const n = Number(t.replace(/[$,\s]/g, ''));
      return Number.isFinite(n) ? n : { error: `${field.name}: "${t}" isn't a number` };
    }
    case 'date':
      if (!t) return null;
      return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : { error: `${field.name}: "${t}" isn't a date (YYYY-MM-DD)` };
    case 'varchar': case 'text': case 'phone': case 'time': case 'daterange': case 'timerange': case 'int':
      return t || null;
    case 'address':
      return t ? { value: t } : null;
    default:
      return undefined;
  }
}

/** Label names for ids on a labels field ("label_ids" on people and organizations, "labels" on projects). */
export const labelNames = (field, ids) => (field && Array.isArray(ids) ? ids.map((id) => optionLabel(field, id)).filter(Boolean) : []);
/** Label ids for names; names Pipedrive doesn't have are dropped. */
export const labelIds = (field, names) => (field ? (names || []).map((n) => optionId(field, n)).filter((id) => id != null) : []);

/** A ticket row with its Pipedrive custom fields spread as cf_<key>, so they compare like any other tracked field. */
export function withCustom(row) {
  if (!row) return row;
  const out = { ...row };
  json.parse(row.custom_fields, []).forEach((f) => { if (f.key) out[`cf_${f.key}`] = f.value ?? null; });
  return out;
}
export const cfKey = (key) => `cf_${key}`;
/** Whether a tracked field name is a custom field (cf_<key>) and, if so, its key. */
export const customKeyOf = (tracked) => (tracked.startsWith('cf_') ? tracked.slice(3) : null);

/** The custom_fields list for a ticket from Pipedrive's values, keeping any KIT-only (keyless) fields it already had. */
export function customFieldsList(deal, existing = []) {
  // KIT-only fields are kept; anything named like a Pipedrive field (from before fields had keys, or the owner line a pull adds) is not.
  const pipedriveNames = new Set([...fieldsOf('deal').map((f) => f.name), 'Pipedrive owner']);
  const kept = (Array.isArray(existing) ? existing : []).filter((f) => !f.key && f.name && !pipedriveNames.has(f.name));
  const fromDeal = customDealFields().map((f) => ({ key: f.key, name: f.name, value: fieldText(f, deal[f.key]) })).filter((f) => f.value != null);
  return [...fromDeal, ...kept];
}
