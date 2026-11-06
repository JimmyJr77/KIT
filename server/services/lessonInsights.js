// KIT on the Lessons Learned page: the assistant answers questions from the lesson records themselves, and the trend
// report assesses a date range period by period. Both get their lessons from listLessons (the same visibility as the
// page), scoped by a date range on the retro date, or the day the lesson was logged when it has none. The counts in the
// trend report are computed here from the lessons; Gemini writes the assessment around them, never the numbers.
import { db } from '../db.js';
import { generate, generateJson, geminiModel } from './gemini.js';

/** Gemini's errors arrive as JSON in the message; this gives the sentence, and tries twice more when the model is busy. */
const geminiMessage = (e) => { try { return JSON.parse(e.message).error?.message || e.message; } catch { return e.message; } };
const busy = (e) => /UNAVAILABLE|RESOURCE_EXHAUSTED|"code":(503|429)|high demand|overloaded/i.test(e.message || '');
async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt < 2 && busy(e)) { await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); continue; }
      throw new Error(busy(e) ? `KIT’s model is busy right now (${geminiMessage(e)}). Try again in a moment.` : geminiMessage(e));
    }
  }
}

const lessonNo = (l) => `LL-${String(l.id).padStart(3, '0')}`;
/** The date a lesson counts on: its retro date, or else the day it was logged. */
export const lessonDate = (l) => l.retro_date || String(l.created_at).slice(0, 10);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
/** A YYYY-MM-DD from the request, or null for no bound. */
export const dateOrNull = (s) => (isDate(s) ? s : null);

export function inRange(lessons, from, to) {
  return lessons.filter((l) => {
    const d = lessonDate(l);
    return (!from || d >= from) && (!to || d <= to);
  });
}

const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
/** "from Jan 1 to Jun 30, 2026", "since Jan 1, 2026", "through Jun 30, 2026" or "all time". */
export function rangeLabel(from, to) {
  if (from && to) return `from ${longDate(from)} to ${longDate(to)}`;
  if (from) return `since ${longDate(from)}`;
  if (to) return `through ${longDate(to)}`;
  return 'all time';
}

const author = (l) => (l.author_first_name ? `${l.author_first_name} ${l.author_last_name}` : 'a former user');
const KIND = { good: 'Good / Keep', bad: 'Bad / Change' };

/** One lesson as a record KIT reads. Every field the page shows is here, so an answer can quote the record. */
function lessonRecord(l) {
  const lines = [
    `${lessonNo(l)} · ${l.title}`,
    `Verdict: ${KIND[l.kind] || l.kind} · Action: ${l.action}`,
    `Date: ${lessonDate(l)}${l.retro_date ? ' (retro date)' : ' (date logged; no retro date)'} · Logged by ${author(l)} on ${String(l.created_at).slice(0, 10)}`,
    `Source: ${l.source === 'retro' ? `retrospective${l.retro_name ? ` “${l.retro_name}”` : ''}` : 'written by hand'}`,
    `Tags: ${l.tags.length ? l.tags.map((t) => t.name).join(', ') : 'none'}`,
    `Context: ${l.context || '(none)'}`,
    `Problem: ${l.problem || '(none)'}`,
    `Solution recorded by the team: ${l.solution || '(none recorded)'}`,
  ];
  return lines.join('\n');
}

export function lessonContext(lessons) {
  return lessons.map(lessonRecord).join('\n\n');
}

