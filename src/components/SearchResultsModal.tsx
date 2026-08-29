'use client';
/* eslint-disable @next/next/no-img-element */

import React, { useEffect } from 'react';
import { BrainCircuit, Image as ImageIcon, LoaderCircle, Search, X } from 'lucide-react';

interface SearchResultsModalProps {
  query: string;
  interpretedQuery?: string;
  interpretationSource?: 'llm' | 'local';
  isInterpreting?: boolean;
  resultCount: number;
  totalCount: number;
  semanticStatus: 'idle' | 'searching' | 'ready' | 'fallback';
  searchMode?: 'text' | 'visual';
  imagePreview?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function SearchResultsModal({ query, interpretedQuery, interpretationSource, isInterpreting = false, resultCount, totalCount, semanticStatus, searchMode = 'text', imagePreview, onClose, children }: SearchResultsModalProps) {
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
          <div className="search-results-query-icon">{imagePreview ? <img src={imagePreview} alt="检索图片" /> : <Search />}</div>
          <div className="min-w-0 flex-1">
            <span className="search-results-kicker">{searchMode === 'visual' ? 'VISUAL MATCH' : 'SEARCH RESULT'}</span>
            <h2>{searchMode === 'visual' ? '包含此图片元素' : `“${query}”`}</h2>
            {searchMode === 'text' && interpretedQuery && interpretedQuery !== query && (
              <p className="search-results-intent">
                {interpretationSource === 'llm' ? 'AI 理解为：' : '检索关键词：'}<strong>{interpretedQuery}</strong>
              </p>
            )}
            <p>在 {totalCount} 个文件中找到 <strong>{resultCount}</strong> 个结果</p>
          </div>
          <div className="search-results-mode">
            {isInterpreting || semanticStatus === 'searching' ? <LoaderCircle className="animate-spin" /> : searchMode === 'visual' ? <ImageIcon /> : <BrainCircuit />}
            <span>{searchMode === 'visual' ? isInterpreting ? '正在进行局部特征定位' : '局部元素几何匹配' : isInterpreting ? 'AI 正在理解搜索意图' : semanticStatus === 'ready' ? '语义索引已参与排序' : semanticStatus === 'searching' ? '正在计算语义相关度' : interpretationSource === 'llm' ? 'AI 已提炼搜索意图' : '内容索引匹配'}</span>
          </div>
          <button onClick={onClose} className="search-results-close" aria-label="关闭搜索结果"><X /></button>
        </header>
        <div className="search-results-body">{children}</div>
      </div>
    </div>
  );
}
