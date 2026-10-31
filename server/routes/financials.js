// Financials for the dashboards: BD pipeline, forecast, bookings, backlog and book-to-bill (see server/financials.js
// for what each figure means), how the pipeline changed over time, and spend by team.
import { Router } from 'express';
import { db } from '../db.js';
import { PIPELINE_STATUSES } from './priorities.js';
import {
  bids, contracts, filtersFrom, byStage, expected, qualifiedBy, bookingsByQuarter, backlog, bookToBill, bookToBillByDirector,
  targets, trends, quarters, quarterRange, localToday, OPEN_STAGES, QUALIFIED_STAGES,
} from '../financials.js';
import { addDays, quarterFor } from '../../src/lib/travelCalc.js';
import { reportCard, period, directors, THRESHOLDS } from '../reportCard.js';

const r = Router();
const sum = (rows, f) => rows.reduce((s, x) => s + (f(x) || 0), 0);

/** ?director=&territory= narrows everything to one BD director and/or territory. */
r.get('/bd', (req, res) => {
  const f = filtersFrom(req.query);
  const list = bids(f);
  const deals = contracts(f);
  const today = localToday();
  const year = Number(today.slice(0, 4));
  const ttmStart = addDays(today, -365);
  const open = list.filter((t) => OPEN_STAGES.includes(t.pipeline_status) || !t.pipeline_status);
  const qualified = list.filter((t) => QUALIFIED_STAGES.includes(t.pipeline_status));
  const ytd = bookToBill(deals, `${year}-01-01`, today);
  res.json({
    filters: f,
    open: { count: open.length, value: sum(open, (t) => t.value), weighted: sum(open, (t) => (t.value || 0) * (t.pwin ?? 1)) },
    qualified: { count: qualified.length, value: sum(qualified, (t) => t.value), weighted: sum(qualified, (t) => (t.value || 0) * (t.pwin ?? 1)) },
    stages: byStage(list, PIPELINE_STATUSES),
    expected: expected(list),
    qualifiedByTerritory: qualifiedBy(list, 'territory'),
    qualifiedByDirector: qualifiedBy(list, 'director'),
    bookings: { byQuarter: bookingsByQuarter(deals), ytd: ytd.booked, target: targets(year, f.director) },
    backlog: backlog(deals),
    bookToBill: {
      ytd, ttm: bookToBill(deals, ttmStart, today),
      byQuarter: quarters(4, -3).map((q) => ({ quarter: q, ...bookToBill(deals, quarterRange(q).start, quarterRange(q).end) })),
      byDirector: bookToBillByDirector(deals, ttmStart, today),
    },
  });
});

/** ?from=&to= (dates, default the last 12 months), interval=week|month|quarter|year, by=stage|director|territory. */
r.get('/trends', (req, res) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : localToday();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : addDays(to, -365);
  if (from > to) return res.status(400).json({ error: 'The start date must be before the end date' });
  const interval = ['week', 'month', 'quarter', 'year'].includes(req.query.interval) ? req.query.interval : 'month';
  const by = ['stage', 'director', 'territory'].includes(req.query.by) ? req.query.by : 'stage';
  res.json({ from, to, ...trends({ from, to, interval, by, f: filtersFrom(req.query) }) });
});

/**
 * Money by team. Travel: estimated trip spend this quarter and the next three, for trips by people on each team (someone
 * on two teams counts toward both). BD: pipeline and bookings. Operations: the contracts it delivers.
 */
r.get('/teams', (req, res) => {
  const qs = quarters(4);
  const teams = db.prepare('SELECT id, name FROM teams ORDER BY name').all();
  const trips = db.prepare(`SELECT t.quarter, t.total_estimate, ut.team_id FROM trips t JOIN user_teams ut ON ut.user_id = t.traveler_id
    WHERE t.quarter IN (SELECT value FROM json_each(?))`).all(JSON.stringify(qs));
  const list = bids();
  const deals = contracts();
  const year = localToday().slice(0, 4);
  res.json({
    quarters: qs,
    teams: teams.map((t) => {
      const mine = trips.filter((x) => x.team_id === t.id);
      return {
        ...t,
        people: db.prepare('SELECT COUNT(*) AS n FROM user_teams ut JOIN users u ON u.id = ut.user_id WHERE ut.team_id = ? AND u.active = 1').get(t.id).n,
        travel: { byQuarter: qs.map((q) => sum(mine.filter((x) => x.quarter === q), (x) => x.total_estimate)), total: sum(mine, (x) => x.total_estimate) },
      };
    }),
    bd: {
      openValue: sum(list.filter((t) => OPEN_STAGES.includes(t.pipeline_status)), (t) => t.value),
      bookedYtd: sum(deals.filter((p) => p.awarded_on >= `${year}-01-01`), (p) => p.value),
    },
    operations: {
      activeContracts: deals.filter((p) => p.status === 'Active').length,
      ...backlog(deals),
      billedThisQuarter: sum(deals.flatMap((p) => p.billings).filter((e) => e.entry_date >= quarterRange(quarterFor(localToday())).start), (e) => e.amount),
    },
  });
});

/**
 * The BD report card. ?kind=quarter|year&label=2026 Q4|2026 (default: this quarter). With ?director=<id>, that
 * director's card; without, the team's card and each director's.
 */
r.get('/report-card', (req, res) => {
  const kind = req.query.kind === 'year' ? 'year' : 'quarter';
  const label = kind === 'year' ? (/^\d{4}$/.test(req.query.label || '') ? req.query.label : undefined)
    : (/^\d{4} Q[1-4]$/.test(req.query.label || '') ? req.query.label : undefined);
  const p = period(kind, label);
  const director = Number(req.query.director) || null;
  if (director) return res.json({ card: reportCard(director, p), thresholds: THRESHOLDS });
  res.json({
    card: reportCard(null, p),
    directors: directors().map((d) => ({ director: d, card: reportCard(d.id, p) })),
    thresholds: THRESHOLDS,
  });
});

export default r;
