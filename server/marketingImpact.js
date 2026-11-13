// Marketing tracking: marketing asks to marketing dollars, dollars to events and opportunities, and how those
// opportunities turn out. Only pipeline tickets still in the books count (see inBooks).
//
// How marketing is tied to a pipeline ticket:
//   At the beginning (sourced): the ticket carries the Marketing Lead tag. Marketing fed the lead to the team, or it came
//     out of an event Marketing supported.
//   Later (supported): Marketing is tied to a ticket it didn't source. A request is for it or names it, dollars are
//     recorded against it, or it's tied to an event that has marketing requests or dollars.
// The dollars behind a ticket: what's recorded against it directly, plus an even share of each of its events' dollars
// (the event's spend that isn't for one ticket, split between the tickets tied to that event).
import { db, json, LEAD_TAGS, GOOGLE_SOLUTION_TAG } from './db.js';
import { inBooks } from './financials.js';
import { spendEntries } from './marketingSpend.js';
import { hasTag } from './leads.js';

const STATUSES = ['open', 'won', 'lost'];
const tally = () => Object.fromEntries(STATUSES.map((k) => [k, { count: 0, value: 0 }]));
const add = (bucket, t) => { const b = bucket[t.deal_status] || bucket.open; b.count += 1; b.value += t.value || 0; };
const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);

