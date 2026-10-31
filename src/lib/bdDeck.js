// The BD report as an editable PowerPoint deck: native charts and tables (not pictures), so numbers can be restyled,
// re-labeled or copied. Takes a PptxGenJS instance and the report data the Reports page shows; works in the browser and Node.

const FONT = 'Calibri';
const INK = '0B0B0B';
const MUTED = '52514E';
const LINE = 'E7E5E4';
const BRAND = '253B9C';
const SERIES = ['2A78D6', 'EB6834']; // the dashboards' first two categorical slots
const STATUS = {
  good: { text: '✓ On track', color: '047857', fill: 'ECFDF5' },
  watch: { text: '! Watch', color: '92400E', fill: 'FFFBEB' },
  behind: { text: '✕ Behind', color: 'B91C1C', fill: 'FEF2F2' },
  none: { text: '– Not enough data', color: '64748B', fill: 'F8FAFC' },
};
const MILLIONS = '$#,##0.0,,"M"';

const money = (n) => {
  if (n == null) return '—';
  const a = Math.abs(n);
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

/** A slide with the standard title, optional subtitle, and footer. */
function page(pptx, title, subtitle, r) {
  const s = pptx.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addText(title, { x: 0.5, y: 0.35, w: 12.3, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: INK });
  if (subtitle) s.addText(subtitle, { x: 0.5, y: 0.9, w: 12.3, h: 0.4, fontFace: FONT, fontSize: 13, color: MUTED });
  s.addShape(pptx.ShapeType.line, { x: 0.5, y: 1.35, w: 12.3, h: 0, line: { color: LINE, width: 1 } });
  s.addText(`KIT · BD report · ${r.scope} · ${r.period}`, { x: 0.5, y: 7.05, w: 9, h: 0.3, fontFace: FONT, fontSize: 9, color: MUTED });
  return s;
}

/** A table cell: plain text, or an array of styled runs (kept as is). */
const cell = (text, opts = {}) => ({ text: Array.isArray(text) ? text : String(text ?? ''), options: { fontFace: FONT, fontSize: 11, color: INK, valign: 'middle', ...opts } });
const head = (text, align) => cell(text, { bold: true, color: MUTED, fontSize: 10, fill: { color: 'F8FAFC' }, align });
const TABLE = { x: 0.5, y: 1.6, w: 12.3, border: { type: 'solid', pt: 0.5, color: LINE }, autoPage: true, autoPageRepeatHeader: true, newSlideStartY: 1.6 };

const chartBase = {
  catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
  catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, valGridLine: { color: LINE, style: 'solid', size: 0.5 }, catGridLine: { style: 'none' },
  valAxisLabelFormatCode: MILLIONS, dataLabelFormatCode: MILLIONS, dataLabelFontSize: 10, dataLabelFontFace: FONT, dataLabelColor: INK,
  legendFontFace: FONT, legendFontSize: 11, legendColor: MUTED,
};

export function buildDeck(pptx, r) {
  const { bd, card } = r;
  const m = Object.fromEntries(card.measures.map((x) => [x.key, x]));
  const q = bd.expected.quarters;
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `BD report · ${r.scope} · ${r.period}`;
  pptx.company = 'Knexus';

  // 1. Title
  const t = pptx.addSlide();
  t.background = { color: 'FFFFFF' };
  t.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: BRAND }, line: { color: BRAND } });
  t.addText('BD report', { x: 0.9, y: 2.3, w: 11, h: 0.5, fontFace: FONT, fontSize: 18, color: BRAND, bold: true });
  t.addText(`${r.scope} · ${r.period}`, { x: 0.9, y: 2.8, w: 11.5, h: 1, fontFace: FONT, fontSize: 40, bold: true, color: INK });
  t.addText(`Prepared ${r.prepared}. Pipeline figures are as of that day; the report card covers ${r.period}.`, { x: 0.9, y: 3.9, w: 11.5, h: 0.5, fontFace: FONT, fontSize: 14, color: MUTED });

  // 2. At a glance
  const g = page(pptx, 'At a glance', null, r);
  const tiles = [
    [`Booked, ${r.period}`, money(m.bookings.amount), m.bookings.target ? `${value(m.bookings)} of ${money(m.bookings.target)} target` : 'No target set'],
    ['Qualified pipeline', money(bd.qualified.value), `${bd.qualified.count} bids, Qualified onward`],
    ['Expected, next 4 quarters', money(q.reduce((s, x) => s + x.weighted, 0)), `PWIN-weighted · ${money(bd.expected.undetermined.value)} undetermined`],
    ['Backlog', money(bd.backlog.total), `${money(bd.backlog.fundedBacklog)} funded · ${money(bd.backlog.unfundedBacklog)} unfunded`],
  ];
  tiles.forEach(([label, big, note], i) => {
    const x = 0.5 + i * 3.1;
    g.addShape(pptx.ShapeType.roundRect, { x, y: 1.8, w: 2.9, h: 2, fill: { color: 'FFFFFF' }, line: { color: LINE, width: 1 }, rectRadius: 0.08 });
    g.addText(label, { x: x + 0.2, y: 1.95, w: 2.5, h: 0.35, fontFace: FONT, fontSize: 12, color: MUTED });
    g.addText(big, { x: x + 0.2, y: 2.35, w: 2.5, h: 0.75, fontFace: FONT, fontSize: 32, bold: true, color: INK });
    g.addText(note, { x: x + 0.2, y: 3.1, w: 2.5, h: 0.55, fontFace: FONT, fontSize: 10, color: MUTED, valign: 'top' });
  });
  g.addText([
    { text: 'Book-to-bill: ', options: { bold: true } }, { text: `${ratio(bd.bookToBill.ytd.ratio)} year to date, ${ratio(bd.bookToBill.ttm.ratio)} over the last 12 months.   ` },
    { text: 'Win rate: ', options: { bold: true } }, { text: `${value(m.winRate)}${m.winRate.valueRate != null ? ` (${Math.round(m.winRate.valueRate * 100)}% by value)` : ''}.` },
  ], { x: 0.5, y: 4.2, w: 12.3, h: 0.5, fontFace: FONT, fontSize: 13, color: INK });

  // 3. Report card
  const rc = page(pptx, `Report card · ${r.period}`, 'Seven measures of whether we are performing and winning', r);
  rc.addTable([
    [head('Measure'), head('Result', 'right'), head('Status'), head('Detail')],
    ...card.measures.map((x) => [
      cell([{ text: x.title, options: { bold: true, breakLine: true } }, { text: x.question, options: { italic: true, fontSize: 9, color: MUTED } }]),
      cell(value(x), { bold: true, align: 'right', fontSize: 14 }),
      cell(STATUS[x.status].text, { color: STATUS[x.status].color, fill: { color: STATUS[x.status].fill }, bold: true, fontSize: 10 }),
      cell(x.detail, { fontSize: 10, color: MUTED }),
    ]),
  ], { ...TABLE, colW: [3.2, 1.3, 1.8, 6.0] });

  // 4. Report card by director (team report only)
  if (r.directors?.length) {
    const d = page(pptx, 'Report card by BD director', r.period, r);
    d.addTable([
      [head('BD director'), ...card.measures.map((x) => head(x.title, 'center'))],
      ...r.directors.map(({ director, card: c }) => [
        cell(name(director), { bold: true }),
        ...c.measures.map((x) => cell(`${value(x)}\n${STATUS[x.status].text}`, { align: 'center', fontSize: 9, color: STATUS[x.status].color, fill: { color: STATUS[x.status].fill } })),
      ]),
    ], { ...TABLE, colW: [2.0, ...card.measures.map(() => 10.3 / card.measures.length)] });
  }

  // 5. Pipeline by stage
  const ps = page(pptx, 'Pipeline by stage', 'Every bid, open and closed, by value', r);
  ps.addChart(pptx.ChartType.bar, [{ name: 'Value', labels: bd.stages.map((s) => `${s.stage} (${s.count})`), values: bd.stages.map((s) => s.value) }],
    { ...chartBase, x: 0.5, y: 1.6, w: 12.3, h: 5.2, barDir: 'bar', chartColors: [SERIES[0]], showValue: true, showLegend: false, catAxisOrientation: 'maxMin', barGapWidthPct: 60 });

  // 6. Expected revenue by quarter
  const ex = page(pptx, 'Expected revenue by quarter', 'Open bids by projected win date. With a PWIN: value × PWIN. Without one: full value, shown apart.', r);
  ex.addChart(pptx.ChartType.bar, [
    { name: 'PWIN-adjusted (value × PWIN)', labels: q.map((x) => x.quarter), values: q.map((x) => x.adjusted.weighted) },
    { name: 'No PWIN yet (full value)', labels: q.map((x) => x.quarter), values: q.map((x) => x.unadjusted.value) },
  ], { ...chartBase, x: 0.5, y: 1.6, w: 8.3, h: 5.2, barDir: 'col', barGrouping: 'stacked', chartColors: SERIES, showLegend: true, legendPos: 'b', showValue: true, barGapWidthPct: 70 });
  const pools = [['Undetermined', bd.expected.undetermined], ['Later', bd.expected.later], ['Overdue', bd.expected.overdue], ['No date set', bd.expected.unscheduled]];
  ex.addText('Not in a quarter', { x: 9.1, y: 1.7, w: 3.7, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: INK });
  ex.addTable(pools.map(([l, b]) => [cell(l), cell(`${money(b.value)} · ${b.count}`, { align: 'right', bold: true })]),
    { x: 9.1, y: 2.15, w: 3.7, colW: [1.7, 2.0], border: { type: 'solid', pt: 0.5, color: LINE } });

  // 7. Qualified pipeline by territory and director
  const qp = page(pptx, 'Qualified pipeline', 'Open bids, Qualified onward', r);
  [['By territory', bd.qualifiedByTerritory, 0.5], ['By BD director', bd.qualifiedByDirector, 6.85]].forEach(([title, rows, x]) => {
    qp.addText(title, { x, y: 1.55, w: 5.9, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: INK });
    if (rows.length) {
      qp.addChart(pptx.ChartType.bar, [{ name: 'Value', labels: rows.map((g2) => g2.name), values: rows.map((g2) => g2.value) }],
        { ...chartBase, x, y: 2.0, w: 5.9, h: 4.8, barDir: 'bar', chartColors: [SERIES[0]], showValue: true, showLegend: false, catAxisOrientation: 'maxMin', barGapWidthPct: 60 });
    } else qp.addText('No qualified bids.', { x, y: 2.1, w: 5.9, h: 0.4, fontFace: FONT, fontSize: 12, color: MUTED });
  });

  // 8. Bookings funded and unfunded
  const bk = page(pptx, 'Bookings by quarter', "Contracts won, and how much of each quarter's wins is funded so far", r);
  bk.addChart(pptx.ChartType.bar, [
    { name: 'Funded', labels: bd.bookings.byQuarter.map((x) => x.quarter), values: bd.bookings.byQuarter.map((x) => x.funded) },
    { name: 'Unfunded', labels: bd.bookings.byQuarter.map((x) => x.quarter), values: bd.bookings.byQuarter.map((x) => x.unfunded) },
  ], { ...chartBase, x: 0.5, y: 1.6, w: 12.3, h: 5.2, barDir: 'col', barGrouping: 'stacked', chartColors: SERIES, showLegend: true, legendPos: 'b', showValue: false, barGapWidthPct: 60 });

  // 9. Backlog and book-to-bill
  const bb = page(pptx, 'Backlog and book-to-bill', `${bd.backlog.contracts} active contracts`, r);
  bb.addTable([
    [head('Backlog'), head('', 'right')],
    [cell('Contract value'), cell(money(bd.backlog.value), { align: 'right' })],
    [cell('Funded backlog (funded, not yet billed)'), cell(money(bd.backlog.fundedBacklog), { align: 'right', bold: true })],
    [cell('Unfunded backlog (not yet funded)'), cell(money(bd.backlog.unfundedBacklog), { align: 'right', bold: true })],
    [cell('Billed to date'), cell(money(bd.backlog.billed), { align: 'right' })],
  ], { x: 0.5, y: 1.6, w: 5.6, colW: [3.9, 1.7], border: { type: 'solid', pt: 0.5, color: LINE } });
  bb.addTable([
    [head('Quarter'), head('Booked', 'right'), head('Billed', 'right'), head('Book-to-bill', 'right')],
    ...bd.bookToBill.byQuarter.map((x) => [cell(x.quarter), cell(money(x.booked), { align: 'right' }), cell(money(x.billed), { align: 'right' }), cell(ratio(x.ratio), { align: 'right', bold: true })]),
    [cell('Year to date', { bold: true }), cell(money(bd.bookToBill.ytd.booked), { align: 'right', bold: true }), cell(money(bd.bookToBill.ytd.billed), { align: 'right', bold: true }), cell(ratio(bd.bookToBill.ytd.ratio), { align: 'right', bold: true })],
  ], { x: 6.6, y: 1.6, w: 6.2, colW: [1.7, 1.5, 1.5, 1.5], border: { type: 'solid', pt: 0.5, color: LINE } });
  if (bd.bookToBill.byDirector.length) {
    bb.addTable([
      [head('BD director (last 12 months)'), head('Booked', 'right'), head('Billed', 'right'), head('Book-to-bill', 'right')],
      ...bd.bookToBill.byDirector.map((x) => [cell(x.name), cell(money(x.booked), { align: 'right' }), cell(money(x.billed), { align: 'right' }), cell(ratio(x.ratio), { align: 'right', bold: true })]),
    ], { x: 0.5, y: 4.2, w: 12.3, colW: [5.3, 2.3, 2.3, 2.4], border: { type: 'solid', pt: 0.5, color: LINE }, autoPage: true, autoPageRepeatHeader: true });
  }

  // 10. Stalled pursuits
  const stalled = m.progression.stalled;
  if (stalled.length) {
    const st = page(pptx, `Stalled pursuits (${stalled.length})`, 'Open bids with no stage change in 45+ days, or past their projected win date', r);
    st.addTable([
      [head('Bid'), head('Stage'), head('BD director'), head('Value', 'right'), head('Days since stage change', 'right')],
      ...stalled.map((x) => [cell(x.title), cell(x.stage), cell(x.director || '—'), cell(money(x.value), { align: 'right' }), cell(`${x.days}${x.overdue ? ' · past win date' : ''}`, { align: 'right' })]),
    ], { ...TABLE, colW: [4.8, 1.6, 2.4, 1.5, 2.0] });
  }
  return pptx;
}
