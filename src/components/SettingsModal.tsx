'use client';

import React, { useRef, useState } from 'react';
import {
  ArrowRight,
  AudioLines,
  BrainCircuit,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  MonitorCog,
  SearchCode,
  ShieldCheck,
  Sparkles,
  Unplug,
  X,
} from 'lucide-react';
import { AISettings } from '@/types/file';

interface SettingsModalProps {
  onClose: () => void;
  settings: AISettings;
  onSaveSettings: (settings: AISettings) => void;
}

type ProviderKey = AISettings['provider'];
type TestState = { type: 'idle' | 'testing' | 'success' | 'error'; message: string };

const PROVIDERS: Array<{
  key: ProviderKey;
  name: string;
  description: string;
  values: Partial<AISettings>;
}> = [
  {
    key: 'custom',
    name: '自定义',
    description: '任意 OpenAI 兼容接口',
    values: { providerName: '我的 AI 服务' },
  },
  {
    key: 'openai',
    name: 'OpenAI',
    description: '官方 API 预设',
    values: {
      providerName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      visionModel: 'gpt-4.1-mini',
      transcriptionModel: 'gpt-4o-mini-transcribe',
      embeddingModel: 'text-embedding-3-small',
    },
  },
  {
    key: 'ollama',
    name: 'Ollama',
    description: '素材不离开本机',
    values: {
      providerName: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      model: 'llama3.2',
      visionModel: 'llama3.2-vision',
      transcriptionModel: '',
      embeddingModel: 'nomic-embed-text',
    },
  },
];

const CAPABILITIES = [
  { enabled: 'enableTextOrganization', model: 'model', icon: BrainCircuit, title: '文本整理', description: '校对 ASR、摘要和标签', placeholder: 'chat / reasoning model', hint: '' },
  { enabled: 'enableVision', model: 'visionModel', icon: Eye, title: '视觉理解', description: '画面描述与 OCR', placeholder: 'vision model', hint: '' },
  { enabled: 'enableTranscription', model: 'transcriptionModel', icon: AudioLines, title: '语音转写', description: '音视频时间戳台词', placeholder: 'speech-to-text model', hint: '阶跃星辰已适配专用 SSE 路径；推荐 stepaudio-2.5-asr，step-asr-1.1 会自动兼容。' },
  { enabled: 'enableSemanticSearch', model: 'embeddingModel', icon: SearchCode, title: '语义检索', description: '不可用时自动回退模糊检索', placeholder: 'embedding model（可选）', hint: '' },
] as const;

