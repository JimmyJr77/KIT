// The BD report as an editable PowerPoint deck: native charts and tables (not pictures), so numbers can be restyled,
// re-labeled or copied. Takes a PptxGenJS instance, the report data the Reports page shows, and the Knexus name marks
// ({ nameOnLight, nameOnDark } as data URLs); works in the browser and Node.
import { shortDate } from './format.js';

const FONT = 'Calibri';
const INK = '0F172A';
const MUTED = '64748B';
const LINE = 'E2E8F0';
const PANEL = 'F8FAFC';
const NAVY = '14204F';
const BRAND = '253B9C';
const SERIES = ['2A78D6', 'EB6834']; // the dashboards' first two categorical slots
const STATUS = {
  good: { text: '✓ On track', mark: '✓', color: '047857', fill: 'ECFDF5' },
  watch: { text: '! Watch', mark: '!', color: '92400E', fill: 'FFFBEB' },
  behind: { text: '✕ Behind', mark: '✕', color: 'B91C1C', fill: 'FEF2F2' },
  none: { text: '– Not enough data', mark: '', color: MUTED },
};
// Charts read like the tiles: $1.3B, $80M, $255K, and nothing at all for a zero.
const SHORT_MONEY = '[>=1000000000]$0.0,,,"B";[>=1000000]$0.0,,"M";$#,##0,"K"';

// The slide is 13.33 × 7.5 in. Everything sits between TOP and BOTTOM, which keeps it clear of the title and footer.
const LEFT = 0.5;
const WIDTH = 12.33;
const TOP = 1.45;
const BOTTOM = 6.85;
// The name mark is 1848 × 260. On content slides it sits at the top right, so titles stop short of it.
const NAME_RATIO = 1848 / 260;
const HEADER_LOGO_W = 1.42;
const TITLE_W = 10.6;

const money = (n) => {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};
const value = (m) => {
  if (m.display) return m.display;
  if (m.value == null) return '—';
  if (m.format === 'percent') return `${Math.round(m.value * 100)}%`;
  if (m.format === 'money') return money(m.value);
  if (m.format === 'ratio') return `${m.value.toFixed(1)}×`;
  return String(m.value);
};
const ratio = (r) => (r == null ? '—' : `${r.toFixed(2)}×`);
const name = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(' ');
const shortQuarter = (q) => `Q${q.slice(-1)} '${q.slice(2, 4)}`;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** A content slide: the title and subtitle over the shared top bar, footer and page number. */
function page(pptx, title, subtitle) {
  const s = pptx.addSlide({ masterName: 'REPORT' });
  s.addText(title, { x: LEFT, y: 0.3, w: TITLE_W, h: 0.6, margin: 0, fontFace: FONT, fontSize: 28, bold: true, color: NAVY });
  if (subtitle) s.addText(subtitle, { x: LEFT, y: 0.88, w: TITLE_W, h: 0.35, margin: 0, fontFace: FONT, fontSize: 14, color: MUTED });
  return s;
}

const MARGIN = [0.03, 0.08, 0.03, 0.08];
/** A table cell: plain text, or an array of styled runs (kept as is). */
const cell = (text, opts = {}) => ({ text: Array.isArray(text) ? text : String(text ?? ''), options: { fontFace: FONT, fontSize: 11, color: INK, valign: 'middle', margin: MARGIN, ...opts } });
const head = (text, align) => cell(text, { bold: true, color: 'FFFFFF', fontSize: 10, fill: { color: NAVY }, align });
const right = (text, opts) => cell(text, { align: 'right', ...opts });
const RULES = [{ type: 'none' }, { type: 'none' }, { type: 'solid', pt: 0.5, color: LINE }, { type: 'none' }];

/** Rows are set to known heights so a table's full size is known before it is placed. */
const addTable = (s, header, rows, { x = LEFT, y = TOP, colW, rowH = 0.3, headH = 0.36 }) => {
  const heights = rows.map((row, i) => (typeof rowH === 'function' ? rowH(row, i) : rowH));
  s.addTable([header, ...rows], { x, y, w: sum(colW), colW, rowH: [headH, ...heights], border: RULES });
};

