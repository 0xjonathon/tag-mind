'use client';

import React, { useState } from 'react';
import { ArrowDownToLine, Check, FileSpreadsheet, FileText, X } from 'lucide-react';
import { MediaItem } from '@/types/file';
import { exportShotList } from '@/lib/shotListExporter';

interface ShotListModalProps { onClose: () => void; files: MediaItem[]; }

export const ShotListModal: React.FC<ShotListModalProps> = ({ onClose, files }) => {
  const [format, setFormat] = useState<'markdown' | 'csv'>('markdown');
  const [excludeDuplicates, setExcludeDuplicates] = useState(true);
  const duplicateCount = files.filter((file) => file.isDuplicate).length;
  const targets = excludeDuplicates ? files.filter((file) => !file.isDuplicate) : files;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17251f]/35 p-4 backdrop-blur-sm">
      <div className="animate-fade-in w-full max-w-2xl overflow-hidden rounded-[30px] border border-white/80 bg-[#faf8f2] shadow-[0_30px_100px_rgba(37,52,45,.28)]">
        <header className="flex items-start justify-between border-b border-[#e1e6f2] bg-white/70 px-6 py-5">
          <div><div className="mb-1.5 text-[9px] font-bold uppercase tracking-[.16em] text-[#1f6f5f]">Export / Shot list</div><h2 className="text-xl font-semibold tracking-[-.04em]">把 AI 索引交给剪辑师</h2><p className="mt-1 text-[10px] text-[#74817b]">文件名、台词、时间戳和标签一次导出</p></div>
          <button aria-label="关闭导出" onClick={onClose} className="ui-icon"><X className="h-4 w-4" /></button>
        </header>

        <div className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-3">
            {[{ value: 'markdown' as const, icon: FileText, name: 'Markdown', note: '适合飞书 / Notion' }, { value: 'csv' as const, icon: FileSpreadsheet, name: 'CSV 表格', note: '适合筛选和交接' }].map((item) => { const Icon = item.icon; const active = format === item.value; return <button key={item.value} onClick={() => setFormat(item.value)} className={`relative rounded-2xl border p-4 text-left transition ${active ? 'border-[#1f6f5f] bg-[#1f6f5f] text-white shadow-[0_12px_28px_rgba(31,111,95,.2)]' : 'border-[#e0ddd4] bg-white/70 hover:border-[#92b6a9] hover:bg-white'}`}>{active && <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-[#edbd69] text-[#174d42]"><Check className="h-3 w-3" /></span>}<Icon className={`h-5 w-5 ${active ? 'text-[#f0d498]' : 'text-[#74817b]'}`} /><div className="mt-5 text-xs font-semibold">{item.name}</div><div className={`mt-1 text-[9px] ${active ? 'text-white/60' : 'text-[#7f8a84]'}`}>{item.note}</div></button>; })}
          </div>

          <div><div className="mb-2 flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-[.14em] text-[#74817b]">内容预览</span><span className="text-[9px] text-[#7f8a84]">{targets.length} 条</span></div><div className="max-h-52 overflow-y-auto rounded-2xl bg-[#18332c] p-4 font-mono text-[9px] leading-5 text-white/60"><div className="font-bold text-[#edbd69]"># TagMind 素材场记单</div><div className="mb-3 text-white/35">{new Date().toLocaleDateString()} · {targets.length} assets</div>{targets.slice(0, 5).map((file, index) => <div key={file.id} className="border-t border-white/10 py-2"><span className="text-[#a9d0c3]">{String(index + 1).padStart(2, '0')} / {file.category}</span> <span className="text-white/80">{file.originalName}</span><div className="truncate text-white/40">{file.proofreadText}</div></div>)}</div></div>

          {duplicateCount > 0 && <label className="flex items-center justify-between rounded-2xl border border-[#e0e5f1] bg-white/70 p-4 text-[10px] font-semibold">导出时排除 {duplicateCount} 个重复素材<input type="checkbox" className="switch" checked={excludeDuplicates} onChange={(event) => setExcludeDuplicates(event.target.checked)} /></label>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[#e1ded5] bg-white/75 px-6 py-4"><button onClick={onClose} className="ui-ghost flex">取消</button><button onClick={() => { exportShotList(files, format, excludeDuplicates); onClose(); }} className="flex h-10 items-center gap-2 rounded-full bg-[#1f6f5f] px-5 text-[11px] font-bold text-white"><ArrowDownToLine className="h-3.5 w-3.5 text-[#edbd69]" />下载场记单</button></footer>
      </div>
    </div>
  );
};
