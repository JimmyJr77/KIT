// Marketing spend: what was spent, and who or what it was for, as specifically as it's known. An entry can name an
// event, a pipeline ticket, a person, a territory and an account (organization), or none of them; and the marketing request
// it answered, whose event and pipeline ticket it then counts toward. What's missing is filled in from what's there:
//   Person: the one named, else the pipeline ticket's BD director, else (for event spend) split evenly between the people
//     from the company attending the event. Otherwise nobody: company-wide spend.
//   Territory: the one named, else the pipeline ticket's, else the person's (when they cover exactly one).
//   Account: the organization named, else the pipeline ticket's.
import { db } from './db.js';

export const SPEND_CATEGORIES = ['Event sponsorship', 'Booth & exhibit', 'Advertising', 'Digital & web', 'Collateral & print',
  'Swag & giveaways', 'Hospitality', 'Content & video', 'Other'];

const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);

/** Every entry, newest first, with the names of what it links to and its resolved person shares, territory and account. */
export function spendEntries({ from, to } = {}) {
  // An entry recorded against a marketing request is for what the request is for: its event, and its pipeline ticket.
  const rows = db.prepare(`SELECT s.*, COALESCE(s.event_id, q.event_id) AS event_id, COALESCE(s.ticket_id, qt.id) AS ticket_id,
      s.event_id AS own_event_id, s.ticket_id AS own_ticket_id, COALESCE(q.title, substr(q.details, 1, 80)) AS request_title,
      e.name AS event_name, t.opportunity_title AS ticket_title, t.organization AS ticket_organization,
      t.bd_director_id AS ticket_director_id, t.territory_id AS ticket_territory_id,
      u.first_name || ' ' || u.last_name AS user_name, tr.name AS territory_name, c.first_name || ' ' || c.last_name AS created_by_name
    FROM marketing_spend s LEFT JOIN event_support_requests q ON q.id = s.request_id
      LEFT JOIN tickets qt ON qt.id = q.for_ticket_id AND qt.ticket_type = 'bid'
      LEFT JOIN events e ON e.id = COALESCE(s.event_id, q.event_id) LEFT JOIN tickets t ON t.id = COALESCE(s.ticket_id, qt.id)
      LEFT JOIN users u ON u.id = s.user_id LEFT JOIN territories tr ON tr.id = s.territory_id LEFT JOIN users c ON c.id = s.created_by
    WHERE (@from IS NULL OR s.spent_on >= @from) AND (@to IS NULL OR s.spent_on <= @to)
    ORDER BY s.spent_on DESC, s.id DESC`).all({ from: from || null, to: to || null });
  const names = new Map(db.prepare("SELECT id, first_name || ' ' || last_name AS name FROM users").all().map((u) => [u.id, u.name]));
  const territories = new Map(db.prepare('SELECT id, name FROM territories').all().map((t) => [t.id, t.name]));
  const covers = new Map();
  db.prepare('SELECT user_id, territory_id FROM user_territories').all().forEach((r) => covers.set(r.user_id, [...(covers.get(r.user_id) || []), r.territory_id]));
  const attendees = new Map();
  db.prepare('SELECT event_id, user_id FROM event_attendees').all().forEach((a) => attendees.set(a.event_id, [...(attendees.get(a.event_id) || []), a.user_id]));

  return rows.map((s) => {
    const person = s.user_id || s.ticket_director_id;
    const going = !person && s.event_id ? attendees.get(s.event_id) || [] : [];
    const shares = person ? [{ user_id: person, amount: s.amount }] : going.map((id) => ({ user_id: id, amount: s.amount / going.length }));
    const own = person && covers.get(person)?.length === 1 ? covers.get(person)[0] : null;
    const territory = s.territory_id || s.ticket_territory_id || own;
    return {
      ...s,
      shares: shares.map((x) => ({ ...x, name: names.get(x.user_id) || 'Unknown' })),
      split: !person && going.length > 1,
      resolved_territory_id: territory || null,
      resolved_territory: territory ? territories.get(territory) || null : null,
      account: s.organization || s.ticket_organization || null,
    };
  });
}

/** How much of each entry counts toward a set of people (null: everyone, i.e. all spend). */
export function spendFor(entries, people = null) {
  if (!people) return sum(entries, (s) => s.amount);
  const set = new Set(people);
  return sum(entries, (s) => sum(s.shares.filter((x) => set.has(x.user_id)), (x) => x.amount));
}

/** Spend grouped by account, territory, pipeline ticket, person and event, largest first. */
export function spendBreakdown(entries) {
  const group = (keyOf) => {
    const m = new Map();
    entries.forEach((s) => keyOf(s).forEach(([key, label, amount]) => {
      if (!m.has(key)) m.set(key, { key, label, value: 0, entries: 0 });
      const g = m.get(key);
      g.value += amount; g.entries += 1;
    }));
    // Largest first; what isn't tied to anything (no account, no territory, …) last.
    return [...m.values()].sort((a, b) => !a.key - !b.key || b.value - a.value);
  };
  return {
    total: sum(entries, (s) => s.amount),
    entries: entries.length,
    byAccount: group((s) => [[s.account || '', s.account || 'No account', s.amount]]),
    byTerritory: group((s) => [[s.resolved_territory_id || 0, s.resolved_territory || 'No territory', s.amount]]),
    byTicket: group((s) => [[s.ticket_id || 0, s.ticket_title || 'No pipeline ticket', s.amount]]),
    byPerson: group((s) => (s.shares.length ? s.shares.map((x) => [x.user_id, x.name, x.amount]) : [[0, 'Company-wide', s.amount]])),
    byEvent: group((s) => [[s.event_id || 0, s.event_name || 'No event', s.amount]]),
    byCategory: group((s) => [[s.category || '', s.category || 'No category', s.amount]]),
  };
}
