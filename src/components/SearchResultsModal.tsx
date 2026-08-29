'use client';

import React, { useEffect } from 'react';
import { BrainCircuit, LoaderCircle, Search, X } from 'lucide-react';

interface SearchResultsModalProps {
  query: string;
  resultCount: number;
  totalCount: number;
  semanticStatus: 'idle' | 'searching' | 'ready' | 'fallback';
  onClose: () => void;
  children: React.ReactNode;
}

export function SearchResultsModal({ query, resultCount, totalCount, semanticStatus, onClose, children }: SearchResultsModalProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="search-results-overlay" role="dialog" aria-modal="true" aria-label={`搜索结果：${query}`}>
      <div className="search-results-sheet">
        <header className="search-results-header">
          <div className="search-results-query-icon"><Search /></div>
          <div className="min-w-0 flex-1">
            <span className="search-results-kicker">SEARCH RESULT</span>
            <h2>“{query}”</h2>
            <p>在 {totalCount} 个文件中找到 <strong>{resultCount}</strong> 个结果</p>
          </div>
          <div className="search-results-mode">
            {semanticStatus === 'searching' ? <LoaderCircle className="animate-spin" /> : <BrainCircuit />}
            <span>{semanticStatus === 'ready' ? '语义索引已参与排序' : semanticStatus === 'searching' ? '正在理解搜索意图' : '内容索引匹配'}</span>
          </div>
          <button onClick={onClose} className="search-results-close" aria-label="关闭搜索结果"><X /></button>
        </header>
        <div className="search-results-body">{children}</div>
      </div>
    </div>
  );
}
