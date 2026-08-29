import React from 'react';
import { matchedTerms } from '@/lib/fuzzySearch';

export function HighlightedText({ text, query, className }: { text: string; query: string; className?: string }) {
  const terms = matchedTerms(text, query);
  if (!query.trim() || !terms.length) return <span className={className}>{text}</span>;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const lowerTerms = new Set(terms.map((term) => term.toLocaleLowerCase()));
  return (
    <span className={className}>
      {text.split(pattern).map((part, index) => lowerTerms.has(part.toLocaleLowerCase())
        ? <mark key={`${part}-${index}`} className="rounded bg-[#f3c96d]/55 px-0.5 text-inherit ring-1 ring-[#d49a2e]/20">{part}</mark>
        : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>)}
    </span>
  );
}
