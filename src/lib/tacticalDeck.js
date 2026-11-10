// The Tactical Meeting Report as an editable PowerPoint deck. Slide 1 is the overview: the week's numbers and the qualified
// pipeline by stage, week by week. Slide 2 is the same numbers by person, with the qualified pipeline by person. Slide 3
// is the cheat sheet of tickets behind each number, in two columns; a long week carries on rather than cutting anything.
// Takes a PptxGenJS instance, the report (GET /financials/tactical) and the Knexus name mark; works in the browser and Node.
import { shortDate, todayIso } from './format.js';
import { tacticalSections, personColumns, totalRow, signed, weekLabel, compact, toneOf, STAGE_COLORS } from './tactical.js';

const FONT = 'Calibri';
const INK = '0F172A';
const MUTED = '64748B';
const LINE = 'E2E8F0';
const PANEL = 'F8FAFC';
const NAVY = '14204F';
const BRAND = '253B9C';
const UP = '047857';
const DOWN = 'B91C1C';
const SERIES = ['2A78D6', 'EB6834', '1BAF7A', 'EDA100', 'E87BA4', '008300', '6250D6', 'E34948'];
const AXIS_MONEY = '[>=1000000000]$0.0,,,"B";[>=1000000]$0,,"M";$#,##0,"K"';
const OTHERS = '94A3B8';
const NAME_RATIO = 1848 / 260;

// The slide is 13.33 × 7.5 in.
const LEFT = 0.4;
const WIDTH = 12.53;
const TILES_Y = 1.2;
const TILES_H = 1.05;
const BODY_Y = 2.5;
const BODY_BOTTOM = 6.95;

// The cheat sheet: 9 pt items under 10.5 pt headings, in two columns. In PowerPoint an item line is about 0.15 in tall
// (a heading, with the space above it, about 1.5 lines), and a column holds about 110 characters across.
const COL_GAP = 0.35;
const COL_W = (WIDTH - COL_GAP) / 2;
const SHEET_Y = 1.25;
const ITEM_PT = 9;
const LINE_IN = 0.15;
const HEADING = 1.5;
const CHARS = 110;
const DETAIL_MAX = 260;
const ROOM = Math.floor((BODY_BOTTOM - SHEET_Y) / LINE_IN);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const linesOf = (item) => Math.max(1, Math.ceil((item.title.length + 3 + item.detail.length) / CHARS));

/** The title, subtitle, name mark and footer every slide shares. */
function frame(pptx, title, subtitle, logos) {
  const s = pptx.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.12, fill: { color: NAVY }, line: { color: NAVY, width: 0 } });
  s.addText(title, { x: LEFT, y: 0.28, w: 10, h: 0.5, margin: 0, fontFace: FONT, fontSize: 26, bold: true, color: NAVY });
  s.addText(subtitle, { x: LEFT, y: 0.76, w: 10, h: 0.3, margin: 0, fontFace: FONT, fontSize: 13, color: MUTED });
  if (logos?.nameOnLight) s.addImage({ x: LEFT + WIDTH - 1.42, y: 0.4, w: 1.42, h: 1.42 / NAME_RATIO, data: logos.nameOnLight });
  s.addText(`KIT · Tactical Meeting Report · prepared ${shortDate(todayIso(), { month: 'long', day: 'numeric', year: 'numeric' })}`,
    { x: LEFT, y: 7.12, w: 9, h: 0.25, margin: 0, fontFace: FONT, fontSize: 9, color: MUTED });
  return s;
}

/**
 * Lay the sections out down column after column, as many as it takes: a column is a list of blocks, each a heading and
 * its tickets. A section that runs past the bottom of a column carries on at the top of the next, headed "continued".
 */
function columns(sections) {
  const cols = [[]];
  let used = 0;
  const fresh = () => { cols.push([]); used = 0; };
  sections.forEach((sec) => {
    const items = sec.items.map((x) => ({ ...x, detail: clip(x.detail || '', DETAIL_MAX) }));
    // A heading never sits alone at the bottom of a column.
    if (used && used + HEADING + (items[0] ? linesOf(items[0]) : 0) > ROOM) fresh();
    let block = { sec, continued: false, items: [] };
    cols.at(-1).push(block);
    used += HEADING;
    items.forEach((x) => {
      if (used + linesOf(x) > ROOM) {
        fresh();
        block = { sec, continued: true, items: [] };
        cols.at(-1).push(block);
        used += HEADING;
      }
      block.items.push(x);
      used += linesOf(x);
    });
  });
  return cols;
}

