// The BD dashboard: the same views for one person (My dashboard, or a BD director on the Company dashboard) and for a
// whole team. Four parts:
//   To-do highlights: this week's priorities, open activities, unread alerts, upcoming trips and their estimated cost,
//     open account objectives, and upcoming events (who from the scope is going, and the events nobody is going to).
//   Top-level metrics: Qualified+ pipeline, booked and revenue this quarter and year, PWIN-adjusted expected bookings,
//     and expenses (actual travel and marketing) against revenue.
//   BD numbers: bookings, revenue and expected bookings over time, the Qualified+ pipeline, and book-to-bill three ways.
//   (The BD report card is its own endpoint: /financials/report-card.)
// Bookings are contracts won, on their award date; revenue is what's billed on them; both follow the pipeline ticket's BD director.
import { db, json } from './db.js';
import { weekStartFor } from './routes/priorities.js';
import {
  bids, contracts, expected, byStage, qualifiedBy, bookingsByQuarter, backlog, bookToBill, bookToBillSeries, fundedTtm, pipelineByPerson,
  targets, qualifiedTargets, quartersTarget, trailingQuarters, trends, quarters, quarterRange, localToday, QUALIFIED_STAGES, isOpen,
} from './financials.js';
import { spendEntries, spendFor } from './marketingSpend.js';
import { quarterFor, addDays } from '../src/lib/travelCalc.js';

const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
const weighted = (t) => (t.value || 0) * (t.pwin ?? 1);
const inList = (ids) => JSON.stringify(ids);

/**
 * Who the dashboard is about. ?director=<user id>: one person. ?team=<team id>: everyone on the team. The BD team also
 * gets every pipeline ticket, whoever its director is (pipeline tickets with no director included); any other team, only pipeline tickets its people direct.
 * ?territory=<id> narrows the money (pipeline, bookings, revenue, marketing) to one territory.
 */
export function scopeFrom(q, me) {
  const territory = Number(q.territory) || null;
  const director = Number(q.director) || (q.team ? null : me);
  if (director) {
    const u = db.prepare('SELECT id, first_name, last_name FROM users WHERE id = ?').get(director);
    return u ? { kind: 'person', people: [u.id], director: u.id, label: `${u.first_name} ${u.last_name}`, territory, allBids: false } : null;
  }
  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(Number(q.team));
  if (!team) return null;
  const people = db.prepare('SELECT u.id FROM user_teams ut JOIN users u ON u.id = ut.user_id WHERE ut.team_id = ? AND u.active = 1').all(team.id).map((u) => u.id);
  return { kind: 'team', team: team.id, people, director: null, label: team.name, territory, allBids: team.name === 'BD' };
}

/** The scope's pipeline tickets and contracts. */
function money(s) {
  const f = { director: s.director, territory: s.territory };
  const keep = (x) => s.allBids || s.director || s.people.includes(x.bd_director_id);
  return { list: bids(f).filter(keep), deals: contracts(f).filter(keep) };
}