/** Split rows into runs that each fit the room on a slide, the header included. Rows are never divided. */
function paginate(rows, heightOf, headH, firstRoom, room) {
  const runs = [[]];
  let used = headH;
  rows.forEach((row) => {
    const h = heightOf(row);
    if (runs[runs.length - 1].length && used + h > (runs.length === 1 ? firstRoom : room)) {
      runs.push([]);
      used = headH;
    }
    runs[runs.length - 1].push(row);
    used += h;
  });
  return runs;
}

/**
 * A table across as many slides as it takes, each with the title, header and page count. Long tables are paged here rather
 * than by PptxGenJS's autoPage, which guesses at row heights and leaves rows hanging off the slide. `firstY` leaves room
 * above the table on its first slide, for `lead` to fill.
 */
function tableSlides(pptx, { title, subtitle, header, rows, colW, rowH = () => 0.3, headH = 0.36, firstY = TOP, lead }) {
  const runs = paginate(rows, rowH, headH, BOTTOM - firstY, BOTTOM - TOP);
  runs.forEach((run, i) => {
    const s = page(pptx, runs.length > 1 ? `${title} · ${i + 1} of ${runs.length}` : title, subtitle);
    if (i === 0) lead?.(s);
    addTable(s, header, run, { y: i === 0 ? firstY : TOP, colW, rowH, headH });
  });
}

/** A headline number: the label, the figure, and a note under it. */
function tile(pptx, s, { x, y, w, h, label, big, note, size = 32, accent = BRAND }) {
  s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: PANEL }, line: { color: LINE, width: 0.75 } });
  s.addShape(pptx.ShapeType.rect, { x, y, w: 0.06, h, fill: { color: accent }, line: { color: accent, width: 0 } });
  const inner = { x: x + 0.22, w: w - 0.34, margin: 0, fontFace: FONT };
  s.addText(label, { ...inner, y: y + 0.1, h: h * 0.26, fontSize: 12, bold: true, color: MUTED, valign: 'top' });
  s.addText(big, { ...inner, y: y + 0.1 + h * 0.26, h: h * 0.38, fontSize: size, bold: true, color: INK, valign: 'middle' });
  if (note) s.addText(note, { ...inner, y: y + 0.1 + h * 0.64, h: h * 0.3, fontSize: 11, color: MUTED, valign: 'top' });
}
/** A row of equal tiles across the slide. */
function tiles(pptx, s, y, h, items, opts) {
  const gap = 0.2;
  const w = (WIDTH - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => tile(pptx, s, { x: LEFT + i * (w + gap), y, w, h, ...item, ...opts }));
}

const chartBase = {
  catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, catAxisLabelFrequency: 1,
  catAxisLabelColor: INK, valAxisLabelColor: MUTED, valGridLine: { color: LINE, style: 'solid', size: 0.5 }, catGridLine: { style: 'none' },
  valAxisLineShow: false, valAxisLabelFormatCode: SHORT_MONEY, dataLabelFormatCode: SHORT_MONEY, dataLabelFontSize: 11, dataLabelFontFace: FONT,
  dataLabelFontBold: true, dataLabelColor: INK, legendFontFace: FONT, legendFontSize: 11, legendColor: MUTED,
};
/** Ranked bars: the value is printed on each bar, so the axis and grid stay out of the way. */
const rankedBars = (rows) => ({
  ...chartBase, barDir: 'bar', chartColors: [SERIES[0]], showValue: true, dataLabelPosition: 'outEnd', showLegend: false, catAxisOrientation: 'maxMin',
  barGapWidthPct: 45, valAxisHidden: true, valGridLine: { style: 'none' }, catAxisLabelFontSize: rows > 12 ? 10 : 11, dataLabelFontSize: rows > 12 ? 10 : 11,
});
/** Stacked columns beside a table of the exact figures, which small segments have no room to carry. */
const stacked = { ...chartBase, barDir: 'col', barGrouping: 'stacked', chartColors: SERIES, showLegend: true, legendPos: 'b', showValue: false, barGapWidthPct: 60 };

