'use client';

import { type ReactNode } from 'react';

// Minimal, XSS-safe Markdown renderer: output is built as React elements (no dangerouslySetInnerHTML).
// Supports fenced code, headings, GFM tables, blockquotes, ordered/unordered lists, and inline
// code / bold / italic / safe http(s) links.

function renderInline(text: string, keyBase: string): ReactNode[] {
  // Tokenize inline code first, then apply inline patterns on text segments.
  const nodes: ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  const push = (node: ReactNode) => nodes.push(node);
  while ((m = regex.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      push(<code key={`${keyBase}-c${i++}`}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      push(<strong key={`${keyBase}-b${i++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      push(<em key={`${keyBase}-i${i++}`}>{tok.slice(1, -1)}</em>);
    } else {
      const lm = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (lm) push(<a key={`${keyBase}-a${i++}`} href={lm[2]} target="_blank" rel="noreferrer noopener">{lm[1]}</a>);
      else push(tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) push(text.slice(last));
  return nodes;
}

function isTableRow(line: string) {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') ? t.slice(1, -1).split('|').map(c => c.trim()) : null;
}
function isTableDivider(cells: string[] | null) {
  return !!cells && cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c));
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;
  let code: string[] | null = null;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      if (code) { blocks.push(<pre key={i} className="markdown-code"><code>{code.join('\n')}</code></pre>); code = null; }
      else code = [];
      i++; continue;
    }
    if (code) { code.push(line); i++; continue; }

    // GFM table: header row, divider row, then body rows.
    const headerCells = isTableRow(line);
    const nextCells = i + 1 < lines.length ? isTableRow(lines[i+1]) : null;
    if (headerCells && isTableDivider(nextCells)) {
      const rows: string[][] = [headerCells];
      let j = i + 2;
      while (j < lines.length) {
        const r = isTableRow(lines[j]);
        if (!r) break;
        rows.push(r); j++;
      }
      blocks.push(
        <div className="markdown-table-wrap" key={i}>
          <table className="markdown-table">
            <thead><tr>{rows[0].map((c, k) => <th key={k}>{renderInline(c, `h${i}-${k}`)}</th>)}</tr></thead>
            <tbody>{rows.slice(1).map((r, ri) => (
              <tr key={ri}>{r.map((c, k) => <td key={k}>{renderInline(c, `b${i}-${ri}-${k}`)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      );
      i = j; continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)/);
    if (heading) {
      const depth = heading[1].length;
      const content = renderInline(heading[2], `hd-${i}`);
      if (depth <= 2) blocks.push(<h3 key={i}>{content}</h3>);
      else if (depth === 3) blocks.push(<h4 key={i}>{content}</h4>);
      else blocks.push(<h5 key={i} className="markdown-h5">{content}</h5>);
      i++; continue;
    }

    if (line.trim().startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { quote.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      blocks.push(<blockquote key={i} className="markdown-quote">{quote.map((q, qi) => <p key={qi}>{renderInline(q, `q${i}-${qi}`)}</p>)}</blockquote>);
      continue;
    }

    // Consecutive list items (- / * or digit.).
    const listMatch = line.match(/^\s*([-*]|\d+\.)\s+(.*)/);
    if (listMatch) {
      const ordered = /^\d+\./.test(listMatch[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
        if (!m) break;
        items.push(m[1]); i++;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={i} className="markdown-list">
          {items.map((it, k) => <li key={k}>{renderInline(it, `li${i}-${k}`)}</li>)}
        </ListTag>
      );
      continue;
    }

    if (!line.trim()) { i++; continue; }

    // Paragraph: consume consecutive non-empty, non-special lines.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith('```') && !lines[i].trim().startsWith('#')
      && !lines[i].trim().startsWith('>') && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !isTableDivider(isTableRow(lines[i]))) {
      para.push(lines[i]); i++;
    }
    blocks.push(<p key={i}>{renderInline(para.join(' '), `p${i}`)}</p>);
  }
  if (code) blocks.push(<pre key="end" className="markdown-code"><code>{code.join('\n')}</code></pre>);
  return <div className="markdown-body">{blocks}</div>;
}