const ASSISTANT_SYSTEM = `You are KIT, the Knexus Intelligence Toolkit assistant for a business development team. You are answering
questions about the team's Lessons Learned: short records of what worked (Good / Keep) and what didn't (Bad / Change),
each with a Lesson Learned number like LL-012, tags, a context, a problem and the solution the team recorded.

Rules:
- Answer only from the lesson records given in the conversation. Never use outside knowledge about the team, and never
  invent lessons, dates, people or details. If the records don't cover the question, say so plainly.
- Be accurate and specific: name the lessons you draw on by number and title, and quote or closely paraphrase the record.
- Keep the team's recorded solutions apart from your own ideas. When you suggest remediation steps, put them under a
  heading "KIT's suggestions" and keep what the team recorded under "Recorded by the team". Never present a suggestion
  of yours as something the team decided.
- When asked about trends or recurrence, compare dates: say which periods a problem appears in, whether a recorded fix
  was followed by the same problem again (the fix didn't stick) or by a Good lesson (it did), and what is new.
- Only lessons in the date range are provided; say so if the question seems to reach outside it.
- Write in plain words, with short headings and bullet points where they help. No preamble.`;

/**
 * Answer `question` from `lessons`, with the earlier turns of the conversation (`history`: [{ role: 'user' | 'kit', text }])
 * for follow-ups. Returns the answer text.
 */
export async function askAboutLessons({ question, lessons, from, to, history = [] }) {
  const turns = history.slice(-8).map((h) => `${h.role === 'kit' ? 'KIT' : 'User'}: ${h.text}`).join('\n\n');
  const prompt = [
    `Lesson records in scope: ${lessons.length} lesson${lessons.length === 1 ? '' : 's'}, ${rangeLabel(from, to)} (by retro date, or the date logged when there is none).`,
    lessons.length ? lessonContext(lessons) : '(No lessons in this date range.)',
    turns ? `Conversation so far:\n\n${turns}` : '',
    `User: ${question}`,
    'KIT:',
  ].filter(Boolean).join('\n\n---\n\n');
  return withRetry(() => generate(prompt, { system: ASSISTANT_SYSTEM }));
}

// ---- Trend report