/** This week's priorities, open activities, alerts, trips, events and account objectives for the scope's people. */
function todo(s) {
  const today = localToday();
  const people = inList(s.people);
  const many = s.kind === 'team';
  // Each team's current week, and the scope's cards in it (a card two people share counts once).
  const cards = db.prepare('SELECT id, checkin_dow FROM teams').all().flatMap((t) => db.prepare(`SELECT DISTINCT c.*, t.opportunity_title,
      COALESCE((SELECT k.waiting_client FROM ticket_tasks k WHERE k.id = c.activity_id), 0) AS waiting_client,
      (SELECT GROUP_CONCAT(u.first_name || ' ' || u.last_name, ', ') FROM card_assignees a2 JOIN users u ON u.id = a2.user_id WHERE a2.card_id = c.id) AS who
    FROM priority_cards c JOIN card_assignees a ON a.card_id = c.id JOIN tickets t ON t.id = c.ticket_id
    WHERE c.team_id = ? AND c.week_start = ? AND a.user_id IN (SELECT value FROM json_each(?)) AND c.archived_at IS NULL AND t.archived_at IS NULL`)
    .all(t.id, weekStartFor(today, t.checkin_dow), people));
  // A planned priority that's still open because we're waiting on the client doesn't count against completion.
  const waiting = cards.filter((c) => c.is_planned && !c.completed && c.waiting_client);
  const planned = cards.filter((c) => c.is_planned && !waiting.includes(c));
  const activities = db.prepare(`SELECT k.id, k.text, k.due_date, k.ticket_id, t.opportunity_title, u.first_name || ' ' || u.last_name AS who
    FROM ticket_tasks k JOIN tickets t ON t.id = k.ticket_id LEFT JOIN users u ON u.id = k.assignee_id
    WHERE k.done = 0 AND k.assignee_id IN (SELECT value FROM json_each(?)) AND t.archived_at IS NULL`).all(people);
  const trips = db.prepare(`SELECT t.id, t.traveler_id, t.date_from, t.date_to, t.location_to, t.purposes, t.total_estimate,
      u.first_name || ' ' || u.last_name AS traveler
    FROM trips t JOIN users u ON u.id = t.traveler_id WHERE t.traveler_id IN (SELECT value FROM json_each(?)) AND t.date_to >= ? ORDER BY t.date_from`)
    .all(people, today).map((t) => ({ ...t, location_to: json.parse(t.location_to, {}), purposes: json.parse(t.purposes, []) }));
  const events = db.prepare(`SELECT e.id, e.name, e.date_from, e.date_to, e.fee, e.location FROM events e WHERE e.date_to >= ? ORDER BY e.date_from`).all(today);
  const going = db.prepare(`SELECT a.event_id, u.id, u.first_name, u.last_name FROM event_attendees a JOIN users u ON u.id = a.user_id
    WHERE a.event_id IN (SELECT id FROM events WHERE date_to >= ?) ORDER BY u.first_name, u.last_name`).all(today);
  const withPeople = events.map((e) => {
    const all = going.filter((g) => g.event_id === e.id);
    const ours = all.filter((g) => s.people.includes(g.id));
    return { ...e, location: json.parse(e.location, {}), attendees: ours.map((g) => `${g.first_name} ${g.last_name}`), others: all.length - ours.length };
  });
  const objectives = db.prepare(`SELECT o.id, o.organization, o.objective, o.target_date, o.status, u.first_name || ' ' || u.last_name AS owner
    FROM account_objectives o LEFT JOIN users u ON u.id = o.owner_id
    WHERE o.owner_id IN (SELECT value FROM json_each(?)) AND o.status NOT IN ('Achieved', 'Missed') ORDER BY o.target_date IS NULL, o.target_date`).all(people);

  return {
    priorities: {
      planned: planned.length, completed: planned.filter((c) => c.completed).length, work: cards.filter((c) => !c.is_planned).length, waiting: waiting.length,
      open: cards.filter((c) => !c.completed).map((c) => ({ id: c.id, ticket_id: c.ticket_id, title: c.title, ticket: c.opportunity_title, due_date: c.due_date, who: many ? c.who : null, waiting_client: !!c.waiting_client })),
    },
    activities: {
      open: activities.length, overdue: activities.filter((a) => a.due_date && a.due_date < today).length,
      dueThisWeek: activities.filter((a) => a.due_date && a.due_date >= today && a.due_date <= addDays(today, 7)).length,
    },
    alerts: db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE user_id IN (SELECT value FROM json_each(?)) AND read_at IS NULL').get(people).n,
    trips: { list: trips.map((t) => ({ ...t, traveler: many ? t.traveler : null })), cost: sum(trips, (t) => t.total_estimate) },
    events: withPeople.filter((e) => e.attendees.length),
    otherEvents: withPeople.filter((e) => !e.attendees.length),
    objectives: objectives.map((o) => ({ ...o, owner: many ? o.owner : null })),
  };
}