const hex = (c) => c.replace('#', '');
const toneColor = (n) => (toneOf(n) > 0 ? UP : toneOf(n) < 0 ? DOWN : MUTED);
const cellOf = (text, opts = {}) => ({ text: String(text ?? ''), options: { fontFace: FONT, fontSize: 10, color: INK, valign: 'middle', margin: [0.02, 0.06, 0.02, 0.06], ...opts } });
const RULES = [{ type: 'none' }, { type: 'none' }, { type: 'solid', pt: 0.5, color: LINE }, { type: 'none' }];
const chartText = {
  catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, catAxisLabelColor: MUTED, valAxisLabelColor: MUTED,
  valAxisLabelFormatCode: AXIS_MONEY, valGridLine: { color: LINE, style: 'solid', size: 0.5 }, catGridLine: { style: 'none' }, valAxisLineShow: false,
  legendFontFace: FONT, legendFontSize: 10, legendColor: INK,
};

export function buildTacticalDeck(pptx, r, logos) {
  const team = !r.scope.director;
  const { tiles, sections } = tacticalSections(r, team);
  const q = r.qualified;
  const week = weekLabel(r.week);
  const subtitle = `${r.scope.label} · week of ${week}`;
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `Tactical Meeting Report · ${r.scope.label} · ${week}`;
  pptx.company = 'Knexus';

  // Slide 1: the overview. The week's numbers, and the qualified pipeline by stage week by week, with where each stage stands.
  const s = frame(pptx, 'Tactical Meeting Report', `${team ? 'Team overview' : 'Overview'} · ${subtitle}`, logos);
  const gap = 0.15;
  const tw = (WIDTH - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = LEFT + i * (tw + gap);
    s.addShape(pptx.ShapeType.rect, { x, y: TILES_Y, w: tw, h: TILES_H, fill: { color: PANEL }, line: { color: LINE, width: 0.75 } });
    s.addShape(pptx.ShapeType.rect, { x, y: TILES_Y, w: 0.05, h: TILES_H, fill: { color: BRAND }, line: { color: BRAND, width: 0 } });
    const inner = { x: x + 0.16, w: tw - 0.24, margin: 0, fontFace: FONT };
    s.addText(t.label, { ...inner, y: TILES_Y + 0.08, h: 0.24, fontSize: 11, bold: true, color: MUTED, valign: 'top' });
    s.addText(String(t.value), { ...inner, y: TILES_Y + 0.32, h: 0.42, fontSize: 26, bold: true, color: INK, valign: 'middle' });
    s.addText(t.note, { ...inner, y: TILES_Y + 0.76, h: 0.24, fontSize: 9.5, color: toneColor(t.tone), valign: 'top', fit: 'shrink' });
  });
  const st = r.stages;
  s.addText('Pipeline value by stage, week by week', { x: LEFT, y: BODY_Y, w: WIDTH, h: 0.3, margin: 0, fontFace: FONT, fontSize: 14, bold: true, color: NAVY });
  s.addText(`Qualified onward at each week's end · ${compact(st.now)} now, ${signed(st.change)} this week`,
    { x: LEFT, y: BODY_Y + 0.3, w: WIDTH, h: 0.24, margin: 0, fontFace: FONT, fontSize: 10.5, color: MUTED });
  const weeks = st.points.map((d) => shortDate(d));
  const tableW = 3.3;
  const chartW = WIDTH - tableW - 0.3;
  if (st.points.length) {
    s.addChart(pptx.ChartType.bar, st.series.map((x) => ({ name: x.label, labels: weeks, values: x.values })), {
      ...chartText, x: LEFT, y: BODY_Y + 0.6, w: chartW, h: BODY_BOTTOM - BODY_Y - 0.6,
      barDir: 'col', barGrouping: 'stacked', barGapWidthPct: 45, chartColors: st.series.map((x) => hex(STAGE_COLORS[x.key])),
      showLegend: true, legendPos: 'b', catAxisLabelFontSize: weeks.length > 20 ? 8 : 10,
    });
  }
  // Each stage now, and its change over the week.
  const prev = (x) => (x.values.length > 1 ? x.values.at(-2) : x.values.at(-1));
  const stageRows = [...st.series].reverse().map((x) => [
    cellOf(x.label, { bold: true }), cellOf(compact(x.values.at(-1)), { align: 'right' }),
    cellOf(signed(x.values.at(-1) - prev(x)), { align: 'right', color: toneColor(x.values.at(-1) - prev(x)) }),
  ]);
  const head = (t, align) => cellOf(t, { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 9.5, align });
  s.addTable([[head('Stage'), head('Now', 'right'), head('This week', 'right')], ...stageRows, [
    cellOf('Total', { bold: true, fill: { color: PANEL } }), cellOf(compact(st.now), { bold: true, align: 'right', fill: { color: PANEL } }),
    cellOf(signed(st.change), { bold: true, align: 'right', fill: { color: PANEL }, color: toneColor(st.change) }),
  ]], { x: LEFT + chartW + 0.3, y: BODY_Y + 0.7, w: tableW, colW: [1.4, 0.9, 1.0], rowH: 0.32, border: RULES });

  // Slide 2: the same numbers by person, and the qualified pipeline by person week by week.
  const p2 = frame(pptx, 'By person', subtitle, logos);
  const cols = personColumns();
  const rows = team ? [...r.byPerson, { ...totalRow(r), total: true }] : r.byPerson.filter((p) => p.id === r.scope.director);
  const top = 1.3;
  const tableH = 2.75;
  const headH = 0.42;
  const rowH = Math.min(0.28, (tableH - headH) / Math.max(rows.length, 1));
  const font = rowH < 0.2 ? 8 : rowH < 0.24 ? 9 : 10;
  const colW = [2.2, ...cols.map(() => (WIDTH - 2.2) / cols.length)];
  p2.addTable([
    [head('Person'), ...cols.map((c) => head(c.label, 'right'))],
    ...rows.map((p) => {
      const o = p.total ? { bold: true, fill: { color: PANEL } } : {};
      return [cellOf(p.name, { ...o, fontSize: font }), ...cols.map((c) => cellOf(c.value(p), { ...o, fontSize: font, align: 'right', color: c.tone ? toneColor(c.tone(p)) : INK }))];
    }),
  ], { x: LEFT, y: top, w: WIDTH, colW, rowH: [headH, ...rows.map(() => rowH)], border: RULES });

  const chartY = top + headH + rowH * rows.length + 0.25;
  p2.addText(team ? 'Qualified pipeline by week, by person' : 'Qualified pipeline by week', { x: LEFT, y: chartY, w: WIDTH, h: 0.28, margin: 0, fontFace: FONT, fontSize: 13, bold: true, color: NAVY });
  const labels = q.points.map((d) => shortDate(d));
  // Past eight people, the smallest pipelines share an "Others" line, as on the page.
  let people = team ? q.people : [{ name: r.scope.label, values: q.total.values, now: q.total.now, change: q.total.change }];
  if (people.length > 8) {
    const rest = people.slice(7);
    const values = q.points.map((_, i) => rest.reduce((t, p) => t + p.values[i], 0));
    people = [...people.slice(0, 7), { name: `Others (${rest.length})`, others: true, values, now: values.at(-1), change: values.at(-1) - (values.at(-2) ?? values.at(-1)) }];
  }
  if (people.length && q.points.length) {
    p2.addChart(pptx.ChartType.line, people.map((p) => ({ name: p.name, labels, values: p.values })), {
      ...chartText, x: LEFT, y: chartY + 0.3, w: WIDTH, h: Math.max(1.6, BODY_BOTTOM - chartY - 0.3),
      chartColors: people.map((p, i) => (p.others ? OTHERS : SERIES[i % SERIES.length])), lineSize: 2.25, lineDataSymbol: 'none',
      showLegend: true, legendPos: 'r',
    });
  } else {
    p2.addText('No qualified pipeline yet.', { x: LEFT, y: chartY + 0.4, w: WIDTH, h: 0.4, margin: 0, fontFace: FONT, fontSize: 12, color: MUTED });
  }

  // Slide 3 on: the cheat sheet, two columns a slide.
  const sheetCols = columns(sections);
  const pages = Math.ceil(sheetCols.length / 2);
  for (let pg = 0; pg < pages; pg += 1) {
    const sheet = frame(pptx, pages > 1 ? `Cheat sheet · ${pg + 1} of ${pages}` : 'Cheat sheet', `${subtitle} · the tickets behind each number`, logos);
    sheetCols.slice(pg * 2, pg * 2 + 2).forEach((col, c) => {
      const runs = [];
      col.forEach((b, i) => {
        const { sec } = b;
        runs.push({ text: `${sec.title}${b.continued ? ', continued' : ` (${sec.items.length})`}${sec.items.length ? '' : ' · none'}`,
          options: { bold: true, color: BRAND, fontSize: 10.5, breakLine: true, paraSpaceBefore: i ? 6 : 0 } });
        b.items.forEach((x) => {
          runs.push({ text: x.title, options: { bold: true, color: INK, fontSize: ITEM_PT } });
          runs.push({ text: x.detail ? ` · ${x.detail}` : '', options: { color: MUTED, fontSize: ITEM_PT, breakLine: true } });
        });
      });
      sheet.addText(runs, { x: LEFT + c * (COL_W + COL_GAP), y: SHEET_Y, w: COL_W, h: BODY_BOTTOM - SHEET_Y, margin: 0, fontFace: FONT, valign: 'top' });
    });
  }
  return pptx;
}
