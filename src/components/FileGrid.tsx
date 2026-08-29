'use client';
/* eslint-disable @next/next/no-img-element */

import React, { useState } from 'react';
import { AlertTriangle, AudioLines, BrainCircuit, Clock3, FileText, Image as ImageIcon, LayoutGrid, List, Play, ScanSearch, Trash2, Video } from 'lucide-react';
import { MediaItem, MediaType } from '@/types/file';
import { formatFileSize } from '@/lib/creatorParsers';
import { HighlightedText } from '@/components/HighlightedText';
import { fuzzyMatch } from '@/lib/fuzzySearch';

interface FileGridProps { files: MediaItem[]; searchQuery: string; onSelectFile: (file: MediaItem) => void; onDeleteFile: (fileId: string) => void; }

function MediaIcon({ type }: { type: MediaType }) {
  if (type === 'video') return <Video className="h-4 w-4" />;
  if (type === 'audio') return <AudioLines className="h-4 w-4" />;
  if (type === 'image') return <ImageIcon className="h-4 w-4" />;
  if (type === 'document') return <FileText className="h-4 w-4" />;
  return <ScanSearch className="h-4 w-4" />;
}

function sourceLabel(file: MediaItem) {
  if (file.mediaType === 'document') return file.analysisSource === 'llm' ? 'AI 全文理解' : '文档全文';
  if (file.analysisSource === 'asr_llm') return '画面 + 语音';
  if (file.analysisSource === 'vision_llm') return '画面理解';
  if (file.analysisSource === 'asr') return '语音转写';
  if (file.analysisSource === 'fallback') return '本地索引';
  return '本地读取';
}

const TYPE_STYLE: Record<MediaType, { bg: string; badge: string; label: string }> = {
  video: { bg: 'bg-[#16231f]', badge: 'bg-[#ddf36a]', label: '视频' },
  audio: { bg: 'bg-[#263a33]', badge: 'bg-[#ff8b6a]', label: '音频' },
  image: { bg: 'bg-[#233b38]', badge: 'bg-[#78d8cb]', label: '图片' },
  document: { bg: 'bg-[#29263b]', badge: 'bg-[#c5b8ff]', label: '文档' },
  other: { bg: 'bg-[#313345]', badge: 'bg-[#c5b8ff]', label: '其他' },
};

