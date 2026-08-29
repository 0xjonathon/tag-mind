'use client';
/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  FileText,
  FileUp,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  ScanSearch,
  Video,
} from 'lucide-react';
import { MediaItem } from '@/types/file';

interface DropZoneProps {
  files: MediaItem[];
  onFilesSelected: (files: File[]) => void;
  isProcessing: boolean;
  progressText: string;
  searchSlot: React.ReactNode;
}

interface LegacyEntry {
  isFile: boolean;
  isDirectory: boolean;
  file?: (callback: (file: File) => void) => void;
  createReader?: () => { readEntries: (callback: (entries: LegacyEntry[]) => void) => void };
}

type ItemWithEntry = DataTransferItem & { webkitGetAsEntry?: () => LegacyEntry | null };

async function readDirectory(reader: ReturnType<NonNullable<LegacyEntry['createReader']>>): Promise<LegacyEntry[]> {
  const collected: LegacyEntry[] = [];
  while (true) {
    const batch = await new Promise<LegacyEntry[]>((resolve) => reader.readEntries(resolve));
    if (!batch.length) return collected;
    collected.push(...batch);
  }
}

async function collectEntry(entry: LegacyEntry, output: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    await new Promise<void>((resolve) => entry.file?.((file) => {
      if (!file.name.startsWith('.')) output.push(file);
      resolve();
    }));
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const children = await readDirectory(entry.createReader());
    for (const child of children) await collectEntry(child, output);
  }
}

const MEDIA_META = {
  video: { label: '视频', icon: Video, color: '#DDF36A' },
  audio: { label: '音频', icon: AudioLines, color: '#FF8B6A' },
  image: { label: '图片', icon: ImageIcon, color: '#78D8CB' },
  document: { label: '文档', icon: FileText, color: '#C5B8FF' },
  other: { label: '素材', icon: ScanSearch, color: '#D8D4CA' },
} as const;

export function DropZone({ files, onFilesSelected, isProcessing, progressText, searchSlot }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const previewFiles = useMemo(() => files.slice(0, 8), [files]);
  const safeIndex = activeIndex % Math.max(1, previewFiles.length);
  const deckFiles = useMemo(() => {
    if (!previewFiles.length) return [];
    return Array.from({ length: Math.min(4, previewFiles.length) }, (_, offset) => (
      previewFiles[(safeIndex + offset) % previewFiles.length]
    ));
  }, [previewFiles, safeIndex]);

  useEffect(() => {
    if (previewFiles.length < 2) return;
    const timer = window.setInterval(() => setActiveIndex((current) => (current + 1) % previewFiles.length), 3800);
    return () => window.clearInterval(timer);
  }, [previewFiles.length]);

  const submitInput = (input: HTMLInputElement) => {
    const selected = Array.from(input.files || []).filter((file) => !file.name.startsWith('.'));
    if (selected.length) onFilesSelected(selected);
    input.value = '';
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const output: File[] = [];
    for (const item of Array.from(event.dataTransfer.items || [])) {
      if (item.kind !== 'file') continue;
      const entry = (item as ItemWithEntry).webkitGetAsEntry?.();
      if (entry) await collectEntry(entry, output);
      else {
        const file = item.getAsFile();
        if (file) output.push(file);
      }
    }
    if (output.length) onFilesSelected(output);
  };

  return (
    <section
      onDragOver={(event) => { event.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(event) => { event.preventDefault(); setIsDragOver(false); }}
      onDrop={handleDrop}
      className={`hero-shell ${isDragOver ? 'hero-shell-dragging' : ''}`}
    >
      <input ref={folderInput} type="file" multiple className="hidden" onChange={(event) => submitInput(event.currentTarget)} {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} />
      <input ref={filesInput} type="file" multiple accept="video/*,audio/*,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.rtf,.pdf" className="hidden" onChange={(event) => submitInput(event.currentTarget)} />

      <div className="hero-copy">
        <div className="hero-eyebrow"><span />SEARCH ACROSS EVERY FORMAT</div>
        <h1>听懂台词，看懂画面，<br />读懂文档，<span>一点线索直达内容。</span></h1>
        {searchSlot}

        <div className="hero-actions">
          <button type="button" onClick={() => folderInput.current?.click()} className="hero-primary">
            <FolderOpen />导入文件夹
          </button>
          <button type="button" onClick={() => filesInput.current?.click()} className="hero-secondary"><FileUp />选择文件</button>
        </div>
        <div className="hero-footnote"><span>视频 · 音频 · 图片 · 文档</span><span>索引文件，但不修改原文件信息。</span></div>
      </div>

      <div className="live-stage" aria-live="polite">
        {isProcessing ? (
          <div className="processing-card">
            <div className="processing-orbit"><LoaderCircle /></div>
            <strong>{progressText || 'AI整理中…'}</strong>
            <p>正在建立画面、声音与全文索引</p>
            <div className="processing-track"><span /></div>
          </div>
        ) : deckFiles.length ? (
          <div className="recent-deck">
            <div className="recent-deck-title"><span><i /> 最近内容</span><strong>{String(safeIndex + 1).padStart(2, '0')} / {String(previewFiles.length).padStart(2, '0')}</strong></div>
            {deckFiles.map((file, position) => {
              const meta = MEDIA_META[file.mediaType];
              const Icon = meta.icon;
              const thumbnail = file.thumbnailUrl || file.timelineFrames?.find((frame) => frame.thumbnailUrl)?.thumbnailUrl;
              return (
                <article
                  key={`${file.id}-${safeIndex}`}
                  className={`deck-card deck-card-${position}`}
                  style={{ '--deck-accent': meta.color } as React.CSSProperties}
                >
                  <div className="deck-media">
                    {thumbnail ? <img src={thumbnail} alt={file.originalName} /> : (
                      <div className="deck-fallback"><Icon /><span>{file.extension.toUpperCase()}</span></div>
                    )}
                    {file.mediaType === 'video' && <span className="live-play"><Play /></span>}
                    <span className="live-type" style={{ backgroundColor: meta.color }}><Icon />{meta.label}</span>
                  </div>
                  <div className="deck-content">
                    <strong title={file.originalName}>{file.originalName}</strong>
                    <p>{file.visualDescription || file.proofreadText || file.extractedText || '正在读取内容…'}</p>
                    <div><span>{file.durationFormatted || file.resolution || file.extension.toUpperCase()}</span><span>{file.status === 'done' ? '已完成索引' : '读取中'}</span></div>
                  </div>
                </article>
              );
            })}
            <div className="live-dots">{previewFiles.map((file, index) => <button key={file.id} aria-label={`预览 ${file.originalName}`} onClick={() => setActiveIndex(index)} className={index === safeIndex ? 'active' : ''} />)}</div>
          </div>
        ) : (
          <div className="empty-stage">
            <div className="empty-stage-grid" />
            <div className="empty-stage-mark"><ScanSearch /></div>
            <strong>最近内容会出现在这里</strong>
            <div className="empty-formats"><span>MEDIA</span><span>DOCS</span></div>
          </div>
        )}
      </div>
    </section>
  );
}
