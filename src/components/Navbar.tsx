'use client';

import React from 'react';
import { Bot, Download, Settings2, Trash2 } from 'lucide-react';
import { AISettings, MediaItem } from '@/types/file';

interface NavbarProps {
  files: MediaItem[];
  onOpenSettings: () => void;
  onOpenExport: () => void;
  onClearFiles: () => void;
  settings: AISettings;
}

function LogoMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 46 46" className="h-11 w-11">
      <rect x="1" y="1" width="44" height="44" rx="13" fill="#16231F" />
      <path d="M13 14h7.5v18H13z" fill="#DDF36A" />
      <path d="M20.5 14 34 23 20.5 32V14Z" fill="#78D8CB" />
      <circle cx="34" cy="14" r="4" fill="#FF8B6A" stroke="#16231F" strokeWidth="2" />
    </svg>
  );
}

export const Navbar: React.FC<NavbarProps> = ({ files, onOpenSettings, onOpenExport, onClearFiles, settings }) => (
  <header className="sticky top-0 z-30 border-b border-[#16231f]/10 bg-[#f5f1e8]/90 backdrop-blur-xl">
    <div className="mx-auto flex h-[74px] max-w-[1500px] items-center justify-between gap-5 px-4 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <LogoMark />
        <div>
          <div className="text-[18px] font-extrabold tracking-[-0.05em] text-[#16231f]">TagMind</div>
          <p className="text-[10px] font-bold tracking-[.08em] text-[#78837d]">数字资产提炼检索Agent</p>
        </div>
      </div>

      <nav className="flex items-center gap-2">
        {files.length > 0 && (
          <>
            <span className="mr-2 hidden items-center gap-2 text-[11px] font-semibold text-[#68746f] md:flex"><i className="h-2 w-2 rounded-full bg-[#23a978] shadow-[0_0_0_4px_rgba(35,169,120,.12)]" />{files.length} 个素材在线</span>
            <button onClick={onOpenExport} className="ui-ghost hidden md:flex"><Download className="h-4 w-4" />导出场记</button>
            <button aria-label="清空素材" onClick={onClearFiles} className="ui-icon"><Trash2 className="h-4 w-4" /></button>
          </>
        )}
        <button onClick={onOpenSettings} className="ml-1 flex h-[42px] items-center gap-2 rounded-xl bg-[#16231f] px-3.5 text-[11px] font-bold text-white shadow-[0_8px_20px_rgba(22,35,31,.16)] transition hover:-translate-y-0.5 hover:bg-[#283a34]">
          {settings.enableCloudAI ? <Bot className="h-4 w-4 text-[#ddf36a]" /> : <Settings2 className="h-4 w-4" />}
          <span className="hidden sm:inline">模型配置</span>
          <span className={`h-1.5 w-1.5 rounded-full ${settings.enableCloudAI ? 'bg-[#ddf36a]' : 'bg-white/35'}`} />
        </button>
      </nav>
    </div>
  </header>
);
