'use client';
/* eslint-disable @next/next/no-img-element */

import React, { useRef, useState } from 'react';
import { ArrowRight, ImagePlus, LoaderCircle, Mic, MicOff, Search, X } from 'lucide-react';

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onVoiceQuery: (transcript: string) => Promise<void>;
  onImageQuery: (file: File) => Promise<void>;
  imageSearchPreview?: string;
  onClearImageQuery: () => void;
  isVoiceOrganizing?: boolean;
  isImageAnalyzing?: boolean;
  disabled?: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  query,
  onQueryChange,
  onSubmit,
  onVoiceQuery,
  onImageQuery,
  imageSearchPreview,
  onClearImageQuery,
  isVoiceOrganizing = false,
  isImageAnalyzing = false,
  disabled = false,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const next = query.trim();
    if (next && !disabled) onSubmit(next);
  };

  const toggleVoice = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      return;
    }

    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceError('当前浏览器不支持语音输入');
      return;
    }

    setVoiceError('');
    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognitionRef.current = recognition;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) void onVoiceQuery(transcript);
    };
    recognition.onerror = () => setVoiceError('没听清，请再试一次');
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    setIsListening(true);
    recognition.start();
  };

  const selectImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setVoiceError('');
    try {
      await onImageQuery(file);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : '图片理解失败，请重试');
    }
  };

  const busy = isVoiceOrganizing || isImageAnalyzing;

  return (
    <div className="hero-search-wrap">
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={selectImage} />
      <div className="hero-search">
        <Search aria-hidden="true" className="hero-search-icon" />
        {imageSearchPreview && (
          <button type="button" className="hero-image-preview" onClick={onClearImageQuery} aria-label="移除以图检索图片">
            <img src={imageSearchPreview} alt="以图检索图片" />
            <X />
          </button>
        )}
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
          placeholder="输入你能想到的任意信息"
          aria-label="输入你能想到的任意信息"
          disabled={disabled || busy}
        />
        {query && !busy && (
          <button type="button" onClick={() => onQueryChange('')} className="hero-search-clear" aria-label="清空搜索">
            <X />
          </button>
        )}
        {!imageSearchPreview && (
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={disabled || busy}
            className="hero-image-search"
            aria-label="上传图片查找相似内容"
            title="以图找内容"
          >
            {isImageAnalyzing ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}
          </button>
        )}
        <button
          type="button"
          onClick={toggleVoice}
          disabled={disabled || busy}
          className={`hero-voice ${isListening ? 'is-listening' : ''}`}
          aria-label={isListening ? '停止语音输入' : '语音输入'}
        >
          {isVoiceOrganizing ? <LoaderCircle className="animate-spin" /> : isListening ? <MicOff /> : <Mic />}
        </button>
        <button type="button" onClick={submit} disabled={!query.trim() || disabled || busy} className="hero-search-submit">
          <span>{busy ? (isImageAnalyzing ? '理解图片' : '正在整理') : '搜索'}</span>
          {busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
        </button>
      </div>
      {(voiceError || isListening || isImageAnalyzing) && <p className={`hero-search-note ${voiceError ? 'is-error' : ''}`}>{voiceError || (isImageAnalyzing ? '正在提取图片中的人物、场景、动作与文字…' : '正在倾听，说出你想找的内容…')}</p>}
    </div>
  );
};
