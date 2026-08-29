'use client';
/* eslint-disable @next/next/no-img-element */

import React, { useMemo, useRef, useState } from 'react';
import { Check, Clock3, Copy, Eye, FileText, Film, Music, Play, ShieldCheck, Sparkles, UsersRound, X } from 'lucide-react';
import { CreatorCategory, MediaItem, TimelineFrame } from '@/types/file';
import { formatFileSize } from '@/lib/creatorParsers';
import { HighlightedText } from '@/components/HighlightedText';

interface FileDetailModalProps {
  file: MediaItem;
  searchQuery: string;
  onClose: () => void;
  onUpdateFile: (updated: MediaItem) => void;
}

const CATEGORIES: CreatorCategory[] = ['A-Roll口播', 'B-Roll空镜', 'BGM配乐', '转场音效', '自媒体封面', '表情包梗图', '教程录屏', '文档资料', '其他文件'];
const formatSeconds = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const parseTime = (value?: string | number) => {
  if (value === undefined) return 0;
  return typeof value === 'number' ? value : value.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
};

export const FileDetailModal: React.FC<FileDetailModalProps> = ({ file, searchQuery, onClose, onUpdateFile }) => {
  const [category, setCategory] = useState<CreatorCategory>(file.category);
  const [proofreadText, setProofreadText] = useState(file.proofreadText);
  const [tags, setTags] = useState(file.tags);
  const [newTag, setNewTag] = useState('');
  const [copied, setCopied] = useState(false);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);

  const seek = (value?: string | number) => {
    if (value === undefined || !mediaRef.current) return;
    mediaRef.current.currentTime = parseTime(value);
    void mediaRef.current.play();
  };

  const timeline = useMemo(() => {
    if (file.timelineFrames?.length) return file.timelineFrames;
    return file.keyQuotes
      .filter((quote) => quote.time)
      .map((quote, index): TimelineFrame => ({
        time: parseTime(quote.time),
        timeFormatted: quote.time || '00:00',
        thumbnailUrl: file.thumbnailUrl,
        label: quote.text || `片段 ${index + 1}`,
        kind: file.mediaType === 'audio' ? 'audio-waveform' : 'video-frame',
      }));
  }, [file]);

  const people = useMemo(() => Array.from(
    new Map((file.faces || []).filter((face) => face.personId).map((face) => [face.personId, face])).values(),
  ), [file.faces]);

  const timelineCaption = (frame: TimelineFrame) => {
    if (frame.kind === 'video-frame') {
      return frame.description || '该时刻的画面尚未完成视觉描述';
    }
    const quote = file.keyQuotes.find((item) => item.time && Math.abs(parseTime(item.time) - frame.time) < 8);
    if (quote) return quote.text;
    const segment = file.transcriptSegments?.find((item) => frame.time >= item.start && frame.time <= item.end + 5);
    return segment?.text || frame.description || '该时刻的音频内容尚未转写';
  };

  const addTag = () => {
    const clean = newTag.trim();
    if (!clean) return;
    const tag = clean.startsWith('#') ? clean : `#${clean}`;
    setTags((current) => current.includes(tag) ? current : [...current, tag]);
    setNewTag('');
  };

  const save = () => {
    onUpdateFile({ ...file, category, proofreadText, tags });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17251f]/38 p-3 backdrop-blur-sm sm:p-5">
      <div className="animate-fade-in flex max-h-[95vh] w-full max-w-[1480px] flex-col overflow-hidden rounded-[28px] border border-white/80 bg-[#faf8f2] shadow-[0_30px_120px_rgba(33,49,42,.28)]">
        <header className="flex items-start justify-between border-b border-[#e2ded3] bg-white/75 px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.15em] text-[#7c8882]"><Sparkles className="h-3.5 w-3.5 text-[#1f6f5f]" />文件详情</div>
            <h2 className="truncate text-lg font-semibold tracking-[-.03em]"><HighlightedText text={file.originalName} query={searchQuery} /></h2>
          </div>
          <button aria-label="关闭详情" onClick={onClose} className="ui-icon shrink-0"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid flex-1 overflow-y-auto xl:grid-cols-[minmax(320px,.85fr)_minmax(380px,1fr)_300px]">
          <section className="bg-[linear-gradient(145deg,#223c34,#172a24)] p-5 text-white sm:p-7">
            <div className="overflow-hidden rounded-[20px] border border-white/10 bg-[#102019] shadow-[0_18px_40px_rgba(5,15,11,.3)]">
              {file.mediaType === 'video' && <video ref={mediaRef as React.RefObject<HTMLVideoElement>} controls src={file.fileUrl} poster={file.thumbnailUrl} className="aspect-video w-full object-contain" />}
              {file.mediaType === 'audio' && <div className="flex aspect-video flex-col items-center justify-center gap-5 bg-[radial-gradient(circle_at_center,#315c50,#172a24)] p-6"><Music className="h-10 w-10 text-[#edbd69]" /><audio ref={mediaRef as React.RefObject<HTMLAudioElement>} controls src={file.fileUrl} className="w-full max-w-sm" /></div>}
              {file.mediaType === 'image' && <img src={file.thumbnailUrl || file.fileUrl} alt={file.originalName} className="max-h-[390px] w-full object-contain" />}
              {file.mediaType === 'document' && <div className="flex aspect-video flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_center,#3b3754,#211f31)] p-8 text-center"><FileText className="h-12 w-12 text-[#c5b8ff]" /><strong className="max-w-sm truncate text-[15px]">{file.originalName}</strong><span className="rounded-lg bg-white/10 px-3 py-1.5 font-mono text-[10px] uppercase text-white/60">{file.extension} · {file.resolution || '全文已读取'}</span></div>}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {[['类型', file.extension.toUpperCase()], ['规格', file.durationFormatted || file.resolution || '—'], ['大小', formatFileSize(file.size)]].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
                  <div className="mt-1 truncate font-mono text-[12px] text-white/80">{value}</div>
                </div>
              ))}
            </div>

            {people.length > 0 && (
              <div className="mt-6">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-white/50"><UsersRound className="h-3.5 w-3.5 text-[#78d8cb]" />识别人物</div>
                <div className="flex flex-wrap gap-2">
                  {people.map((person) => (
                    <div key={person.personId} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/7 py-1 pl-1 pr-3">
                      <img src={person.avatarUrl} alt={person.personLabel || '人物'} className="h-9 w-9 rounded-full object-cover" />
                      <span className="text-[11px] font-bold text-white/75">{person.personLabel}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {file.keyQuotes.length > 0 && (
              <div className="mt-6">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-white/50"><Clock3 className="h-3.5 w-3.5 text-[#edbd69]" />可用片段</div>
                <div className="space-y-2">
                  {file.keyQuotes.map((quote, index) => (
                    <button key={`${quote.time}-${index}`} onClick={() => seek(quote.time)} className="group flex w-full items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 text-left hover:border-[#edbd69]/50 hover:bg-white/7">
                      {quote.time && <span className="font-mono text-[11px] text-[#edbd69]">{quote.time}</span>}
                      <HighlightedText text={quote.text} query={searchQuery} className="line-clamp-1 text-[12px] text-white/70 group-hover:text-white" />
                      <Play className="ml-auto h-3 w-3 shrink-0 opacity-40" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 flex items-start gap-2 rounded-xl bg-white/5 p-3 text-[11px] leading-5 text-white/50"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" /><span>原始文件名锁定。分析来源：{file.analysisSource || 'local'}，文件不会被修改。</span></div>
          </section>

          <section className="space-y-6 p-5 sm:p-7">
            {file.analysisWarning && <div className="rounded-xl border border-[#ecd6ad] bg-[#fff7e9] p-3 text-[12px] leading-5 text-[#805923]">{file.analysisWarning}</div>}

            {searchQuery.trim() && (
              <div className="rounded-2xl border border-[#e2c889] bg-[#fff8e8] p-4">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#9a6a23]">搜索命中 · {searchQuery}</div>
                <HighlightedText text={proofreadText || file.extractedText || file.originalName} query={searchQuery} className="line-clamp-3 text-[12px] leading-5 text-[#5d543f]" />
              </div>
            )}

            {(file.extractedText || file.ocrText || file.visualDescription) && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#74817b]"><FileText className="h-3.5 w-3.5 text-[#1f6f5f]" />原始识别证据</div>
                <div className="max-h-44 space-y-3 overflow-y-auto rounded-2xl border border-[#e2ded3] bg-white/75 p-4 text-[12px] leading-5 text-[#64716b]">
                  {file.extractedText && <p className="whitespace-pre-wrap"><HighlightedText text={file.extractedText} query={searchQuery} /></p>}
                  {file.ocrText && <p className="border-t border-[#e7e3da] pt-3">OCR · <HighlightedText text={file.ocrText} query={searchQuery} /></p>}
                  {file.visualDescription && <p className="flex gap-2 border-t border-[#e7e3da] pt-3"><Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" /><HighlightedText text={file.visualDescription} query={searchQuery} /></p>}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#74817b]"><Sparkles className="h-3.5 w-3.5 text-[#1f6f5f]" />AI 整理结果</label>
                <button onClick={() => { void navigator.clipboard.writeText(proofreadText); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }} className="flex items-center gap-1 text-[11px] font-semibold text-[#1f6f5f]">{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? '已复制' : '复制'}</button>
              </div>
              <textarea rows={7} value={proofreadText} onChange={(event) => setProofreadText(event.target.value)} className="field resize-none text-[13px] leading-6" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label><span className="mb-2 block text-[11px] font-bold uppercase tracking-[.14em] text-[#74817b]">素材分类</span><select value={category} onChange={(event) => setCategory(event.target.value as CreatorCategory)} className="field">{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <div><span className="mb-2 block text-[11px] font-bold uppercase tracking-[.14em] text-[#74817b]">AI 识别维度</span><div className="rounded-xl bg-[#eeece5] px-3 py-2.5 text-[12px] leading-5 text-[#626d67]">{[file.dimensions.shotType, file.dimensions.mood, file.dimensions.soundType, file.dimensions.hookType].filter(Boolean).join(' · ') || '暂无维度'}</div></div>
            </div>

            <div>
              <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.14em] text-[#74817b]">标签</span>
              <div className="mb-2 flex flex-wrap gap-1.5">{tags.map((tag) => <span key={tag} className="flex items-center gap-1 rounded-full bg-[#e3efea] px-2.5 py-1 text-[11px] font-semibold text-[#1f6f5f]"><HighlightedText text={tag} query={searchQuery} /><button onClick={() => setTags((current) => current.filter((item) => item !== tag))}><X className="h-3 w-3" /></button></span>)}</div>
              <div className="flex gap-2"><input className="field min-w-0" value={newTag} onChange={(event) => setNewTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addTag(); }} placeholder="添加标签" /><button onClick={addTag} className="min-w-[64px] shrink-0 whitespace-nowrap rounded-full bg-[#1f6f5f] px-4 text-[12px] font-bold text-white">添加</button></div>
            </div>
          </section>

          {(file.mediaType === 'video' || file.mediaType === 'audio') && (
            <aside className="border-l border-[#dfdbd0] bg-[#f1eee6] p-5 sm:p-6">
              <div className="sticky top-0">
                <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#74817b]"><Film className="h-3.5 w-3.5 text-[#1f6f5f]" />内容时间轴</div>
                <p className="mb-5 text-[11px] leading-5 text-[#89938e]">每张卡片描述对应时刻的实际画面；点击即可跳转</p>
                {timeline.length ? (
                  <div className="relative max-h-[68vh] space-y-4 overflow-y-auto pr-1 before:absolute before:bottom-4 before:left-[9px] before:top-3 before:w-px before:bg-[#cfd7d1]">
                    {timeline.map((frame, index) => (
                      <button key={`${frame.time}-${index}`} onClick={() => seek(frame.time)} className="group relative block w-full pl-7 text-left">
                        <span className="absolute left-[4px] top-2 z-10 h-3 w-3 rounded-full border-[3px] border-[#f1eee6] bg-[#1f6f5f] ring-1 ring-[#9bb7ad]" />
                        <div className="overflow-hidden rounded-2xl border border-[#dad6cc] bg-white shadow-[0_7px_20px_rgba(44,60,52,.06)] transition group-hover:-translate-y-0.5 group-hover:border-[#9ab8ad] group-hover:shadow-[0_12px_28px_rgba(44,60,52,.12)]">
                          {frame.thumbnailUrl ? <img src={frame.thumbnailUrl} alt={frame.label || frame.timeFormatted} className="aspect-[16/8] w-full object-cover" /> : <div className="grid aspect-[16/6] place-items-center bg-[#203d34] text-[#edbd69]"><Music className="h-5 w-5" /></div>}
                          <div className="p-3">
                            <div className="mb-1 font-mono text-[11px] font-bold text-[#1f6f5f]">{frame.timeFormatted || formatSeconds(frame.time)}</div>
                            <HighlightedText text={timelineCaption(frame)} query={searchQuery} className="line-clamp-2 text-[11px] leading-4 text-[#67736d]" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : <div className="rounded-2xl border border-dashed border-[#cbc7bd] p-5 text-center text-[11px] leading-5 text-[#89938e]">当前格式未能提取时间画面，仍可通过播放器查看素材。</div>}
              </div>
            </aside>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[#e2ded3] bg-white/80 px-5 py-4 sm:px-7"><button onClick={onClose} className="ui-ghost flex">取消</button><button onClick={save} className="h-10 rounded-full bg-[#1f6f5f] px-5 text-[12px] font-bold text-white shadow-[0_8px_20px_rgba(31,111,95,.2)]">保存修改</button></footer>
      </div>
    </div>
  );
};
