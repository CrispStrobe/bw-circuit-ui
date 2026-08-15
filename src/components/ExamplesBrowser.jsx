/**
 * ExamplesBrowser — gallery panel showing example circuits + programs.
 *
 * Reads examples/index.json from bw-cfront and renders categorized cards.
 * Click loads the example's circuit into the designer.
 * Presentation-only: no canvas interaction.
 */

import React, { useState, useMemo } from 'react';
import { t, categoryLabels, difficultyLabels } from '../i18n/strings.js';

const CATEGORY_COLORS = {
  basics: '#2ecc71',
  analog: '#f39c12',
  digital: '#9b59b6',
  motors: '#e74c3c',
};

/**
 * @param {{ examples: Array, lang?: string, onLoadExample?: function }} props
 */
export function ExamplesBrowser({ examples, lang = 'en', onLoadExample }) {
  const [filter, setFilter] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const catLabels = categoryLabels(lang);
  const diffLabels = difficultyLabels(lang);

  const categories = useMemo(() => {
    if (!examples) return [];
    return [...new Set(examples.map(e => e.category))];
  }, [examples]);

  const filtered = useMemo(() => {
    if (!examples) return [];
    let list = examples;
    if (selectedCategory) {
      list = list.filter(e => e.category === selectedCategory);
    }
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(e => {
        const title = e.title?.[lang] || e.title?.en || e.id;
        return title.toLowerCase().includes(q) || e.id.includes(q) || e.category.includes(q);
      });
    }
    return list;
  }, [examples, filter, selectedCategory, lang]);

  if (!examples || examples.length === 0) {
    return (
      <div style={{
        background: '#1a1a2e', border: '1px solid #2c3e50', borderRadius: '8px',
        padding: '12px', fontFamily: 'monospace', fontSize: '11px', color: '#556',
      }}>
        {t('noExamples', lang)}
      </div>
    );
  }

  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #2c3e50',
      borderRadius: '8px',
      padding: '8px',
      fontFamily: 'monospace',
      overflowY: 'auto',
    }}>
      <div style={{ color: '#ecf0f1', fontSize: '11px', marginBottom: '6px', fontWeight: 'bold' }}>
        {t('examples', lang)}
      </div>

      {/* Search */}
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t('searchExamples', lang)}
        style={{
          width: '100%', padding: '4px 6px', marginBottom: '6px',
          background: '#0a0a1a', border: '1px solid #2c3e50',
          borderRadius: '4px', color: '#ecf0f1',
          fontFamily: 'monospace', fontSize: '10px',
          boxSizing: 'border-box',
        }}
      />

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <button
          onClick={() => setSelectedCategory(null)}
          style={{
            padding: '2px 6px', borderRadius: '3px', fontSize: '8px',
            fontFamily: 'monospace', cursor: 'pointer',
            background: !selectedCategory ? '#3498db' : '#16213e',
            color: !selectedCategory ? '#fff' : '#7f8c8d',
            border: '1px solid #2c3e50',
          }}
        >{t('all', lang)}</button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
            style={{
              padding: '2px 6px', borderRadius: '3px', fontSize: '8px',
              fontFamily: 'monospace', cursor: 'pointer',
              background: selectedCategory === cat ? (CATEGORY_COLORS[cat] || '#555') : '#16213e',
              color: selectedCategory === cat ? '#fff' : (CATEGORY_COLORS[cat] || '#7f8c8d'),
              border: `1px solid ${CATEGORY_COLORS[cat] || '#2c3e50'}`,
            }}
          >{catLabels[cat] || cat}</button>
        ))}
      </div>

      {/* Example cards */}
      {filtered.length === 0 ? (
        <div style={{ color: '#556', fontSize: '9px', padding: '4px' }}>{t('noMatches', lang)}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {filtered.map(ex => (
            <ExampleCard
              key={ex.id}
              example={ex}
              lang={lang}
              diffLabels={diffLabels}
              onClick={() => onLoadExample && onLoadExample(ex)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExampleCard({ example, lang, diffLabels, onClick }) {
  const [hovered, setHovered] = useState(false);
  const title = example.title?.[lang] || example.title?.en || example.id;
  const catColor = CATEGORY_COLORS[example.category] || '#555';
  const diff = diffLabels[example.difficulty] || '';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '8px',
        background: hovered ? '#1e2d4a' : '#16213e',
        border: `1px solid ${hovered ? catColor : '#2c3e50'}`,
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'border-color 80ms, background 80ms',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#ecf0f1', fontSize: '10px', fontWeight: 'bold' }}>{title}</div>
        <span style={{
          fontSize: '7px', color: catColor,
          background: `${catColor}22`, padding: '1px 4px',
          borderRadius: '2px',
        }}>{example.category}</span>
      </div>
      {diff && (
        <div style={{ color: '#7f8c8d', fontSize: '8px', marginTop: '2px' }}>
          {'★'.repeat(example.difficulty)}{'☆'.repeat(3 - example.difficulty)} {diff}
        </div>
      )}
    </div>
  );
}
