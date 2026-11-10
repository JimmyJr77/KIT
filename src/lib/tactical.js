// The Tactical Meeting Report's headline numbers and cheat sheet, shared by the page and the one-slide PowerPoint.
// Plain JavaScript (no React), so it runs in the browser and Node alike.
import { shortDate } from './format.js';

/** $1.2M, $850K, $0 (as the charts print money). */
export function compact(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** "+$1.2M" / "−$300K" / "no change" (under $500 either way is rounding, not a change). */
export const signed = (n) => (!n || Math.abs(n) < 500 ? 'no change' : `${n > 0 ? '+' : '−'}${compact(Math.abs(n))}`);
/** 1, −1 or 0 for a change worth coloring (the same $500 floor as signed). */
export const toneOf = (n) => (!n || Math.abs(n) < 500 ? 0 : Math.sign(n));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Nov 2 – Nov 8, 2026" (to today, mid-week). */
export const weekLabel = (w) => `${shortDate(w.start)} – ${shortDate(w.to, { month: 'short', day: 'numeric', year: 'numeric' })}${w.current ? ' (so far)' : ''}`;

/** The stages' colors on the overview's timeline: Qualified quietest, deepening toward Under Evaluation. */
export const STAGE_COLORS = { Qualified: '#93C5FD', Capture: '#2A78D6', Proposal: '#1D4ED8', 'Under Evaluation': '#14204F' };

/**
 * The by-person table's columns, in the order the page and slide 2 show them: { key, label, value(row), tone? }. Rows
 * are the report's byPerson, plus a total.
 */
export function personColumns() {
  return [
    { key: 'qualified', label: 'Qualified pipeline', value: (p) => compact(p.qualified) },
    { key: 'qualifiedChange', label: 'This week', value: (p) => (toneOf(p.qualifiedChange) ? signed(p.qualifiedChange) : '—'), tone: (p) => toneOf(p.qualifiedChange) },
    { key: 'won', label: 'Qualified → Awarded', value: (p) => p.won },
    { key: 'down', label: 'Downgraded or removed', value: (p) => p.downgradedOrRemoved },
    { key: 'steps', label: 'Next steps completed', value: (p) => p.steps },
    { key: 'forward', label: 'Moved left to right', value: (p) => p.forward },
    { key: 'closed', label: 'Closed (won · lost)', value: (p) => (p.closed ? `${p.closed} (${p.won} · ${p.lost})` : 0) },
  ];
}
/** The by-person table's total row, from the report's team figures. */
export const totalRow = (r) => ({ id: 'total', name: 'Total', qualified: r.qualified.total.now, qualifiedChange: r.qualified.total.change, ...r.counts });

/**
 * The headline numbers and the cheat sheet's sections, in the order both the page and the slide show them. Each section
 * lists its tickets as { key, id, title, detail }. `team`: name each ticket's BD director.
 */
export function tacticalSections(r, team) {
  const { counts: c, lists: l } = r;
  const line = (x, ...rest) => [team && x.director, ...rest].filter(Boolean).join(' · ');
  // Next steps, one line per ticket: its steps in the order they were done.
  const byTicket = new Map();
  l.steps.forEach((s) => {
    if (!byTicket.has(s.ticket_id)) byTicket.set(s.ticket_id, { ...s, texts: [] });
    byTicket.get(s.ticket_id).texts.push(s.text);
  });
  const tiles = [
    { key: 'qualified', label: 'Qualified pipeline', value: compact(r.qualified.total.now), note: `${signed(r.qualified.total.change)} this week`, tone: toneOf(r.qualified.total.change) },
    { key: 'won', label: 'Qualified → Awarded', value: c.won, note: c.won ? `${compact(c.wonValue)} won${c.wonBeforeQualified ? ` · ${c.wonBeforeQualified} from before Qualified` : ''}` : 'None won' },
    { key: 'down', label: 'Downgraded or removed', value: c.downgradedOrRemoved, note: `${c.back} moved back · ${c.removed} off the board` },
    { key: 'steps', label: 'Next steps completed', value: c.steps, note: c.steps ? `On ${plural(c.stepTickets, 'ticket')}` : 'None completed' },
    { key: 'forward', label: 'Moved left to right', value: c.forward, note: 'Forward a stage or more' },
    { key: 'closed', label: 'Closed', value: c.closed, note: `${c.won} won · ${c.lost} lost` },
  ];
  const sections = [
    { key: 'won', title: 'Won · into Awarded', items: l.won.map((x) => ({ key: x.id, id: x.id, title: x.title, detail: line(x, x.from && `from ${x.from}`, x.value ? compact(x.value) : null) })) },
    { key: 'lost', title: 'Lost', items: l.lost.map((x) => ({ key: x.id, id: x.id, title: x.title, detail: line(x, x.from && `from ${x.from}`, x.lostReason) })) },
    { key: 'forward', title: 'Moved left to right', items: l.forward.map((x) => ({ key: x.id, id: x.id, title: x.title, detail: line(x, `${x.from} → ${x.to}`) })) },
    { key: 'back', title: 'Downgraded', items: l.back.map((x) => ({ key: x.id, id: x.id, title: x.title, detail: line(x, `${x.from} → ${x.to}`) })) },
    { key: 'removed', title: 'Removed from the board', items: l.removed.map((x) => ({ key: x.id, id: x.id, title: x.title, detail: line(x, x.how, x.stage) })) },
    { key: 'steps', title: 'Next steps completed', items: [...byTicket.values()].map((x) => ({ key: x.ticket_id, id: x.ticket_id, title: x.title, detail: line(x, x.texts.join('; ')) })) },
  ];
  return { tiles, sections };
}