/** `requests`: every marketing request, as routes/marketing.js lists them. */
export function marketingImpact(requests) {
  const tickets = db.prepare(`SELECT t.id, t.opportunity_title AS title, t.organization, t.value, t.deal_status, t.labels, t.created_at, t.won_at, t.lost_at,
      d.first_name || ' ' || d.last_name AS director
    FROM tickets t LEFT JOIN users d ON d.id = t.bd_director_id WHERE t.ticket_type = 'bid' AND ${inBooks()}`).all()
    .map((t) => ({ ...t, labels: json.parse(t.labels, []), deal_status: STATUSES.includes(t.deal_status) ? t.deal_status : 'open' }));
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const links = db.prepare('SELECT ticket_id, event_id, sourced FROM ticket_events').all().filter((l) => byId.has(l.ticket_id));
  const events = db.prepare('SELECT id, name, date_from, date_to, goal FROM events').all();
  const meetings = db.prepare('SELECT event_id, COUNT(*) AS n FROM meetings WHERE event_id IS NOT NULL GROUP BY event_id').all();
  const leads = db.prepare('SELECT ticket_id FROM marketing_leads WHERE ticket_id IS NOT NULL').all();
  const spend = spendEntries();

  // Each event's dollars, and the part of them not recorded against one ticket (which its tickets share).
  const eventSpend = new Map();
  const eventShared = new Map();
  spend.filter((s) => s.event_id).forEach((s) => {
    eventSpend.set(s.event_id, (eventSpend.get(s.event_id) || 0) + s.amount);
    if (!s.ticket_id) eventShared.set(s.event_id, (eventShared.get(s.event_id) || 0) + s.amount);
  });
  const eventTickets = new Map();
  links.forEach((l) => eventTickets.set(l.event_id, [...(eventTickets.get(l.event_id) || []), l]));
  const marketingEvents = new Set([...eventSpend.keys(), ...requests.filter((r) => r.event_id).map((r) => r.event_id)]);

  // Every way marketing touches each ticket.
  const touch = new Map(); // ticket id → { direct, via: Set of labels }
  const note = (id, amount, via) => {
    if (!byId.has(id)) return;
    const x = touch.get(id) || { dollars: 0, via: new Set() };
    x.dollars += amount || 0;
    if (via) x.via.add(via);
    touch.set(id, x);
  };
  spend.filter((s) => s.ticket_id).forEach((s) => note(s.ticket_id, s.amount, 'Marketing dollars'));
  requests.forEach((r) => {
    const name = `Request: ${r.title || r.event_name || 'marketing support'}`;
    if (r.for_ticket?.ticket_type === 'bid') note(r.for_ticket.id, 0, name);
    r.tickets.forEach((t) => note(t.id, 0, name));
  });
  links.filter((l) => marketingEvents.has(l.event_id)).forEach((l) => {
    const e = events.find((x) => x.id === l.event_id);
    note(l.ticket_id, (eventShared.get(l.event_id) || 0) / eventTickets.get(l.event_id).length, `Event: ${e?.name || 'event'}`);
  });
  leads.forEach((l) => note(l.ticket_id, 0, 'Marketing lead'));
  tickets.filter((t) => hasTag(t.labels, LEAD_TAGS.marketing)).forEach((t) => note(t.id, 0, null));

  const opportunities = [...touch.entries()].map(([id, x]) => {
    const t = byId.get(id);
    return {
      id, title: t.title, organization: t.organization, value: t.value, deal_status: t.deal_status, director: t.director,
      involvement: hasTag(t.labels, LEAD_TAGS.marketing) ? 'sourced' : 'supported',
      lead_tags: Object.values(LEAD_TAGS).filter((tag) => hasTag(t.labels, tag)),
      dollars: Math.round(x.dollars * 100) / 100, via: [...x.via],
    };
  }).sort((a, b) => STATUSES.indexOf(a.deal_status) - STATUSES.indexOf(b.deal_status) || (b.value || 0) - (a.value || 0));

  // Wins and losses: sourced by marketing, supported by marketing, or neither.
  const influence = { sourced: tally(), supported: tally(), none: tally() };
  const kind = new Map(opportunities.map((o) => [o.id, o.involvement]));
  tickets.forEach((t) => add(influence[kind.get(t.id) || 'none'], t));
  const all = tally();
  tickets.forEach((t) => add(all, t));

  // By lead source tag (a ticket with two sources counts under both), plus Google Solution and tickets with no source yet.
  const sourceTags = [...Object.values(LEAD_TAGS), GOOGLE_SOLUTION_TAG];
  const bySource = sourceTags.map((tag) => {
    const b = tally();
    tickets.filter((t) => hasTag(t.labels, tag)).forEach((t) => add(b, t));
    return { tag, ...b };
  });
  const untagged = tally();
  tickets.filter((t) => !Object.values(LEAD_TAGS).some((tag) => hasTag(t.labels, tag))).forEach((t) => add(untagged, t));
  bySource.push({ tag: 'No lead source yet', none: true, ...untagged });

  const byEvent = events.filter((e) => marketingEvents.has(e.id) || eventTickets.has(e.id)).map((e) => {
    const ls = eventTickets.get(e.id) || [];
    const b = tally();
    ls.forEach((l) => add(b, byId.get(l.ticket_id)));
    return {
      id: e.id, name: e.name, date_from: e.date_from, spend: eventSpend.get(e.id) || 0, requests: requests.filter((r) => r.event_id === e.id).length,
      meetings: meetings.find((m) => m.event_id === e.id)?.n || 0, tickets: ls.length, sourced: ls.filter((l) => l.sourced).length, ...b,
    };
  }).sort((a, b) => b.spend - a.spend || b.tickets - a.tickets || (a.date_from < b.date_from ? 1 : -1));

  // Each ask with what it's tied to and how its opportunities stand: the ones it names, and its event's.
  const asks = requests.map((r) => {
    const ids = new Set([...(r.for_ticket?.ticket_type === 'bid' ? [r.for_ticket.id] : []), ...r.tickets.map((t) => t.id),
      ...(r.event_id ? (eventTickets.get(r.event_id) || []).map((l) => l.ticket_id) : [])]);
    const b = tally();
    [...ids].filter((id) => byId.has(id)).forEach((id) => add(b, byId.get(id)));
    return { ...r, opportunities: [...ids].filter((id) => byId.has(id)).length, outcome: b };
  });

  const total = sum(spend, (s) => s.amount);
  return {
    totals: {
      spend: total,
      onRequests: sum(spend.filter((s) => s.request_id), (s) => s.amount),
      onEvents: sum(spend.filter((s) => s.event_id), (s) => s.amount),
      onTickets: sum(opportunities, (o) => o.dollars),
      untied: sum(spend.filter((s) => !s.request_id && !s.event_id && !s.ticket_id), (s) => s.amount),
      requests: requests.length, openRequests: requests.filter((r) => r.status !== 'accepted').length,
    },
    influence, all, bySource, byEvent, asks, opportunities,
  };
}