const pad = (n) => String(n).padStart(2, '0');
const monthKey = (d) => d.slice(0, 7);
const quarterKey = (d) => `${d.slice(0, 4)} Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** Period keys covering from..to in order, so an empty month or quarter still shows. */
function periodKeys(from, to, period) {
  const keys = [];
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const step = period === 'quarter' ? 3 : 1;
  if (period === 'quarter') m -= (m - 1) % 3;
  const endKey = period === 'quarter' ? quarterKey(to) : monthKey(to);
  for (let i = 0; i < 400; i++) {
    const key = period === 'quarter' ? `${y} Q${Math.floor((m - 1) / 3) + 1}` : `${y}-${pad(m)}`;
    keys.push(key);
    if (key === endKey) break;
    m += step;
    if (m > 12) { m -= 12; y += 1; }
  }
  return keys;
}

/** Months or quarters: quarters once the range is longer than about nine months. */
export function choosePeriod(from, to, wanted) {
  if (wanted === 'month' || wanted === 'quarter') return wanted;
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  return months > 9 ? 'quarter' : 'month';
}

/**
 * The counts behind the report, from the lessons alone: per period (good, bad, with and without a recorded solution,
 * lessons per tag), totals per tag, and the themes (tags) that recur across periods, with whether a recorded fix was
 * followed by the same problem again. `from`/`to` are the actual bounds (all-time ranges are closed over the data).
 */
export function trendStats(lessons, from, to, period) {
  const keyOf = period === 'quarter' ? quarterKey : monthKey;
  const labelOf = period === 'quarter' ? (k) => k : monthLabel;
  const keys = periodKeys(from, to, period);
  const byPeriod = new Map(keys.map((k) => [k, []]));
  lessons.forEach((l) => byPeriod.get(keyOf(lessonDate(l)))?.push(l));

  const periods = keys.map((key) => {
    const ls = byPeriod.get(key);
    const bad = ls.filter((l) => l.kind === 'bad');
    const tags = {};
    ls.forEach((l) => l.tags.forEach((t) => { tags[t.name] = (tags[t.name] || 0) + 1; }));
    const badTags = {};
    bad.forEach((l) => l.tags.forEach((t) => { badTags[t.name] = (badTags[t.name] || 0) + 1; }));
    return {
      key, label: labelOf(key), total: ls.length, good: ls.length - bad.length, bad: bad.length,
      bad_with_solution: bad.filter((l) => l.solution).length, bad_without_solution: bad.filter((l) => !l.solution).length,
      change: ls.filter((l) => l.action === 'change').length,
      tags, bad_tags: badTags, lesson_numbers: ls.map(lessonNo),
    };
  });

  const tagTotals = {};
  lessons.forEach((l) => l.tags.forEach((t) => { tagTotals[t.name] = (tagTotals[t.name] || 0) + 1; }));

  // A theme recurs when bad lessons carry the same tag in more than one period. A fix "didn't stick" when a bad lesson
  // with a recorded solution is followed, in a later period, by another bad lesson with the tag.
  const themes = Object.keys(tagTotals).map((tag) => {
    const badIn = periods.filter((p) => p.bad_tags[tag]);
    const goodIn = periods.filter((p) => (p.tags[tag] || 0) > (p.bad_tags[tag] || 0));
    const badLessons = lessons.filter((l) => l.kind === 'bad' && l.tags.some((t) => t.name === tag)).sort((a, b) => lessonDate(a).localeCompare(lessonDate(b)));
    const firstSolved = badLessons.find((l) => l.solution);
    const recurredAfterFix = !!firstSolved && badLessons.some((l) => l.kind === 'bad' && keyOf(lessonDate(l)) > keyOf(lessonDate(firstSolved)));
    const lastBad = badLessons.at(-1);
    const goodAfterLastBad = !!lastBad && lessons.some((l) => l.kind === 'good' && l.tags.some((t) => t.name === tag) && keyOf(lessonDate(l)) > keyOf(lessonDate(lastBad)));
    return {
      tag, total: tagTotals[tag], bad: badLessons.length, good: tagTotals[tag] - badLessons.length,
      bad_periods: badIn.map((p) => p.label), good_periods: goodIn.map((p) => p.label),
      bad_without_solution: badLessons.filter((l) => !l.solution).length,
      recurred_after_fix: recurredAfterFix, good_after_last_bad: goodAfterLastBad,
      first_seen: periods.find((p) => p.tags[tag])?.label || null, last_seen: [...periods].reverse().find((p) => p.tags[tag])?.label || null,
      lesson_numbers: lessons.filter((l) => l.tags.some((t) => t.name === tag)).map(lessonNo),
    };
  }).sort((a, b) => b.bad - a.bad || b.total - a.total || a.tag.localeCompare(b.tag));

  const bad = lessons.filter((l) => l.kind === 'bad');
  return {
    from, to, period, generated_for: { lessons: lessons.length, good: lessons.length - bad.length, bad: bad.length,
      bad_with_solution: bad.filter((l) => l.solution).length, bad_without_solution: bad.filter((l) => !l.solution).length },
    periods, tag_totals: tagTotals, themes, recurring: themes.filter((t) => t.bad_periods.length > 1),
  };
}

const str = { type: 'string' };
const strList = { type: 'array', items: str };
const items = (props, required = Object.keys(props)) => ({ type: 'array', items: { type: 'object', properties: props, required } });
/** The report's fixed shape, so it renders as sections. Lesson numbers are "LL-012" strings from the records. */
export const TREND_SCHEMA = {
  type: 'object',
  properties: {
    headline: str,
    overview: str,
    problem_areas: items({
      theme: str, trend: { type: 'string', enum: ['rising', 'falling', 'steady', 'new', 'gone'] }, tags: strList, lesson_numbers: strList, assessment: str,
    }),
    solutioning: {
      type: 'object',
      properties: {
        assessment: str,
        solved: items({ problem: str, lesson_numbers: strList, what_the_team_did: str, evidence_it_stuck: str }),
        recurring_without_solution: items({ problem: str, lesson_numbers: strList, why_it_persists: str, kit_suggestion: str }),
      },
      required: ['assessment', 'solved', 'recurring_without_solution'],
    },
    change_over_time: {
      type: 'object',
      properties: {
        improved: items({ item: str, evidence: str, lesson_numbers: strList }),
        worsened: items({ item: str, evidence: str, lesson_numbers: strList }),
        new_this_range: items({ item: str, evidence: str, lesson_numbers: strList }),
      },
      required: ['improved', 'worsened', 'new_this_range'],
    },
    periods: items({ period: str, summary: str }),
    kit_recommendations: strList,
  },
  required: ['headline', 'overview', 'problem_areas', 'solutioning', 'change_over_time', 'periods', 'kit_recommendations'],
};

const REPORT_SYSTEM = `You are KIT, the Knexus Intelligence Toolkit assistant for a business development team, writing a trend
report over the team's Lessons Learned for a date range split into periods. You are given the lesson records and the
counts already computed from them (lessons per period, good and bad, bad lessons with and without a recorded solution,
lessons per tag, and the themes that recur). Assess, don't recount: the numbers are the team's, quote them as given and
never compute new ones. Base every statement on the records; name the lessons behind each point by their LL numbers.
Keep the team's recorded solutions apart from your own ideas: a solution is the team's only when a record says so, and
anything of your own goes in kit_suggestion or kit_recommendations. Say what improved (a problem followed by a Good
lesson or no recurrence), what got worse (a problem that recurs or grows), and what is new to the latest periods.
Where the range has too few lessons to judge, say that rather than stretching. Plain words, short sentences.`;

/** Gemini's assessment of `lessons` over `stats`'s periods, in TREND_SCHEMA. */
export async function generateTrendReport(lessons, stats) {
  const prompt = [
    `Date range: ${rangeLabel(stats.from, stats.to)}, in ${stats.period === 'quarter' ? 'quarters' : 'months'}. Periods: ${stats.periods.map((p) => p.label).join(', ')}.`,
    `Counts computed from the lessons (use these as given):\n${JSON.stringify({
      totals: stats.generated_for,
      periods: stats.periods.map(({ key, lesson_numbers, ...p }) => p),
      recurring_themes: stats.recurring, other_themes: stats.themes.filter((t) => t.bad_periods.length <= 1).map(({ tag, total, bad, first_seen, last_seen }) => ({ tag, total, bad, first_seen, last_seen })),
    }, null, 1)}`,
    `Lesson records (${lessons.length}):\n\n${lessonContext(lessons)}`,
    'Write the trend report.',
  ].join('\n\n---\n\n');
  return withRetry(() => generateJson(prompt, TREND_SCHEMA, { system: REPORT_SYSTEM }));
}

/** The latest stored report, with its stats and report parsed, or null. */
export function latestTrendReport() {
  const row = db.prepare(`SELECT r.*, u.first_name, u.last_name FROM lesson_trend_reports r LEFT JOIN users u ON u.id = r.generated_by
    ORDER BY r.id DESC LIMIT 1`).get();
  if (!row) return null;
  return {
    id: row.id, from: row.from_date, to: row.to_date, period: row.period, model: row.model, generated_at: row.generated_at,
    generated_by: row.first_name ? `${row.first_name} ${row.last_name}` : null,
    stats: JSON.parse(row.stats), report: JSON.parse(row.report),
  };
}

/** Keep `report` as the latest; earlier ones go, so the table never grows. */
export function storeTrendReport({ from, to, period, stats, report, userId }) {
  db.transaction(() => {
    db.prepare('DELETE FROM lesson_trend_reports').run();
    db.prepare(`INSERT INTO lesson_trend_reports (from_date, to_date, period, stats, report, model, generated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(from, to, period, JSON.stringify(stats), JSON.stringify(report), geminiModel(), userId);
  })();
  return latestTrendReport();
}