export const FileGrid: React.FC<FileGridProps> = ({ files, searchQuery, onSelectFile, onDeleteFile }) => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  if (files.length === 0) return (
    <div className="app-panel flex min-h-56 flex-col items-center justify-center rounded-[22px] p-8 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-[18px] border border-[#16231f] bg-[#ddf36a] shadow-[6px_6px_0_#16231f]"><ScanSearch className="h-5 w-5" /></div>
      <p className="text-[15px] font-bold">没有找到匹配素材</p>
      <p className="mt-2 text-[12px] text-[#748079]">换个说法，或清除上方筛选条件</p>
    </div>
  );

  return (
    <section>
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-3"><h2 className="text-[18px] font-bold tracking-[-.03em]">文件内容</h2><span className="rounded-lg bg-[#16231f] px-2.5 py-1 text-[10px] font-extrabold text-[#ddf36a]">{files.length}</span></div>
        <div className="flex rounded-xl border border-[#d8d3c7] bg-[#fffdf8] p-1">
          <button aria-label="网格视图" onClick={() => setViewMode('grid')} className={`grid h-8 w-9 place-items-center rounded-lg transition ${viewMode === 'grid' ? 'bg-[#16231f] text-[#ddf36a]' : 'text-[#87918b] hover:text-[#16231f]'}`}><LayoutGrid className="h-4 w-4" /></button>
          <button aria-label="列表视图" onClick={() => setViewMode('list')} className={`grid h-8 w-9 place-items-center rounded-lg transition ${viewMode === 'list' ? 'bg-[#16231f] text-[#ddf36a]' : 'text-[#87918b] hover:text-[#16231f]'}`}><List className="h-4 w-4" /></button>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((file) => {
            const style = TYPE_STYLE[file.mediaType];
            const people = Array.from(new Map((file.faces || []).filter((face) => face.personId).map((face) => [face.personId, face])).values());
            const matchedFrame = searchQuery
              ? file.timelineFrames?.find((frame) => frame.description && fuzzyMatch(frame.description, searchQuery))
              : undefined;
            const summary = matchedFrame
              ? `[${matchedFrame.timeFormatted}] ${matchedFrame.description}`
              : file.visualDescription || file.proofreadText || '等待内容分析';
            return (
              <article key={file.id} onClick={() => onSelectFile(file)} className="group overflow-hidden rounded-[20px] border border-[#d8d3c8] bg-[#fffdf8] p-2.5 shadow-[0_8px_28px_rgba(22,35,31,.055)] transition hover:-translate-y-1 hover:border-[#16231f]/40 hover:shadow-[0_18px_38px_rgba(22,35,31,.12)]">
                <div className={`relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-[14px] ${style.bg} text-white`}>
                  {file.thumbnailUrl ? <img src={file.thumbnailUrl} alt={file.originalName} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]" /> : file.mediaType === 'audio' ? <div className="flex h-16 items-center gap-1.5 text-[#ff8b6a]">{[22, 42, 62, 35, 72, 48, 25, 58, 39, 66, 31].map((height, index) => <span key={index} className="w-1 rounded-full bg-current" style={{ height }} />)}</div> : <MediaIcon type={file.mediaType} />}
                  <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2.5">
                    <span className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-extrabold text-[#16231f] ${style.badge}`}><MediaIcon type={file.mediaType} />{style.label}</span>
                    <span className="flex items-center gap-1 rounded-lg bg-[#16231f]/82 px-2 py-1.5 text-[9px] font-bold text-white backdrop-blur"><BrainCircuit className="h-3 w-3 text-[#ddf36a]" />{sourceLabel(file)}</span>
                  </div>
                  {file.mediaType === 'video' && <div className="absolute inset-0 grid place-items-center bg-[#16231f]/10 opacity-0 transition group-hover:opacity-100"><span className="grid h-11 w-11 place-items-center rounded-full bg-[#ddf36a] text-[#16231f] shadow-xl"><Play className="ml-0.5 h-4 w-4 fill-current" /></span></div>}
                  {people.length > 0 && (
                    <div className="absolute bottom-2.5 left-2.5 flex items-center pl-1">
                      {people.slice(0, 4).map((person, index) => <img key={person.personId} src={person.avatarUrl} alt={person.personLabel || '人物'} title={person.personLabel} className="-ml-1 h-8 w-8 rounded-full border-2 border-white object-cover shadow-md" style={{ zIndex: people.length - index }} />)}
                      {people.length > 4 && <span className="-ml-1 grid h-8 min-w-8 place-items-center rounded-full border-2 border-white bg-[#16231f] px-1 text-[9px] font-bold text-white">+{people.length - 4}</span>}
                    </div>
                  )}
                  {(file.durationFormatted || file.resolution) && <span className="absolute bottom-2.5 right-2.5 rounded-lg bg-[#16231f]/82 px-2 py-1.5 font-mono text-[9px] text-white backdrop-blur">{file.durationFormatted || file.resolution}</span>}
                </div>

                <div className="px-1.5 pb-1 pt-3.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1"><h3 className="truncate text-[13px] font-extrabold" title={file.originalName}><HighlightedText text={file.originalName} query={searchQuery} /></h3><p className="mt-1.5 font-mono text-[9px] uppercase tracking-[.08em] text-[#8d9690]">{file.extension} · {formatFileSize(file.size)}</p></div>
                    <button aria-label={`移除 ${file.originalName}`} onClick={(event) => { event.stopPropagation(); onDeleteFile(file.id); }} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#9ba39f] opacity-0 transition hover:bg-[#ffe6dd] hover:text-[#b95034] group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  {file.analysisWarning && <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-[#eed7a6] bg-[#fff4d8] px-2.5 py-2 text-[11px] font-semibold text-[#825b19]"><AlertTriangle className="h-3.5 w-3.5" />查看处理说明</div>}
                  <p className="mt-3 line-clamp-2 min-h-11 text-[12px] leading-[1.8] text-[#68746f]"><HighlightedText text={summary} query={searchQuery} /></p>
                  <div className="mt-3 flex items-center gap-1.5 overflow-hidden"><span className="shrink-0 rounded-lg bg-[#e7e2d7] px-2.5 py-1.5 text-[10px] font-bold"><HighlightedText text={file.category} query={searchQuery} /></span>{file.tags.slice(0, 2).map((tag) => <span key={tag} className="truncate rounded-lg border border-[#e1dcd1] px-2.5 py-1.5 text-[10px] text-[#68746f]"><HighlightedText text={tag} query={searchQuery} /></span>)}</div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="app-panel overflow-x-auto rounded-[20px]">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[minmax(220px,1.2fr)_130px_minmax(220px,1fr)_110px_36px] gap-4 border-b border-[#ded9ce] bg-[#ede8de] px-5 py-3 text-[9px] font-extrabold uppercase tracking-[.14em] text-[#7d8882]"><span>素材</span><span>分类</span><span>内容摘要</span><span>规格</span><span /></div>
            {files.map((file) => <div key={file.id} role="button" tabIndex={0} onClick={() => onSelectFile(file)} onKeyDown={(event) => { if (event.key === 'Enter') onSelectFile(file); }} className="group grid grid-cols-[minmax(220px,1.2fr)_130px_minmax(220px,1fr)_110px_36px] items-center gap-4 border-b border-[#e7e2d8] px-5 py-3.5 transition last:border-0 hover:bg-[#f7f3eb]"><div className="flex min-w-0 items-center gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[#16231f] ${TYPE_STYLE[file.mediaType].badge}`}><MediaIcon type={file.mediaType} /></div><div className="min-w-0"><div className="truncate text-[12px] font-extrabold"><HighlightedText text={file.originalName} query={searchQuery} /></div><div className="mt-1 text-[9px] uppercase text-[#929a95]">{sourceLabel(file)}</div></div></div><span className="text-[11px] font-semibold text-[#5e6a64]"><HighlightedText text={file.category} query={searchQuery} /></span><span className="truncate text-[11px] text-[#717c76]"><HighlightedText text={file.visualDescription || file.proofreadText} query={searchQuery} /></span><span className="flex items-center gap-1 font-mono text-[10px] text-[#7f8983]"><Clock3 className="h-3 w-3" />{file.durationFormatted || file.resolution || formatFileSize(file.size)}</span><button aria-label={`移除 ${file.originalName}`} onClick={(event) => { event.stopPropagation(); onDeleteFile(file.id); }} className="grid h-8 w-8 place-items-center rounded-lg text-[#98a09c] hover:bg-[#ffe6dd] hover:text-[#b95034]"><Trash2 className="h-4 w-4" /></button></div>)}
          </div>
        </div>
      )}
    </section>
  );
};
