// The Close to closing list as a PDF: portrait letter sheets, the rows in the order given, the column headings repeated
// on every sheet. Each deal is one line of columns with its status note in a band underneath, across the sheet's width.
// The PDF library loads only when someone downloads.

// The PDF's built-in fonts cover Western European text; anything else (emoji, other scripts) is left out rather than garbled.
const plain = (s) => String(s ?? '').replace(/\r/g, '').replace(/[^\n\x20-\x7E -ÿ‘’“”•–—…€™]/g, '');
const NOTE_MAX = 700;
const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const BRAND = [37, 59, 156];
// Status and category colors, as on the page.
const TONES = {
  'On-Track': [4, 120, 87], 'Off-Track Trending Up': [77, 124, 15], 'Off-Track Steady': [180, 83, 9], 'Off-Track Trending Down': [185, 28, 28],
  Closed: [71, 85, 105], Win: [4, 120, 87], 'Toss-up': [180, 83, 9], Loss: [185, 28, 28], Awarded: [7, 89, 133], Paid: [4, 120, 87], 'Closed - Not awarded': [71, 85, 105],
};

/**
 * Build and download the PDF. `rows` are plain text, already ordered: { title, sub, value, duration, category,
 * closeDate, status, expectation, notes: [{ body, by }] }. `summary` is the line under the title and `date` today's date, both as shown. `logo`
 * is the Knexus wordmark as a data URL (1848 × 260), set at the top as on the reports. `metrics` is the value rollup, as on
 * the page: [{ label, value, count }], all text, drawn as a row of boxes above the table.
 */