export function buildDeck(pptx, r, logos) {
  const { bd, card } = r;
  const m = Object.fromEntries(card.measures.map((x) => [x.key, x]));
  const q = bd.expected.quarters;
  const prepared = shortDate(r.prepared, { month: 'long', day: 'numeric', year: 'numeric' });
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `BD report · ${r.scope} · ${r.period}`;
  pptx.company = 'Knexus';
  pptx.defineSlideMaster({
    title: 'REPORT',
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: NAVY } } },
      { image: { x: LEFT + WIDTH - HEADER_LOGO_W, y: 0.42, w: HEADER_LOGO_W, h: HEADER_LOGO_W / NAME_RATIO, data: logos.nameOnLight } },
      { line: { x: LEFT, y: 7.0, w: WIDTH, h: 0, line: { color: LINE, width: 0.75 } } },
      { text: { text: `KIT · BD report · ${r.scope} · ${r.period}`, options: { x: LEFT, y: 7.05, w: 9, h: 0.3, margin: 0, fontFace: FONT, fontSize: 10, color: MUTED } } },
    ],
    slideNumber: { x: 11.83, y: 7.05, w: 1, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTED, align: 'right' },
  });

  // Title
  const t = pptx.addSlide();
  t.background = { color: NAVY };
  t.addImage({ x: 0.9, y: 1.45, w: 3.2, h: 3.2 / NAME_RATIO, data: logos.nameOnDark });
  t.addShape(pptx.ShapeType.rect, { x: 0.9, y: 2.25, w: 0.9, h: 0.06, fill: { color: SERIES[0] }, line: { color: SERIES[0], width: 0 } });
  t.addText('KIT · BD REPORT', { x: 0.9, y: 2.4, w: 11.5, h: 0.45, margin: 0, fontFace: FONT, fontSize: 16, bold: true, charSpacing: 2, color: 'C7D2FE' });
  t.addText(`${r.scope} · ${r.period}`, { x: 0.9, y: 2.85, w: 11.5, h: 1.1, margin: 0, fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF' });
  t.addText(`Prepared ${prepared}. Pipeline figures are as of that day; the report card covers ${r.period}.`, { x: 0.9, y: 4, w: 11.5, h: 0.5, margin: 0, fontFace: FONT, fontSize: 15, color: 'C7D2FE' });

  // At a glance
  const b2b = bd.bookToBill;
  const stalled = m.progression.stalled;
  const g = page(pptx, 'At a glance', `Pipeline figures as of ${prepared}`);
  tiles(pptx, g, TOP + 0.1, 2.35, [
    { label: `Booked, ${r.period}`, big: money(m.bookings.amount), note: m.bookings.target ? `${value(m.bookings)} of ${money(m.bookings.target)} target` : 'No target set' },
    { label: 'Qualified pipeline', big: money(bd.qualified.value), note: `${bd.qualified.count} PL tickets, Qualified onward` },
    { label: 'Expected, next 4 quarters', big: money(sum(q.map((x) => x.weighted))), note: `PWIN-weighted · ${money(bd.expected.undetermined.value)} undetermined` },
    { label: 'Backlog', big: money(bd.backlog.total), note: `${money(bd.backlog.fundedBacklog)} funded · ${money(bd.backlog.unfundedBacklog)} unfunded` },
  ], { size: 40 });
  const second = [m.winRate, m.coverage].filter(Boolean).map((x) => ({
    label: x.title, big: value(x), note: x.key === 'winRate' && x.valueRate != null ? `${Math.round(x.valueRate * 100)}% by value` : STATUS[x.status].text, accent: STATUS[x.status].color,
  }));
  tiles(pptx, g, TOP + 2.65, 2.35, [...second,
    { label: 'Book-to-bill, last 12 months', big: ratio(b2b.ttm.ratio), note: `${money(b2b.ttm.booked)} booked ÷ ${money(b2b.ttm.billed)} billed` },
    { label: 'Stalled pursuits', big: String(stalled.length), note: money(sum(stalled.map((x) => x.value || 0))), accent: stalled.length ? STATUS.watch.color : BRAND },
  ], { size: 40 });

  // Report card
  const rc = page(pptx, `Report card · ${r.period}`, 'Seven measures of whether we are performing and winning');
  addTable(rc, [head('Measure'), head('Result', 'right'), head('Status'), head('Detail')], card.measures.map((x) => {
    const st = STATUS[x.status];
    return [
      cell([{ text: x.title, options: { bold: true, fontSize: 13, breakLine: true } }, { text: x.question, options: { italic: true, fontSize: 10.5, color: MUTED } }]),
      right(value(x), { bold: true, fontSize: 18, color: NAVY }),
      cell(st.text, { color: st.color, fill: st.fill ? { color: st.fill } : undefined, bold: true, align: 'center' }),
      cell(x.detail, { fontSize: 11.5, color: INK }),
    ];
  }), { colW: [3.75, 1.1, 1.58, 5.9], rowH: 0.68 });

  // Report card by director (team report only). Each result on one line, its color and mark giving the status.
  if (r.directors?.length) {
    const first = 1.93;
    tableSlides(pptx, {
      title: 'Report card by BD director',
      subtitle: `${r.period} · ✓ On track   ! Watch   ✕ Behind   Unmarked: not enough data`,
      header: [head('BD director'), ...card.measures.map((x) => head(x.title, 'center'))],
      rows: r.directors.map(({ director, card: c }) => [
        cell(name(director), { bold: true, fontSize: 10.5 }),
        ...c.measures.map((x) => {
          const st = STATUS[x.status];
          return cell(`${value(x)}${st.mark ? `  ${st.mark}` : ''}`, { align: 'center', fontSize: 10.5, bold: !!st.fill, color: st.color, fill: st.fill ? { color: st.fill } : undefined });
        }),
      ]),
      colW: [first, ...card.measures.map(() => (WIDTH - first) / card.measures.length)],
      rowH: () => 0.26,
      headH: 0.46,
    });
  }

  // Pipeline by stage
  const ps = page(pptx, 'Pipeline by stage', 'Every pipeline ticket, open and closed, by value. Ticket counts in brackets.');
  ps.addChart(pptx.ChartType.bar, [{ name: 'Value', labels: bd.stages.map((s) => `${s.stage} (${s.count})`), values: bd.stages.map((s) => s.value) }],
    { ...rankedBars(bd.stages.length), x: LEFT, y: TOP, w: WIDTH, h: BOTTOM - TOP });

  // Qualified pipeline by territory and director
  const qp = page(pptx, 'Qualified pipeline', 'Open pipeline tickets, Qualified onward');
  [['By territory', bd.qualifiedByTerritory, LEFT], ['By BD director', bd.qualifiedByDirector, 6.93]].forEach(([title, rows, x]) => {
    qp.addText(title, { x, y: TOP - 0.05, w: 5.9, h: 0.35, margin: 0, fontFace: FONT, fontSize: 15, bold: true, color: NAVY });
    if (rows.length) {
      qp.addChart(pptx.ChartType.bar, [{ name: 'Value', labels: rows.map((g2) => g2.name), values: rows.map((g2) => g2.value) }],
        { ...rankedBars(rows.length), x, y: TOP + 0.3, w: 5.9, h: BOTTOM - TOP - 0.3 });
    } else qp.addText('No qualified pipeline tickets.', { x, y: TOP + 0.4, w: 5.9, h: 0.4, margin: 0, fontFace: FONT, fontSize: 13, color: MUTED });
  });

  // Projected bookings by quarter
  const ex = page(pptx, 'Projected bookings by quarter', 'Open pipeline tickets by projected win date. With a PWIN: value × PWIN. Without one: full value, shown apart.');
  ex.addChart(pptx.ChartType.bar, [
    { name: 'PWIN-adjusted (value × PWIN)', labels: q.map((x) => shortQuarter(x.quarter)), values: q.map((x) => x.adjusted.weighted) },
    { name: 'No PWIN yet (full value)', labels: q.map((x) => shortQuarter(x.quarter)), values: q.map((x) => x.unadjusted.value) },
  ], { ...stacked, x: LEFT, y: TOP, w: 7.4, h: BOTTOM - TOP });
  addTable(ex, [head('Quarter'), head('PWIN-adjusted', 'right'), head('No PWIN', 'right'), head('Total', 'right')],
    q.map((x) => [cell(shortQuarter(x.quarter)), right(money(x.adjusted.weighted)), right(money(x.unadjusted.value)), right(money(x.adjusted.weighted + x.unadjusted.value), { bold: true })]),
    { x: 8.13, y: TOP, colW: [1.1, 1.4, 1.1, 1.1], rowH: 0.34 });
  const pools = [['Undetermined', bd.expected.undetermined], ['Later', bd.expected.later], ['Overdue', bd.expected.overdue], ['No date set', bd.expected.unscheduled]];
  addTable(ex, [head('Not in a quarter'), head('Tickets', 'right'), head('Value', 'right')],
    pools.map(([l, b]) => [cell(l), right(b.count), right(money(b.value), { bold: true })]),
    { x: 8.13, y: TOP + 2.2, colW: [2.5, 1.1, 1.1], rowH: 0.34 });

  // Bookings funded and unfunded
  const by = bd.bookings.byQuarter;
  const bk = page(pptx, 'Bookings by quarter', "Contracts won, and how much of each quarter's wins is funded so far");
  bk.addChart(pptx.ChartType.bar, [
    { name: 'Funded', labels: by.map((x) => shortQuarter(x.quarter)), values: by.map((x) => x.funded) },
    { name: 'Unfunded', labels: by.map((x) => shortQuarter(x.quarter)), values: by.map((x) => x.unfunded) },
  ], { ...stacked, x: LEFT, y: TOP, w: 7.4, h: BOTTOM - TOP });
  addTable(bk, [head('Quarter'), head('Funded', 'right'), head('Unfunded', 'right'), head('Total', 'right')], [
    ...by.map((x) => [cell(shortQuarter(x.quarter)), right(money(x.funded)), right(money(x.unfunded)), right(money(x.funded + x.unfunded), { bold: true })]),
    [cell('Total', { bold: true, fill: { color: PANEL } }), ...[sum(by.map((x) => x.funded)), sum(by.map((x) => x.unfunded)), sum(by.map((x) => x.funded + x.unfunded))].map((n) => right(money(n), { bold: true, fill: { color: PANEL } }))],
  ], { x: 8.13, y: TOP, colW: [1.25, 1.15, 1.15, 1.15], rowH: 0.36 });

  // Backlog and book-to-bill. Directors that don't fit beside the quarters carry on to a slide of their own.
  const bl = bd.backlog;
  const bb = page(pptx, 'Backlog and book-to-bill', `${bl.contracts} active contracts`);
  tiles(pptx, bb, TOP, 1.3, [
    { label: 'Contract value', big: money(bl.value) },
    { label: 'Funded backlog', big: money(bl.fundedBacklog), note: 'Funded, not yet billed' },
    { label: 'Unfunded backlog', big: money(bl.unfundedBacklog), note: 'Not yet funded' },
    { label: 'Billed to date', big: money(bl.billed) },
  ], { size: 26 });
  const tablesY = TOP + 1.5;
  addTable(bb, [head('Quarter'), head('Booked', 'right'), head('Billed', 'right'), head('Book-to-bill', 'right')], [
    ...b2b.byQuarter.map((x) => [cell(x.quarter), right(money(x.booked)), right(money(x.billed)), right(ratio(x.ratio), { bold: true })]),
    [cell('Year to date', { bold: true, fill: { color: PANEL } }), ...[money(b2b.ytd.booked), money(b2b.ytd.billed), ratio(b2b.ytd.ratio)].map((n) => right(n, { bold: true, fill: { color: PANEL } }))],
  ], { y: tablesY, colW: [1.7, 1.4, 1.4, 1.4], rowH: 0.34 });
  const directorHead = [head('BD director, last 12 months'), head('Booked', 'right'), head('Billed', 'right'), head('Book-to-bill', 'right')];
  const directorRows = b2b.byDirector.map((x) => [cell(x.name), right(money(x.booked)), right(money(x.billed)), right(ratio(x.ratio), { bold: true })]);
  const beside = Math.floor((BOTTOM - tablesY - 0.36) / 0.3);
  if (directorRows.length) addTable(bb, directorHead, directorRows.slice(0, beside), { x: 6.93, y: tablesY, colW: [2.6, 1.05, 1.05, 1.2] });
  if (directorRows.length > beside) {
    tableSlides(pptx, { title: 'Book-to-bill by BD director, continued', subtitle: 'Last 12 months', header: directorHead, rows: directorRows.slice(beside), colW: [6, 2.1, 2.1, 2.13] });
  }

  // Stalled pursuits: a rollup by stage, the same numbers as the dashboard's cards. The tickets aren't listed.
  if (stalled.length) {
    const stages = m.progression.stalledStages || [...new Set(stalled.map((x) => x.stage))];
    const st = page(pptx, `Stalled pursuits (${stalled.length})`, 'Open pipeline tickets with no stage change in 45+ days, or past their projected win date');
    tiles(pptx, st, TOP, 1.4, stages.map((stage) => {
      const xs = stalled.filter((x) => x.stage === stage);
      return { label: stage, big: String(xs.length), note: money(sum(xs.map((x) => x.value || 0))), accent: STATUS.watch.color };
    }), { size: 28 });
  }
  return pptx;
}
