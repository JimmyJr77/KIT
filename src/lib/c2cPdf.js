// The Close to closing list as a PDF: landscape letter sheets, the rows in the order given, the column headings repeated
// on every sheet. The PDF library loads only when someone downloads.

// The PDF's built-in fonts cover Western European text; anything else (emoji, other scripts) is left out rather than garbled.
const plain = (s) => String(s ?? '').replace(/\r/g, '').replace(/[^\n\x20-\x7E -ÿ‘’“”•–—…€™]/g, '');
const NOTE_MAX = 700;
const INK = [15, 23, 42];
const MUTED = [100, 116, 139];
const BRAND = [37, 59, 156];
// Status and category colors, as on the page.
const TONES = {
  'On-Track': [4, 120, 87], 'Off-Track Trending Up': [77, 124, 15], 'Off-Track Steady': [180, 83, 9], 'Off-Track Trending Down': [185, 28, 28],
  Closed: [71, 85, 105], Win: [4, 120, 87], 'Toss-up': [180, 83, 9], Loss: [185, 28, 28], Awarded: [7, 89, 133], 'Paid (Won)': [4, 120, 87], 'Closed - Not awarded': [71, 85, 105],
};

/**
 * Build and download the PDF. `rows` are plain text, already ordered: { title, sub, tags, value, duration, category,
 * closeDate, status, expectation, notes: [{ body, by }] }. `summary` is the line under the title and `date` today's date, both as shown. `logo`
 * is the Knexus wordmark as a data URL (1848 × 260), set at the top as on the reports.
 */
export async function downloadC2cPdf({ rows, summary, date, fileName, logo }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true });
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
  doc.text(doc.splitTextToSize(plain(summary), width - margin * 2), margin, margin + 53);

  const byLines = new Set();
  autoTable(doc, {
    startY: margin + 66,
    margin: { left: margin, right: margin, top: margin, bottom: margin + 8 },
    head: [['Opportunity', 'Value', 'Duration', 'Category', 'Est. Close Date', 'Status', 'Expectation', 'Status note']],
    body: rows.map((r) => {
      // Each status note, then who wrote it and when on a line of its own (drawn lighter).
      const notes = (r.notes || []).map((n) => {
        const body = plain(n.body).trim();
        const by = plain(n.by).trim();
        if (by) byLines.add(by);
        return `${body.length > NOTE_MAX ? `${body.slice(0, NOTE_MAX).trimEnd()}…` : body}${by ? `\n${by}` : ''}`;
      }).filter(Boolean);
      return [
        [plain(r.title), plain(r.sub), plain(r.tags)].filter(Boolean).join('\n'),
        plain(r.value), plain(r.duration), plain(r.category), plain(r.closeDate), plain(r.status), plain(r.expectation),
        notes.length ? notes.join('\n\n') : '—',
      ];
    }),
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 8, textColor: INK, cellPadding: { top: 5, bottom: 5, left: 4, right: 4 }, valign: 'top', overflow: 'linebreak', lineColor: [203, 213, 225], lineWidth: { bottom: 0.5 } },
    headStyles: { fontSize: 7, fontStyle: 'bold', textColor: MUTED, fillColor: [248, 250, 252], lineColor: [148, 163, 184], lineWidth: { bottom: 0.75 } },
    columnStyles: {
      0: { cellWidth: 170, fontStyle: 'bold' },
      1: { cellWidth: 62, halign: 'right', textColor: [4, 120, 87] },
      2: { cellWidth: 48 },
      3: { cellWidth: 78 },
      4: { cellWidth: 66 },
      5: { cellWidth: 86, fontStyle: 'bold' },
      6: { cellWidth: 58, fontStyle: 'bold' },
      7: { cellWidth: 'auto' },
    },
    didParseCell: ({ section, column, cell }) => {
      if (section === 'head' && column.index === 1) cell.styles.halign = 'right';
      if (section !== 'body') return;
      const tone = (column.index === 5 || column.index === 6 || column.index === 3) && TONES[cell.raw];
      if (tone) cell.styles.textColor = tone;
      if (column.index === 3 && tone) cell.styles.fontStyle = 'bold';
    },
    // The opportunity cell: only its first line (the name) is bold; the organization, owner and tags under it are lighter.
    willDrawCell: ({ section, column, cell, doc: d }) => {
      if (section !== 'body' || (column.index !== 0 && column.index !== 7)) return;
      cell.c2cLines = cell.text;
      cell.text = [];
      d.setFontSize(8);
    },
    didDrawCell: ({ section, column, cell, row, doc: d }) => {
      if (section !== 'body' || !cell.c2cLines) return;
      const lines = cell.c2cLines;
      const lineHeight = 8 * 1.15;
      const x = cell.x + 4;
      let y = cell.y + 5 + 8 * 0.85;
      if (column.index === 0) {
        // Wrapped lines of the name come first; the rest starts where the raw text's second line does.
        const nameLines = d.setFont('helvetica', 'bold').splitTextToSize(String(row.raw[0]).split('\n')[0], cell.width - 8).length;
        lines.forEach((line, i) => {
          if (i < nameLines) d.setFont('helvetica', 'bold').setTextColor(...INK);
          else d.setFont('helvetica', 'normal').setTextColor(...MUTED);
          d.text(line, x, y);
          y += lineHeight;
        });
      } else {
        // Status notes: the line under each (who wrote it, and when) is lighter.
        lines.forEach((line) => {
          d.setFont('helvetica', 'normal').setTextColor(...(byLines.has(line.trim()) ? MUTED : INK));
          d.text(line, x, y);
          y += lineHeight;
        });
      }
    },
    didDrawPage: ({ pageNumber }) => {
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED);
      doc.text(`Close to closing · ${plain(date)}`, margin, height - 16);
      doc.text(`Page ${pageNumber}`, width - margin, height - 16, { align: 'right' });
    },
  });

  doc.save(fileName);
}
