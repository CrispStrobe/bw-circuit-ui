/**
 * The example intro document: frontmatter, markdown, and its localised labels.
 *
 * EXTRACTED FROM ExamplesBrowser.jsx 2026-09-07, unchanged, so there is exactly
 * one of it. The catalogue's per-card intro and the top bar's (i) beside the
 * project name render the same file — `examples/<id>/intro.de.md` falling back
 * to `intro.md` — and a second renderer would be a second thing to keep in
 * agreement with the first. This repo has spent the week on defects of that
 * shape; adding one to close a UI ticket would be a poor trade.
 *
 * Nothing here is new code. If this file and the catalogue ever disagree about
 * how an intro looks, that is a bug in the import, not in the markdown.
 */
import React from 'react';

export const INTRO_L10N = {
  en: { intro: 'About this example', loading: 'Loading…', noIntro: 'No introduction available.',
        level: 'Level', age: 'Age', prereqs: 'Prerequisites', teaches: 'Teaches' },
  de: { intro: 'Über dieses Beispiel', loading: 'Wird geladen…', noIntro: 'Keine Einführung verfügbar.',
        level: 'Stufe', age: 'Alter', prereqs: 'Voraussetzungen', teaches: 'Vermittelt' },
};
export const LEVEL_LABELS = {
  en: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' },
  de: { beginner: 'Anfänger', intermediate: 'Fortgeschritten', advanced: 'Fortgeschritten+' },
};
export const LEVEL_COLORS = { beginner: '#22c55e', intermediate: '#f59e0b', advanced: '#f97316' };

/** Parse YAML frontmatter + markdown body from an intro file. */
export function parseIntro(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) {
      const val = kv[2].trim();
      meta[kv[1]] = val.startsWith('[') ? val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean) : val;
    }
  }
  return { meta, body: m[2].trim() };
}

/**
 * Render minimal markdown to React elements.
 *
 * "Minimal" was too minimal, and it showed. It handled `## ` but not `# `, and
 * no fenced code blocks at all, so every unhandled line fell through to the
 * paragraph branch and was printed VERBATIM. An intro opening with
 * `# Pocket Calculator` displayed the hash, and its keypad table — a ``` block —
 * appeared as raw lines with the fences still in them.
 *
 * Handles: # and ## headings, ``` fenced code, **bold**, `code`, - and 1. lists,
 * links, paragraphs. Anything else still falls through to a paragraph, which is
 * the right default; the bug was that two COMMON constructs were in that bucket.
 */
export function renderMarkdown(md, palette) {
  const lines = md.split('\n');
  const elements = [];
  let listItems = [];
  const flushList = () => {
    if (listItems.length) {
      elements.push(<ul key={`ul-${elements.length}`} style={{margin: '4px 0 8px', paddingLeft: 18, color: palette.text, fontSize: 12}}>{listItems}</ul>);
      listItems = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Fenced code: consume to the closing fence and render as a block. Done
    // first so nothing inside a fence is interpreted as markdown.
    if (/^```/.test(line)) {
      flushList();
      const buf = [];
      let j = i + 1;
      for (; j < lines.length && !/^```/.test(lines[j]); j++) buf.push(lines[j]);
      i = j;   // skip the closing fence; if it is missing, we consumed the rest
      elements.push(
        <pre key={`pre-${i}`} style={{margin: '4px 0 8px', padding: '6px 8px', overflowX: 'auto',
          background: palette.codeBg || 'rgba(127,127,127,0.12)', color: palette.text,
          fontSize: 11, lineHeight: 1.45, borderRadius: 4}}>{buf.join('\n')}</pre>);
    } else if (/^# /.test(line)) {
      // The document title. Bigger than ##, and it was previously printed with
      // its hash still attached.
      flushList();
      elements.push(<div key={`h1-${i}`} style={{fontWeight: 700, fontSize: 15, color: palette.heading, marginTop: i > 0 ? 12 : 0, marginBottom: 4}} data-intro-heading>{line.slice(2)}</div>);
    } else if (/^## /.test(line)) {
      flushList();
      elements.push(<div key={`h-${i}`} style={{fontWeight: 700, fontSize: 13, color: palette.heading, marginTop: i > 0 ? 10 : 0, marginBottom: 3}} data-intro-heading>{line.slice(3)}</div>);
    } else if (/^- /.test(line)) {
      listItems.push(<li key={`li-${i}`} style={{marginBottom: 2}}>{renderInline(line.slice(2))}</li>);
    } else if (/^\d+\. /.test(line)) {
      // Numbered list item — render as unordered for simplicity
      listItems.push(<li key={`li-${i}`} style={{marginBottom: 2}}>{renderInline(line.replace(/^\d+\.\s*/, ''))}</li>);
    } else if (line.trim()) {
      flushList();
      elements.push(<p key={`p-${i}`} style={{margin: '2px 0 6px', color: palette.text, fontSize: 12, lineHeight: 1.5}}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return elements;
}

/** Render inline markdown: **bold**, `code`, [links](url). */
export function renderInline(text) {
  const parts = [];
  let rest = text;
  let key = 0;
  while (rest.length) {
    // Links: [text](url)
    const linkM = rest.match(/\[([^\]]+)\]\(([^)]+)\)/);
    // Bold: **text**
    const boldM = rest.match(/\*\*([^*]+)\*\*/);
    // Code: `text`
    const codeM = rest.match(/`([^`]+)`/);
    // Find the earliest match
    const matches = [linkM, boldM, codeM].filter(Boolean);
    if (!matches.length) { parts.push(rest); break; }
    const earliest = matches.reduce((a, b) => (a.index < b.index ? a : b));
    if (earliest.index > 0) parts.push(rest.slice(0, earliest.index));
    if (earliest === linkM) {
      parts.push(<a key={key++} href={linkM[2]} style={{color: '#3b82f6', textDecoration: 'underline'}}
        onClick={e => e.stopPropagation()}>{linkM[1]}</a>);
    } else if (earliest === boldM) {
      parts.push(<strong key={key++}>{boldM[1]}</strong>);
    } else {
      parts.push(<code key={key++} style={{background: 'rgba(0,0,0,0.08)', padding: '1px 3px', borderRadius: 2, fontSize: 11}}>{codeM[1]}</code>);
    }
    rest = rest.slice(earliest.index + earliest[0].length);
  }
  return parts;
}