export function SettingsModal({ onClose, settings, onSaveSettings }: SettingsModalProps) {
  const [draft, setDraft] = useState<AISettings>(settings);
  const providerDrafts = useRef<Partial<Record<ProviderKey, AISettings>>>({ [settings.provider]: settings });
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<TestState>({ type: 'idle', message: '' });

  const update = <K extends keyof AISettings>(key: K, value: AISettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setTestState({ type: 'idle', message: '' });
  };

  const selectProvider = (provider: (typeof PROVIDERS)[number]) => {
    setDraft((current) => {
      providerDrafts.current[current.provider] = current;
      const cached = providerDrafts.current[provider.key];
      const next = cached || {
        ...current,
        provider: provider.key,
        enableCloudAI: true,
        ...provider.values,
      };
      providerDrafts.current[provider.key] = next;
      return next;
    });
    setTestState({ type: 'idle', message: '' });
  };

  const testConnection = async () => {
    setTestState({ type: 'testing', message: '正在连接文本模型…' });
    try {
      const response = await fetch('/api/test-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: draft.apiKey, baseUrl: draft.baseUrl, model: draft.model }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string; model?: string };
      if (!response.ok || !result.success) throw new Error(result.error || '接口未返回成功状态');
      setTestState({ type: 'success', message: `${result.model || draft.model} 已连接` });
    } catch (error) {
      setTestState({ type: 'error', message: error instanceof Error ? error.message : '连接失败' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#17251f]/32 backdrop-blur-[4px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="animate-slide-in absolute inset-y-0 right-0 flex w-full max-w-[610px] flex-col overflow-hidden border-l border-white/80 bg-[#faf8f2]/95 shadow-[-24px_0_80px_rgba(37,52,45,.2)] backdrop-blur-xl">
        <header className="flex items-start justify-between border-b border-[#e1e6f2] px-6 py-5 sm:px-8">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#74817b]"><Sparkles className="h-3.5 w-3.5 text-[#1f6f5f]" />AI engine</div>
            <h2 className="text-2xl font-semibold tracking-[-.04em]">把你的 AI 接进来</h2>
            <p className="mt-1.5 text-xs text-[#737d95]">接口和每一步使用的模型，都由你决定。</p>
          </div>
          <button aria-label="关闭设置" onClick={onClose} className="ui-icon"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-[.12em]">01 / 选择接入方式</h3>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-[#77746c]">启用 AI<input aria-label="启用 AI" type="checkbox" className="switch" checked={draft.enableCloudAI} onChange={(event) => update('enableCloudAI', event.target.checked)} /></label>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {PROVIDERS.map((provider) => {
                const active = draft.provider === provider.key;
                return (
                  <button key={provider.key} type="button" onClick={() => selectProvider(provider)} className={`relative rounded-2xl border p-4 text-left transition ${active ? 'border-[#1f6f5f] bg-[#1f6f5f] text-white shadow-[0_12px_28px_rgba(31,111,95,.22)]' : 'border-[#e0ddd4] bg-white/70 hover:-translate-y-0.5 hover:border-[#92b6a9] hover:bg-white'}`}>
                    {active && <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-[#edbd69] text-[#174d42]"><Check className="h-3 w-3" /></span>}
                    <div className="mt-1 text-sm font-semibold">{provider.name}</div>
                    <div className={`mt-1 text-[10px] ${active ? 'text-white/58' : 'text-[#8791a7]'}`}>{provider.description}</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-8">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-[.12em]">02 / 接口连接</h3>
            <div className="rounded-[22px] border border-[#e0e5f1] bg-white/70 p-4 shadow-[0_10px_30px_rgba(48,62,122,.04)] sm:p-5">
              {draft.provider === 'custom' && (
                <label className="mb-4 block">
                  <span className="mb-1.5 block text-[11px] font-semibold">服务名称</span>
                  <input className="field" value={draft.providerName} onChange={(event) => update('providerName', event.target.value)} placeholder="例如：公司内网 AI / SiliconFlow" />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold"><Unplug className="h-3.5 w-3.5" />API Base URL</span>
                <input className="field font-mono" value={draft.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://your-provider.com/v1" />
                <span className="mt-1.5 block text-[9px] text-[#98a1b6]">可填写服务根地址或 /v1；系统会自动补全并尝试标准 ASR 路径</span>
              </label>
              <label className="mt-4 block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold"><KeyRound className="h-3.5 w-3.5" />API Key</span>
                <div className="relative">
                  <input className="field pr-11 font-mono" type={showKey ? 'text' : 'password'} value={draft.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder="sk-...（本地服务可留空）" autoComplete="off" />
                  <button type="button" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8c9791] hover:text-[#1f6f5f]">{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
              </label>
              <div className="mt-4 flex items-center gap-3">
                <button type="button" onClick={testConnection} disabled={!draft.enableCloudAI || testState.type === 'testing' || !draft.baseUrl || !draft.model} className="flex h-10 items-center gap-2 rounded-full bg-[#1f6f5f] px-4 text-[11px] font-bold text-white transition hover:bg-[#18594d] disabled:cursor-not-allowed disabled:opacity-35">{testState.type === 'testing' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <MonitorCog className="h-3.5 w-3.5 text-[#edbd69]" />}测试连接</button>
                {testState.message && <span className={`text-[10px] ${testState.type === 'success' ? 'text-emerald-700' : testState.type === 'error' ? 'text-red-600' : 'text-[#88857d]'}`}>{testState.message}</span>}
              </div>
            </div>
          </section>

          <section className="mt-8">
            <div className="mb-3 flex items-end justify-between"><h3 className="text-xs font-bold uppercase tracking-[.12em]">03 / 模型路由</h3><span className="text-[9px] text-[#96938a]">四项能力可独立开关</span></div>
            <div className="overflow-hidden rounded-[22px] border border-[#e0e5f1] bg-white/70">
              {CAPABILITIES.map((capability, index) => {
                const Icon = capability.icon;
                const enabled = draft[capability.enabled];
                return (
                  <div key={capability.enabled} className={`grid gap-3 p-4 sm:grid-cols-[180px_1fr] sm:items-center sm:p-5 ${index ? 'border-t border-[#e7eaf3]' : ''} ${enabled ? '' : 'opacity-45'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`grid h-9 w-9 place-items-center rounded-xl ${enabled ? 'bg-[#e3efea] text-[#1f6f5f]' : 'bg-[#f0eee8] text-[#909a95]'}`}><Icon className="h-4 w-4" /></div>
                      <div><div className="text-xs font-semibold">{capability.title}</div><div className="mt-0.5 text-[9px] text-[#96938a]">{capability.description}</div></div>
                      <input aria-label={`启用${capability.title}`} type="checkbox" className="switch ml-auto sm:hidden" checked={enabled} onChange={(event) => update(capability.enabled, event.target.checked)} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <input className="field font-mono disabled:cursor-not-allowed" disabled={!enabled} value={draft[capability.model]} onChange={(event) => update(capability.model, event.target.value)} placeholder={capability.placeholder} />
                        <input aria-label={`启用${capability.title}`} type="checkbox" className="switch hidden shrink-0 sm:block" checked={enabled} onChange={(event) => update(capability.enabled, event.target.checked)} />
                      </div>
                      {capability.hint && <span className="mt-1.5 block text-[9px] leading-4 text-[#8c9791]">{capability.hint}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-8 grid gap-3 sm:grid-cols-2">
            <label className="rounded-2xl border border-[#e0e5f1] bg-white/70 p-4"><span className="text-[11px] font-semibold">识别语言</span><select className="field mt-2" value={draft.language} onChange={(event) => update('language', event.target.value)}><option value="auto">自动判断</option><option value="zh">中文</option><option value="en">英语</option><option value="ja">日语</option></select></label>
            <label className="rounded-2xl border border-[#e0e5f1] bg-white/70 p-4"><span className="text-[11px] font-semibold">ASR 分段上限</span><div className="mt-2 flex items-center gap-2"><input className="field" type="number" min={1} max={200} value={draft.maxUploadMb} onChange={(event) => update('maxUploadMb', Number(event.target.value) || 1)} /><span className="text-[10px] text-[#8791a7]">MB</span></div><span className="mt-1.5 block text-[9px] leading-4 text-[#8c9791]">超过后在本地自动拆分；404 时自动兼容带 /v1 与不带 /v1 的标准转写路径</span></label>
          </section>

          <div className="mt-5 flex gap-2.5 rounded-2xl bg-[#e9f8f7] p-4 text-[10px] leading-5 text-[#68778b]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#24a991]" /><span>API Key 仅保存在当前浏览器。素材分析请求会经本机服务转发到你配置的接口；原文件不会被改名、移动或删除。</span></div>
        </div>

        <footer className="flex items-center justify-between border-t border-[#e1e6f2] bg-white/75 px-6 py-4 sm:px-8">
          <div className="hidden text-[10px] text-[#74817b] sm:block">当前：<strong className="text-[#1d2925]">{draft.providerName || '未命名服务'}</strong> · {draft.model || '未指定模型'}</div>
          <div className="ml-auto flex gap-2"><button type="button" onClick={onClose} className="ui-ghost flex">取消</button><button type="button" onClick={() => { onSaveSettings(draft); onClose(); }} className="flex h-10 items-center gap-2 rounded-full bg-[#1f6f5f] px-5 text-[11px] font-bold text-white transition hover:bg-[#18594d]">保存并使用<ArrowRight className="h-3.5 w-3.5 text-[#edbd69]" /></button></div>
        </footer>
      </aside>
    </div>
  );
}