export async function downloadC2cPdf({ rows, summary, date, fileName, logo, metrics = [] }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 30;

  // The heading, as on the reports: the Knexus wordmark and "KIT · Close to closing" across the top, then the title.
  const logoHeight = 16;
  if (logo) doc.addImage(logo, 'PNG', margin, margin, logoHeight * (1848 / 260), logoHeight, 'knexus', 'FAST');
  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...BRAND).text('KIT · CLOSE TO CLOSING', width - margin, margin + 11, { align: 'right' });
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...INK).text('Close to closing', margin, margin + 40);
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
  doc.text(`Prepared ${plain(date)}`, width - margin, margin + 40, { align: 'right' });
  const summaryLines = doc.splitTextToSize(plain(summary), width - margin * 2);
  doc.text(summaryLines, margin, margin + 53);

  // The value rollup: one box per metric across the sheet, between the summary and the table.
  const rollupTop = margin + 64 + (summaryLines.length - 1) * 9.5; // under the summary, however many lines it runs to
  const rollupHeight = metrics.length ? 36 : 0;
  if (metrics.length) {
    const gap = 6;
    const boxWidth = (width - margin * 2 - gap * (metrics.length - 1)) / metrics.length;
    metrics.forEach((m, i) => {
      const x = margin + i * (boxWidth + gap);
      doc.setDrawColor(203, 213, 225).setLineWidth(0.5).roundedRect(x, rollupTop, boxWidth, rollupHeight, 3, 3, 'S');
      doc.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(...MUTED).text(plain(m.label).toUpperCase(), x + 6, rollupTop + 10);
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(4, 120, 87).text(plain(m.value), x + 6, rollupTop + 23);
      doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(...MUTED).text(plain(m.count), x + 6, rollupTop + 31);
    });
  }

  // Each deal's status notes, wrapped to the sheet's width: they go in a band under the deal's line of columns. A note is
  // its text, then who wrote it and when on a lighter line of its own.
  const LINE = 8 * 1.15;
  const BAND = { inset: 4, pad: 6, label: 9, gap: 4 }; // the band's side inset, inner padding, label line, and space between notes
  const tableWidth = width - margin * 2;
  doc.setFont('helvetica', 'normal').setFontSize(8);
  const bands = rows.map((r) => {
    const notes = (r.notes || []).map((n) => {
      const body = plain(n.body).trim();
      const by = plain(n.by).trim();
      const text = body.length > NOTE_MAX ? `${body.slice(0, NOTE_MAX).trimEnd()}…` : body;
      return [...(text ? doc.splitTextToSize(text, tableWidth - (BAND.inset + BAND.pad) * 2).map((line) => ({ line })) : []), ...(by ? [{ line: by, muted: true }] : [])];
    }).filter((lines) => lines.length);
    if (!notes.length) return null;
    return { notes, height: BAND.pad + BAND.label + notes.reduce((h, lines) => h + lines.length * LINE, 0) + (notes.length - 1) * BAND.gap + BAND.pad - 2 };
  });
  const PAD = { top: 6, bottom: 6, left: 5, right: 5 };

  autoTable(doc, {
    startY: rollupTop + rollupHeight + (metrics.length ? 8 : 2),
    margin: { left: margin, right: margin, top: margin, bottom: margin + 8 },
    head: [['Opportunity', 'Value', 'Duration', 'Category', 'Est. Close', 'Status', 'Expectation']],
    body: rows.map((r) => [
      [plain(r.title), plain(r.sub)].filter(Boolean).join('\n'),
      plain(r.value), plain(r.duration), plain(r.category), plain(r.closeDate), plain(r.status), plain(r.expectation),
    ]),
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 8, textColor: INK, cellPadding: PAD, valign: 'top', overflow: 'linebreak', lineColor: [203, 213, 225], lineWidth: { bottom: 0.5 } },
    headStyles: { fontSize: 7, fontStyle: 'bold', textColor: MUTED, fillColor: [248, 250, 252], lineColor: [148, 163, 184], lineWidth: { bottom: 0.75 } },
    columnStyles: {
      // 552pt across: the opportunity takes what the others leave (about 150pt).
      0: { cellWidth: 'auto', fontStyle: 'bold' },
      1: { cellWidth: 68, halign: 'right', textColor: [4, 120, 87] },
      2: { cellWidth: 48 },
      3: { cellWidth: 80 },
      4: { cellWidth: 66 },
      5: { cellWidth: 82, fontStyle: 'bold' },
      6: { cellWidth: 58, fontStyle: 'bold' },
    },
    didParseCell: ({ section, column, cell, row }) => {
      if (section === 'head' && column.index === 1) cell.styles.halign = 'right';
      if (section !== 'body') return;
      // Room under the line of columns for the deal's status note band.
      const band = bands[row.index];
      if (band) cell.styles.cellPadding = { ...PAD, bottom: PAD.bottom + band.height + 6 };
      const tone = (column.index === 5 || column.index === 6 || column.index === 3) && TONES[cell.raw];
      if (tone) cell.styles.textColor = tone;
      if (column.index === 3 && tone) cell.styles.fontStyle = 'bold';
    },
    // The opportunity cell: only its first line (the name) is bold; the organization and owner under it are lighter.
    willDrawCell: ({ section, column, cell, doc: d }) => {
      if (section !== 'body' || column.index !== 0) return;
      cell.c2cLines = cell.text;
      cell.text = [];
      d.setFontSize(8);
    },
    didDrawCell: ({ section, cell, row, doc: d }) => {
      if (section !== 'body' || !cell.c2cLines) return;
      // Wrapped lines of the name come first; the rest starts where the raw text's second line does.
      const nameLines = d.setFont('helvetica', 'bold').splitTextToSize(String(row.raw[0]).split('\n')[0], cell.width - PAD.left - PAD.right).length;
      let y = cell.y + PAD.top + 8 * 0.85;
      cell.c2cLines.forEach((line, i) => {
        if (i < nameLines) d.setFont('helvetica', 'bold').setTextColor(...INK);
        else d.setFont('helvetica', 'normal').setTextColor(...MUTED);
        d.text(line, cell.x + PAD.left, y);
        y += LINE;
      });
      // The status note band, across the whole sheet under this deal's columns.
      const band = bands[row.index];
      if (!band) return;
      const top = cell.y + cell.height - PAD.bottom - band.height;
      d.setFillColor(248, 250, 252).roundedRect(margin + BAND.inset, top, tableWidth - BAND.inset * 2, band.height, 3, 3, 'F');
      const x = margin + BAND.inset + BAND.pad;
      d.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(...MUTED).text('STATUS NOTE', x, top + BAND.pad + 5);
      d.setFontSize(8);
      y = top + BAND.pad + BAND.label + 8 * 0.85;
      band.notes.forEach((lines) => {
        lines.forEach(({ line, muted }) => {
          d.setFont('helvetica', 'normal').setTextColor(...(muted ? MUTED : INK));
          d.text(line, x, y);
          y += LINE;
        });
        y += BAND.gap;
      });
    },
    didDrawPage: ({ pageNumber }) => {
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED);
      doc.text(`Close to closing · ${plain(date)}`, margin, height - 16);
      doc.text(`Page ${pageNumber}`, width - margin, height - 16, { align: 'right' });
    },
  });

  doc.save(fileName);
}