/** Actual travel spend, estimated trip cost and marketing spend between two dates, against revenue billed. */
function expenses(s, entries, deals, start, end) {
  const people = inList(s.people);
  const travel = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM travel_actuals WHERE traveler_id IN (SELECT value FROM json_each(?))
    AND spent_on >= ? AND spent_on <= ?`).get(people, start, end).n;
  const estimated = db.prepare(`SELECT COALESCE(SUM(total_estimate), 0) AS n FROM trips WHERE traveler_id IN (SELECT value FROM json_each(?))
    AND date_from >= ? AND date_from <= ?`).get(people, start, end).n;
  const inRange = entries.filter((x) => x.spent_on >= start && x.spent_on <= end);
  // The BD team carries the company-wide marketing spend (spend tied to nobody) as well as its own people's.
  const marketing = spendFor(inRange, s.people) + (s.allBids ? sum(inRange.filter((x) => !x.shares.length), (x) => x.amount) : 0);
  const { billed: revenue } = bookToBill(deals, start, end);
  const total = travel + marketing;
  return { travel, travelEstimated: estimated, marketing, total, revenue, ratio: revenue ? total / revenue : null };
}


/** `basis` is how the yearly figures run: 'calendar' (this year to date) or 't4q' (the last four finished quarters). */
export function bdDashboard(s, basis = 'calendar') {
  const today = localToday();
  const year = Number(today.slice(0, 4));
  const thisQ = quarterFor(today);
  const qr = quarterRange(thisQ);
  const { list, deals } = money(s);
  const qualified = list.filter((t) => isOpen(t) && QUALIFIED_STAGES.includes(t.pipeline_status));
  const t = targets(year, s.director);
  const qt = qualifiedTargets(year, s.director);
  const booked = (start, end = today) => sum(deals.filter((p) => p.awarded_on >= start && p.awarded_on <= end), (p) => p.value);
  const billed = (start, end = today) => bookToBill(deals, start, end).billed;
  // The yearly figures' span: this calendar year (to date, for money in), or the trailing four quarters.
  const t4q = basis === 't4q' && trailingQuarters();
  const yr = t4q ? { label: t4q.label, start: t4q.start, end: t4q.end, target: quartersTarget(t4q.quarters, s.director) }
    : { label: String(year), start: `${year}-01-01`, end: today, target: t.total };

  // Expected bookings from the Qualified+ pipeline: dated by the end of this year's Q4, and everything (dated or not).
  const yearEnd = `${year}-12-31`;
  const dated = qualified.filter((x) => x.projected_win_date && !x.win_date_undetermined);
  const byQ4 = dated.filter((x) => x.projected_win_date >= today && x.projected_win_date <= yearEnd);
  const overdue = dated.filter((x) => x.projected_win_date < today);
  const undated = qualified.filter((x) => !x.projected_win_date || x.win_date_undetermined);

  let entries = spendEntries({ from: `${year - 2}-01-01` });
  if (s.territory) entries = entries.filter((x) => x.resolved_territory_id === s.territory);
  const exp = expected(qualified, 6);
  const past = quarters(8, -7);
  // Qualified+ pipeline over the last 12 months, from the ticket history (one director, or the BD team's whole pipeline).
  const tr = trends({ from: addDays(today, -365), to: today, interval: 'month', by: 'stage', f: { director: s.director, territory: s.territory } });
  const qualTrend = tr.points.map((p, i) => sum(tr.series.filter((x) => QUALIFIED_STAGES.includes(x.key)), (x) => x.values[i]));

  return {
    scope: { kind: s.kind, label: s.label, director: s.director, team: s.team || null, territory: s.territory },
    todo: todo(s),
    top: {
      qualified: {
        count: qualified.length, value: sum(qualified, (x) => x.value), weighted: sum(qualified, weighted),
        // The qualified pipeline to hold: this quarter's target, and the year-end one.
        target: qt.quarters[Number(thisQ.slice(-1)) - 1] || null, yearTarget: qt.total || null,
      },
      booked: {
        quarter: { label: thisQ, value: booked(qr.start), target: t.quarters[Number(thisQ.slice(-1)) - 1] || null },
        year: { label: yr.label, value: booked(yr.start, yr.end), target: yr.target || null },
      },
      revenue: { quarter: { label: thisQ, value: billed(qr.start) }, year: { label: yr.label, value: billed(yr.start, yr.end) } },
      expected: {
        through: `${year} Q4`,
        byQ4: { count: byQ4.length, weighted: sum(byQ4, weighted), value: sum(byQ4, (x) => x.value), withPwin: byQ4.filter((x) => x.pwin != null).length },
        dated: { count: dated.length, weighted: sum(dated, weighted) },
        undated: { count: undated.length, weighted: sum(undated, weighted) },
        overdue: { count: overdue.length, weighted: sum(overdue, weighted) },
        all: { count: qualified.length, weighted: sum(qualified, weighted) },
      },
      expenses: { quarter: { label: thisQ, ...expenses(s, entries, deals, qr.start, qr.end) }, year: { label: yr.label, ...expenses(s, entries, deals, yr.start, t4q ? yr.end : yearEnd) } },
    },
    basis: t4q ? 't4q' : 'calendar',
    // Per person in a team: what each spent and brought in over the year (calendar or trailing).
    people: s.kind === 'team' ? spendByPerson(s, entries, deals, yr.start, t4q ? yr.end : yearEnd) : null,
    numbers: {
      bookings: bookingsByQuarter(deals, 8),
      revenue: past.map((q) => ({ quarter: q, value: bookToBill(deals, quarterRange(q).start, quarterRange(q).end).billed })),
      closings: {
        quarters: exp.quarters.map((x) => ({ quarter: x.quarter, count: x.count, value: x.value, weighted: x.weighted, adjusted: x.adjusted, unadjusted: x.unadjusted })),
        later: exp.later, overdue: exp.overdue, undetermined: exp.undetermined, unscheduled: exp.unscheduled,
      },
      qualified: {
        stages: stageRows(qualified),
        byTerritory: qualifiedBy(list, 'territory'),
        byDirector: s.kind === 'team' ? qualifiedBy(list, 'director').map((g) => ({ ...g, stages: stageRows(qualified.filter((k) => k.bd_director_id === g.id)) })) : null,
        trend: { points: tr.points, values: qualTrend },
        // Week to week, each person's own line (one line for a person's dashboard).
        byPerson: pipelineByPerson({ ids: s.director ? [s.director] : s.people, f: { territory: s.territory } }),
      },
      bookToBill: {
        quarters: bookToBillSeries(deals, past),
        ttm: bookToBill(deals, addDays(today, -365), today),
        quarter: bookToBill(deals, qr.start, today),
        fundedTtm: fundedTtm(deals, today),
        backlog: backlog(deals),
      },
    },
  };
}

/** Qualified+ pipeline tickets stage by stage: how many, their full value, and PWIN-adjusted. */
const stageRows = (xs) => byStage(xs, QUALIFIED_STAGES).map((x) => ({ ...x, weighted: sum(xs.filter((k) => k.pipeline_status === x.stage), weighted) }));

/** For a team: each person's travel and marketing spend, bookings and revenue over a period. */
function spendByPerson(s, entries, deals, start, end) {
  const users = db.prepare(`SELECT id, first_name || ' ' || last_name AS name FROM users WHERE id IN (SELECT value FROM json_each(?)) ORDER BY first_name, last_name`)
    .all(inList(s.people));
  return users.map((u) => {
    const one = { ...s, kind: 'person', people: [u.id], director: u.id, allBids: false };
    const mine = deals.filter((p) => p.bd_director_id === u.id);
    const e = expenses(one, entries, mine, start, end);
    return { id: u.id, name: u.name, ...e, booked: sum(mine.filter((p) => p.awarded_on >= start && p.awarded_on <= end), (p) => p.value) };
  }).filter((p) => p.total || p.booked || p.revenue || p.travelEstimated);
}
