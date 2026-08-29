'use client';
/* eslint-disable @next/next/no-img-element */

import React from 'react';
import { AlertTriangle, AudioLines, FileText, Image as ImageIcon, Layers3, RotateCcw, SlidersHorizontal, Tag, UsersRound, Video } from 'lucide-react';
import { CreatorCategory, MediaItem, MediaType } from '@/types/file';

interface TagSidebarProps {
  files: MediaItem[];
  selectedMediaType: MediaType | null;
  onSelectMediaType: (type: MediaType | null) => void;
  selectedCategory: CreatorCategory | null;
  onSelectCategory: (cat: CreatorCategory | null) => void;
  selectedMood: string | null;
  onSelectMood: (mood: string | null) => void;
  selectedExtension: string | null;
  onSelectExtension: (extension: string | null) => void;
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  selectedPersonId: string | null;
  onSelectPerson: (personId: string | null) => void;
  showOnlyDuplicates: boolean;
  onToggleDuplicates: (val: boolean) => void;
  onResetFilters: () => void;
  variant?: 'sidebar' | 'toolbar';
}

function counts<T extends string>(files: MediaItem[], read: (file: MediaItem) => T | undefined): Array<[T, number]> {
  const map = new Map<T, number>();
  files.forEach((file) => { const value = read(file); if (value) map.set(value, (map.get(value) || 0) + 1); });
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

const MEDIA_LABELS: Record<MediaType, string> = { video: '视频', audio: '音频', image: '图片', document: '文档', other: '其他' };
const MEDIA_ICONS = { video: Video, audio: AudioLines, image: ImageIcon, document: FileText, other: Layers3 };
const MEDIA_COLORS: Record<MediaType, string> = { video: '#DDF36A', audio: '#FF8B6A', image: '#78D8CB', document: '#C5B8FF', other: '#D8D4CA' };

function extensionKey(file: MediaItem): string {
  return file.extension.trim().toLowerCase().replace(/^\./, '') || '无扩展名';
}

function extensionLabel(extension: string): string {
  return extension === '无扩展名' ? extension : `.${extension.toUpperCase()}`;
}

function FilterButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return <button onClick={onClick} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[11px] transition ${active ? 'bg-[#16231f] font-bold text-white' : 'text-[#65716b] hover:bg-[#ede9df] hover:text-[#16231f]'}`}><span className="truncate">{label}</span><span className={`font-mono text-[9px] ${active ? 'text-[#ddf36a]' : 'text-[#929a95]'}`}>{count}</span></button>;
}

function ResultFilterChip({ active, label, count, color, onClick }: { active: boolean; label: string; count: number; color?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`result-filter-chip ${active ? 'active' : ''}`}>
      {color && <i style={{ backgroundColor: color }} />}
      <span>{label}</span><b>{count}</b>
    </button>
  );
}

export const TagSidebar: React.FC<TagSidebarProps> = ({ files, selectedMediaType, onSelectMediaType, selectedCategory, onSelectCategory, selectedMood, onSelectMood, selectedExtension, onSelectExtension, selectedTag, onSelectTag, selectedPersonId, onSelectPerson, showOnlyDuplicates, onToggleDuplicates, onResetFilters, variant = 'sidebar' }) => {
  const mediaStats = React.useMemo(() => counts(files, (file) => file.mediaType), [files]);
  const extensionStats = React.useMemo(() => counts(files, extensionKey), [files]);
  const categoryStats = React.useMemo(() => counts(files, (file) => file.category), [files]);
  const moodStats = React.useMemo(() => counts(files, (file) => file.dimensions.mood), [files]);
  const tagStats = React.useMemo(() => {
    const map = new Map<string, number>();
    files.forEach((file) => file.tags.forEach((tag) => { if (tag && !tag.includes('重复')) map.set(tag, (map.get(tag) || 0) + 1); }));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [files]);
  const personStats = React.useMemo(() => {
    const people = new Map<string, { id: string; label: string; avatarUrl: string; fileIds: Set<string>; faceCount: number; quality: number }>();
    files.forEach((file) => file.faces?.forEach((face) => {
      if (!face.personId || !face.personLabel) return;
      const quality = face.detectionScore * Math.sqrt(face.box.width * face.box.height);
      const current = people.get(face.personId);
      if (current) {
        current.fileIds.add(file.id);
        current.faceCount += 1;
        if (quality > current.quality) {
          current.avatarUrl = face.avatarUrl;
          current.quality = quality;
        }
      } else {
        people.set(face.personId, { id: face.personId, label: face.personLabel, avatarUrl: face.avatarUrl, fileIds: new Set([file.id]), faceCount: 1, quality });
      }
    }));
    return Array.from(people.values()).sort((left, right) => {
      const leftNumber = Number(left.label.match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
      const rightNumber = Number(right.label.match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER);
      return leftNumber - rightNumber || right.fileIds.size - left.fileIds.size;
    });
  }, [files]);
  const duplicateCount = files.filter((file) => file.isDuplicate).length;
  const hasFilter = Boolean(selectedMediaType || selectedCategory || selectedMood || selectedExtension || selectedTag || selectedPersonId || showOnlyDuplicates);

  if (variant === 'toolbar') {
    return (
      <div className="result-filter-bar">
        <div className="result-filter-heading">
          <span><SlidersHorizontal />筛选搜索结果</span>
          {hasFilter && <button onClick={onResetFilters}><RotateCcw />重置</button>}
        </div>
        <div className="result-filter-row">
          <span className="result-filter-label">类型</span>
          <ResultFilterChip active={!selectedMediaType} label="全部" count={files.length} onClick={() => onSelectMediaType(null)} />
          {mediaStats.map(([type, count]) => <ResultFilterChip key={type} active={selectedMediaType === type} label={MEDIA_LABELS[type]} count={count} color={MEDIA_COLORS[type]} onClick={() => onSelectMediaType(selectedMediaType === type ? null : type)} />)}
          {duplicateCount > 0 && <ResultFilterChip active={showOnlyDuplicates} label="重复素材" count={duplicateCount} onClick={() => onToggleDuplicates(!showOnlyDuplicates)} />}
        </div>
        {extensionStats.length > 0 && <div className="result-filter-row"><span className="result-filter-label">文件类型</span>{extensionStats.map(([extension, count]) => <ResultFilterChip key={extension} active={selectedExtension === extension} label={extensionLabel(extension)} count={count} onClick={() => onSelectExtension(selectedExtension === extension ? null : extension)} />)}</div>}
        {personStats.length > 0 && (
          <div className="result-filter-row">
            <span className="result-filter-label"><UsersRound />人物</span>
            {personStats.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => onSelectPerson(selectedPersonId === person.id ? null : person.id)}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-2.5 text-[10px] font-bold transition ${selectedPersonId === person.id ? 'border-[#16231f] bg-[#16231f] text-white' : 'border-[#d9d4c9] bg-white text-[#59645f] hover:border-[#8ca097]'}`}
              >
                <img src={person.avatarUrl} alt={person.label} className="h-7 w-7 rounded-full object-cover" />
                <span>{person.label}</span>
                <b className={selectedPersonId === person.id ? 'text-[#ddf36a]' : 'text-[#929a95]'}>{person.fileIds.size}</b>
              </button>
            ))}
          </div>
        )}
        {categoryStats.length > 0 && <div className="result-filter-row"><span className="result-filter-label">分类</span>{categoryStats.map(([category, count]) => <ResultFilterChip key={category} active={selectedCategory === category} label={category} count={count} onClick={() => onSelectCategory(selectedCategory === category ? null : category)} />)}</div>}
        {moodStats.length > 0 && <div className="result-filter-row"><span className="result-filter-label">情绪</span>{moodStats.slice(0, 6).map(([mood, count]) => <ResultFilterChip key={mood} active={selectedMood === mood} label={mood} count={count} onClick={() => onSelectMood(selectedMood === mood ? null : mood)} />)}</div>}
        {tagStats.length > 0 && <div className="result-filter-row"><span className="result-filter-label"><Tag />标签</span>{tagStats.slice(0, 14).map(([tag, count]) => <ResultFilterChip key={tag} active={selectedTag === tag} label={tag} count={count} onClick={() => onSelectTag(selectedTag === tag ? null : tag)} />)}</div>}
      </div>
    );
  }

  return (
    <aside className="w-full shrink-0 lg:w-[238px]">
      <div className="app-panel overflow-hidden rounded-[20px] lg:sticky lg:top-[94px] lg:max-h-[calc(100vh-112px)]">
        <div className="border-b border-[#ded9ce] p-4">
          <div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.12em]"><SlidersHorizontal className="h-4 w-4" />筛选</span>{hasFilter && <button onClick={onResetFilters} className="flex items-center gap-1 text-[10px] font-bold text-[#52605a]"><RotateCcw className="h-3 w-3" />重置</button>}</div>
          <button onClick={onResetFilters} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-[12px] font-bold transition ${!hasFilter ? 'bg-[#16231f] text-white' : 'bg-[#ede9df] text-[#5f6b65] hover:bg-[#e5e0d5]'}`}><span>全部文件</span><span className={`rounded-md px-1.5 py-0.5 font-mono text-[9px] ${!hasFilter ? 'bg-[#ddf36a] text-[#16231f]' : 'bg-white'}`}>{files.length}</span></button>
        </div>

        <div className="space-y-5 overflow-y-auto p-4 lg:max-h-[calc(100vh-246px)]">
          {mediaStats.length > 0 && <section><div className="mb-2 text-[9px] font-extrabold uppercase tracking-[.16em] text-[#8a938e]">媒介类型</div><div className="space-y-2">{mediaStats.map(([type, count]) => { const Icon = MEDIA_ICONS[type]; const active = selectedMediaType === type; return <button key={type} onClick={() => onSelectMediaType(active ? null : type)} className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl border px-3 py-3 text-[12px] font-bold transition ${active ? 'border-[#16231f] bg-[#16231f] text-white' : 'border-[#ddd8cd] bg-[#faf7f0] text-[#5f6b65] hover:border-[#9aa39e]'}`}><span className="grid h-7 w-7 place-items-center rounded-lg text-[#16231f]" style={{ backgroundColor: MEDIA_COLORS[type] }}><Icon className="h-3.5 w-3.5" /></span><span>{MEDIA_LABELS[type]}</span><span className={`ml-auto font-mono text-[9px] ${active ? 'text-[#ddf36a]' : 'text-[#8c9690]'}`}>{count}</span></button>; })}</div></section>}
          {extensionStats.length > 0 && <section><div className="mb-2 text-[9px] font-extrabold uppercase tracking-[.16em] text-[#8a938e]">文件类型</div><div className="grid grid-cols-2 gap-1.5">{extensionStats.map(([extension, count]) => <FilterButton key={extension} active={selectedExtension === extension} label={extensionLabel(extension)} count={count} onClick={() => onSelectExtension(selectedExtension === extension ? null : extension)} />)}</div></section>}
          {personStats.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[.16em] text-[#8a938e]"><UsersRound className="h-3 w-3" />人物</div>
              <div className="grid grid-cols-3 gap-2">
                {personStats.map((person) => {
                  const active = selectedPersonId === person.id;
                  return (
                    <button key={person.id} type="button" title={`${person.label} · ${person.fileIds.size} 个素材`} onClick={() => onSelectPerson(active ? null : person.id)} className={`group rounded-xl border p-1.5 text-center transition ${active ? 'border-[#16231f] bg-[#16231f] text-white shadow-[0_8px_18px_rgba(22,35,31,.16)]' : 'border-[#ddd8cd] bg-[#faf7f0] text-[#65716b] hover:-translate-y-0.5 hover:border-[#8ca097]'}`}>
                      <span className="relative mx-auto block aspect-square w-full overflow-hidden rounded-lg bg-[#e6e2d9]">
                        <img src={person.avatarUrl} alt={person.label} className="h-full w-full object-cover transition group-hover:scale-105" />
                        <i className={`absolute bottom-1 right-1 min-w-4 rounded-full px-1 py-0.5 font-mono text-[8px] not-italic ${active ? 'bg-[#ddf36a] text-[#16231f]' : 'bg-[#16231f]/80 text-white'}`}>{person.fileIds.size}</i>
                      </span>
                      <span className="mt-1.5 block truncate text-[9px] font-bold">{person.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {categoryStats.length > 0 && <section><div className="mb-2 text-[9px] font-extrabold uppercase tracking-[.16em] text-[#8a938e]">内容分类</div><div className="space-y-1">{categoryStats.map(([category, count]) => <FilterButton key={category} active={selectedCategory === category} label={category} count={count} onClick={() => onSelectCategory(selectedCategory === category ? null : category)} />)}</div></section>}
          {moodStats.length > 0 && <section><div className="mb-2 text-[9px] font-extrabold uppercase tracking-[.16em] text-[#8a938e]">情绪氛围</div><div className="space-y-1">{moodStats.map(([mood, count]) => <FilterButton key={mood} active={selectedMood === mood} label={mood} count={count} onClick={() => onSelectMood(selectedMood === mood ? null : mood)} />)}</div></section>}
          {duplicateCount > 0 && <button onClick={() => onToggleDuplicates(!showOnlyDuplicates)} className={`flex w-full items-center gap-2 rounded-xl border px-3 py-3 text-[11px] font-bold ${showOnlyDuplicates ? 'border-[#ff8b6a] bg-[#ffe5dc] text-[#8d3f2c]' : 'border-[#e5c9be] bg-[#fff8f2] text-[#9b5c4b]'}`}><AlertTriangle className="h-3.5 w-3.5" />疑似重复<span className="ml-auto">{duplicateCount}</span></button>}
          {tagStats.length > 0 && <section><div className="mb-2 flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[.16em] text-[#8a938e]"><Tag className="h-3 w-3" />AI 标签</div><div className="flex flex-wrap gap-1.5">{tagStats.slice(0, 18).map(([tag, count]) => <button key={tag} onClick={() => onSelectTag(selectedTag === tag ? null : tag)} className={`rounded-lg border px-2 py-1.5 text-[10px] transition ${selectedTag === tag ? 'border-[#16231f] bg-[#ddf36a] font-bold text-[#16231f]' : 'border-[#ddd8cd] bg-[#faf7f0] text-[#65716b] hover:border-[#9aa39e]'}`}>{tag} <span className="opacity-55">{count}</span></button>)}</div></section>}
        </div>
      </div>
    </aside>
  );
};
