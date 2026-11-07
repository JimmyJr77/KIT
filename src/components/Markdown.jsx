import { useMemo } from 'react';

/**
 * Markdown for written pages (the Playbook): headings, paragraphs, bullet lists nested by indentation, numbered lists,
 * tables, quotes, rules, bold, italics, code and links. `highlight` is a list of search terms: every match in the text is
 * marked. `plainText(md)` is the same text without the markup, for searching.
 */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One regex matching any of the terms, longest first, or null for none. */
export const termsRegex = (terms, flags = 'gi') => {
  const list = [...new Set((terms || []).map((t) => String(t).trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  return list.length ? new RegExp(`(${list.map(escapeRe).join('|')})`, flags) : null;
};

/** The text behind the markup, for searching and counting matches. */
export function plainText(md) {
  return String(md || '')
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '') // table separator rows
    .replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*>]\s+/gm, '').replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`|]/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

const splitCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Blocks from the markdown: each a heading, paragraph, list (items may hold a nested list), table, quote or rule. */
export function parseBlocks(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const flushPara = (buf) => { if (buf.length) out.push({ kind: 'p', text: buf.join(' ') }); };
  let para = [];
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { flushPara(para); para = []; i++; continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { flushPara(para); para = []; out.push({ kind: 'h', level: heading[1].length, text: heading[2] }); i++; continue; }
    if (/^[-*_]{3,}$/.test(line)) { flushPara(para); para = []; out.push({ kind: 'hr' }); i++; continue; }
    if (line.startsWith('|')) {
      flushPara(para); para = [];
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { if (!isSeparator(lines[i])) rows.push(splitCells(lines[i])); i++; }
      const width = Math.max(...rows.map((r) => r.length));
      out.push({ kind: 'table', head: rows[0] || [], rows: rows.slice(1).map((r) => [...r, ...Array(width - r.length).fill('')]) });
      continue;
    }
    if (line.startsWith('>')) {
      flushPara(para); para = [];
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { buf.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      out.push({ kind: 'quote', text: buf.join(' ') });
      continue;
    }
    const item = raw.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara(para); para = [];
      const list = { kind: /\d/.test(item[2]) ? 'ol' : 'ul', items: [] };
      const indent = item[1].length;
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
        if (m && m[1].length <= indent) {
          if ((/\d/.test(m[2]) ? 'ol' : 'ul') !== list.kind) break;
          list.items.push({ text: m[3], children: null });
          i++;
        } else if (m && m[1].length > indent) {
          // a nested list: take every deeper line, and let the same parser read it
          const nested = [];
          while (i < lines.length && (/^\s+\S/.test(lines[i]) && !lines[i].match(/^(\s*)([-*•]|\d+[.)])\s+/)?.[1].length <= indent || (lines[i].match(/^(\s*)([-*•]|\d+[.)])\s+/)?.[1].length ?? -1) > indent)) {
            nested.push(lines[i].slice(Math.min(indent + 2, lines[i].match(/^\s*/)[0].length)));
            i++;
          }
          const last = list.items[list.items.length - 1];
          if (last) last.children = parseBlocks(nested.join('\n'));
          else list.items.push({ text: '', children: parseBlocks(nested.join('\n')) });
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && list.items.length) {
          list.items[list.items.length - 1].text += ` ${lines[i].trim()}`; // a wrapped item line
          i++;
        } else break;
      }
      out.push(list);
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara(para);
  return out;
}

/** Inline markup to elements: bold, italics, code and links, with `mark` applied to the plain runs. */
function Inline({ text, mark }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**')) return <strong key={i} className="font-semibold text-slate-900">{mark(part.slice(2, -2))}</strong>;
    if (part.startsWith('`')) return <code key={i} className="rounded bg-slate-100 px-1 text-[0.85em]">{mark(part.slice(1, -1))}</code>;
    if (part.startsWith('*')) return <em key={i}>{mark(part.slice(1, -1))}</em>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-brand-700 underline decoration-brand-300 hover:decoration-brand-600">{mark(link[1])}</a>;
    return <span key={i}>{mark(part)}</span>;
  });
}

const H = { 1: 'text-xl font-bold text-slate-900 pt-2', 2: 'text-lg font-semibold text-slate-900 pt-2', 3: 'text-base font-semibold text-slate-800 pt-3', 4: 'text-sm font-semibold text-slate-700 pt-2', 5: 'text-sm font-semibold text-slate-600', 6: 'text-xs font-semibold uppercase tracking-wide text-slate-500' };

function Blocks({ blocks, mark }) {
  return blocks.map((b, i) => {
    switch (b.kind) {
      case 'h': return <div key={i} className={H[b.level]}><Inline text={b.text} mark={mark} /></div>;
      case 'p': return <p key={i} className="leading-relaxed"><Inline text={b.text} mark={mark} /></p>;
      case 'quote': return <blockquote key={i} className="border-l-4 border-amber-300 bg-amber-50/60 px-3 py-2 text-slate-700 italic"><Inline text={b.text} mark={mark} /></blockquote>;
      case 'hr': return <hr key={i} className="border-slate-200" />;
      case 'ul': case 'ol': {
        const Tag = b.kind;
        return (
          <Tag key={i} className={`space-y-1 pl-5 ${b.kind === 'ul' ? 'list-disc marker:text-slate-400' : 'list-decimal marker:font-medium marker:text-slate-500'}`}>
            {b.items.map((it, j) => (
              <li key={j} className="leading-relaxed">
                {it.text && <Inline text={it.text} mark={mark} />}
                {it.children && <div className="mt-1 space-y-1"><Blocks blocks={it.children} mark={mark} /></div>}
              </li>
            ))}
          </Tag>
        );
      }
      case 'table': return (
        <div key={i} className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>{b.head.map((c, j) => <th key={j} className="px-3 py-2 font-semibold"><Inline text={c} mark={mark} /></th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((row, j) => (
                <tr key={j} className="border-t border-slate-100 align-top">{row.map((c, k) => <td key={k} className="px-3 py-2"><Inline text={c} mark={mark} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      default: return null;
    }
  });
}

export default function Markdown({ text, highlight, className = '' }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const re = useMemo(() => termsRegex(highlight), [highlight]);
  const mark = (s) => {
    if (!re || !s) return s;
    const parts = String(s).split(re);
    if (parts.length === 1) return s;
    return parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-amber-200 px-0.5 text-slate-900">{p}</mark> : p));
  };
  return <div className={`space-y-3 text-sm text-slate-700 ${className}`}><Blocks blocks={blocks} mark={mark} /></div>;
}
