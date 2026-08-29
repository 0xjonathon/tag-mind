'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { DropZone } from '@/components/DropZone';
import { FileDetailModal } from '@/components/FileDetailModal';
import { FileGrid } from '@/components/FileGrid';
import { Navbar } from '@/components/Navbar';
import { SearchBar } from '@/components/SearchBar';
import { SearchResultsModal } from '@/components/SearchResultsModal';
import { SettingsModal } from '@/components/SettingsModal';
import { ShotListModal } from '@/components/ShotListModal';
import { TagSidebar } from '@/components/TagSidebar';
import { cosineSimilarity, createQueryEmbedding, createVisualSearchQuery, processCreatorFiles } from '@/lib/aiService';
import { fuzzyMatch, mediaSearchText } from '@/lib/fuzzySearch';
import { clusterPeople } from '@/lib/faceRecognition';
import { AISettings, CreatorCategory, MediaItem, MediaType } from '@/types/file';

const SETTINGS_KEY = 'tagmind_ai_settings_v2';
const LEGACY_SETTINGS_KEY = 'clipmind_ai_settings_v2';

const DEFAULT_SETTINGS: AISettings = {
  enableCloudAI: true,
  provider: 'custom',
  providerName: '我的 AI 服务',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  visionModel: 'gpt-4.1-mini',
  transcriptionModel: 'gpt-4o-mini-transcribe',
  embeddingModel: 'text-embedding-3-small',
  enableTranscription: true,
  enableVision: true,
  enableTextOrganization: true,
  enableSemanticSearch: true,
  language: 'zh',
  maxUploadMb: 24,
  enableLocalDeduplication: true,
  autoProofread: true,
};

function readSavedSettings(): AISettings {
  try {
    const saved = window.localStorage.getItem(SETTINGS_KEY) || window.localStorage.getItem(LEGACY_SETTINGS_KEY);
    return saved ? { ...DEFAULT_SETTINGS, ...(JSON.parse(saved) as Partial<AISettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function Home() {
  const [files, setFiles] = useState<MediaItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<MediaItem | null>(null);
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isVoiceOrganizing, setIsVoiceOrganizing] = useState(false);
  const [isImageAnalyzing, setIsImageAnalyzing] = useState(false);
  const [imageSearchPreview, setImageSearchPreview] = useState('');
  const [submittedSearchMode, setSubmittedSearchMode] = useState<'text' | 'visual'>('text');
  const [semanticScores, setSemanticScores] = useState<Record<string, number>>({});
  const [semanticStatus, setSemanticStatus] = useState<'idle' | 'searching' | 'ready' | 'fallback'>('idle');
  const [selectedMediaType, setSelectedMediaType] = useState<MediaType | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CreatorCategory | null>(null);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [selectedExtension, setSelectedExtension] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [showOnlyDuplicates, setShowOnlyDuplicates] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShotListOpen, setIsShotListOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettings(readSavedSettings()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const query = submittedQuery.trim();
    const hasIndexedVectors = files.some((file) => file.embedding?.length);
    if (!query || !settings.enableSemanticSearch || !hasIndexedVectors) {
      const resetTimer = window.setTimeout(() => {
        setSemanticStatus(query ? 'fallback' : 'idle');
        setSemanticScores({});
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSemanticStatus('searching');
      try {
        const queryVector = await createQueryEmbedding(query, settings);
        if (!queryVector || cancelled) return;
        const scores = Object.fromEntries(
          files.map((file) => [file.id, cosineSimilarity(queryVector, file.embedding)]),
        );
        setSemanticScores(scores);
        setSemanticStatus('ready');
      } catch (error) {
        console.warn('Semantic search fallback:', error);
        if (!cancelled) {
          setSemanticScores({});
          setSemanticStatus('fallback');
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [files, submittedQuery, settings]);

  const handleSaveSettings = (next: AISettings) => {
    setSettings(next);
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('Save settings failed:', error);
    }
  };

  const handleFilesSelected = async (rawFiles: File[]) => {
    if (!rawFiles.length) return;
    setIsProcessing(true);
    setProgressText('准备本地只读索引…');

    try {
      const results = await processCreatorFiles(rawFiles, settings, (current, total, message) => {
        setProgressText(`[${current}/${total}] ${message}`);
      });
      setFiles((previous) => clusterPeople([...results, ...previous]));
    } catch (error) {
      const message = error instanceof Error ? error.message : '素材处理失败';
      setProgressText(message);
      window.setTimeout(() => setProgressText(''), 4000);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetFilters = () => {
    setSelectedMediaType(null);
    setSelectedCategory(null);
    setSelectedMood(null);
    setSelectedExtension(null);
    setSelectedTag(null);
    setSelectedPersonId(null);
    setShowOnlyDuplicates(false);
  };

  const submitSearch = (query: string) => {
    const clean = query.trim();
    if (!clean) return;
    setSearchQuery(clean);
    setSubmittedQuery(clean);
    setSubmittedSearchMode(imageSearchPreview ? 'visual' : 'text');
    resetFilters();
    setIsSearchOpen(true);
  };

  const handleVoiceQuery = async (transcript: string) => {
    setIsVoiceOrganizing(true);
    try {
      const response = await fetch('/api/organize-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
          enableCloudAI: settings.enableCloudAI && settings.enableTextOrganization,
        }),
      });
      const payload = (await response.json()) as { success?: boolean; query?: string };
      setSearchQuery(payload.query?.trim() || transcript);
    } catch {
      setSearchQuery(transcript);
    } finally {
      setIsVoiceOrganizing(false);
    }
  };

  const handleImageQuery = async (file: File) => {
    setIsImageAnalyzing(true);
    try {
      const result = await createVisualSearchQuery(file, settings);
      setImageSearchPreview(result.previewUrl);
      setSearchQuery(result.query);
    } finally {
      setIsImageAnalyzing(false);
    }
  };

  const filteredFiles = useMemo(() => {
    const query = submittedQuery.trim().toLowerCase();
    return files
      .filter((file) => {
        if (submittedSearchMode === 'visual' && !['image', 'video'].includes(file.mediaType)) return false;
        if (selectedMediaType && file.mediaType !== selectedMediaType) return false;
        if (selectedCategory && file.category !== selectedCategory) return false;
        if (selectedMood && file.dimensions.mood !== selectedMood) return false;
        if (selectedExtension && (file.extension.trim().toLowerCase().replace(/^\./, '') || '无扩展名') !== selectedExtension) return false;
        if (selectedTag && !file.tags.includes(selectedTag)) return false;
        if (selectedPersonId && !file.faces?.some((face) => face.personId === selectedPersonId)) return false;
        if (showOnlyDuplicates && !file.isDuplicate) return false;
        if (!query) return true;

        const keywordMatch = fuzzyMatch(mediaSearchText(file), query);
        const semanticMatch = (semanticScores[file.id] || 0) >= 0.32;
        return keywordMatch || semanticMatch;
      })
      .sort((left, right) => (semanticScores[right.id] || 0) - (semanticScores[left.id] || 0));
  }, [
    files,
    submittedQuery,
    selectedCategory,
    selectedExtension,
    selectedMediaType,
    selectedMood,
    selectedPersonId,
    selectedTag,
    semanticScores,
    showOnlyDuplicates,
    submittedSearchMode,
  ]);

  const libraryFiles = useMemo(() => files.filter((file) => {
    if (selectedMediaType && file.mediaType !== selectedMediaType) return false;
    if (selectedCategory && file.category !== selectedCategory) return false;
    if (selectedMood && file.dimensions.mood !== selectedMood) return false;
    if (selectedExtension && (file.extension.trim().toLowerCase().replace(/^\./, '') || '无扩展名') !== selectedExtension) return false;
    if (selectedTag && !file.tags.includes(selectedTag)) return false;
    if (selectedPersonId && !file.faces?.some((face) => face.personId === selectedPersonId)) return false;
    if (showOnlyDuplicates && !file.isDuplicate) return false;
    return true;
  }), [files, selectedCategory, selectedExtension, selectedMediaType, selectedMood, selectedPersonId, selectedTag, showOnlyDuplicates]);

  const indexedCount = files.filter((file) => file.status === 'done').length;
  const mediaCounts = files.reduce((counts, file) => ({ ...counts, [file.mediaType]: counts[file.mediaType] + 1 }), {
    video: 0,
    audio: 0,
    image: 0,
    document: 0,
    other: 0,
  } as Record<MediaType, number>);

  return (
    <div className="min-h-screen text-[#16231f] antialiased">
      <Navbar
        files={files}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenExport={() => setIsShotListOpen(true)}
        onClearFiles={() => {
          if (window.confirm('确定清空当前索引吗？原始素材不会被删除。')) {
            setFiles([]);
            setSearchQuery('');
            setSubmittedQuery('');
            setImageSearchPreview('');
            setSubmittedSearchMode('text');
            setIsSearchOpen(false);
            resetFilters();
          }
        }}
        settings={settings}
      />

      <main className="mx-auto max-w-[1500px] px-4 pb-14 pt-4 sm:px-6 lg:px-8">
        <section className="stats-strip" aria-label="素材索引统计">
          {[
            { label: '视频', value: mediaCounts.video, accent: '#DDF36A' },
            { label: '音频', value: mediaCounts.audio, accent: '#FF8B6A' },
            { label: '图片', value: mediaCounts.image, accent: '#78D8CB' },
            { label: '文档', value: mediaCounts.document, accent: '#C5B8FF' },
            { label: '完成索引', value: `${indexedCount}/${files.length}`, accent: '#16231F' },
          ].map((item) => (
            <div key={item.label} className="stats-item">
              <i style={{ backgroundColor: item.accent }} />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </section>

        <DropZone
          files={files}
          onFilesSelected={handleFilesSelected}
          isProcessing={isProcessing}
          progressText={progressText}
          searchSlot={(
            <SearchBar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              onSubmit={submitSearch}
              onVoiceQuery={handleVoiceQuery}
              onImageQuery={handleImageQuery}
              imageSearchPreview={imageSearchPreview}
              onClearImageQuery={() => setImageSearchPreview('')}
              isVoiceOrganizing={isVoiceOrganizing}
              isImageAnalyzing={isImageAnalyzing}
            />
          )}
        />

        {files.length > 0 && (
          <section className="mt-8 flex flex-col items-start gap-5 lg:flex-row">
            <TagSidebar
              files={files}
              selectedMediaType={selectedMediaType}
              onSelectMediaType={setSelectedMediaType}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
              selectedMood={selectedMood}
              onSelectMood={setSelectedMood}
              selectedExtension={selectedExtension}
              onSelectExtension={setSelectedExtension}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              selectedPersonId={selectedPersonId}
              onSelectPerson={setSelectedPersonId}
              showOnlyDuplicates={showOnlyDuplicates}
              onToggleDuplicates={setShowOnlyDuplicates}
              onResetFilters={resetFilters}
            />
            <div className="min-w-0 flex-1">
              <FileGrid files={libraryFiles} searchQuery="" onSelectFile={setSelectedFile} onDeleteFile={(id) => setFiles((current) => current.filter((file) => file.id !== id))} />
            </div>
          </section>
        )}
      </main>

      {isSearchOpen && (
        <SearchResultsModal
          query={submittedQuery}
          resultCount={filteredFiles.length}
          totalCount={files.length}
          semanticStatus={semanticStatus}
          onClose={() => setIsSearchOpen(false)}
        >
          <TagSidebar
            variant="toolbar"
            files={files}
            selectedMediaType={selectedMediaType}
            onSelectMediaType={setSelectedMediaType}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            selectedMood={selectedMood}
            onSelectMood={setSelectedMood}
            selectedExtension={selectedExtension}
            onSelectExtension={setSelectedExtension}
            selectedTag={selectedTag}
            onSelectTag={setSelectedTag}
            selectedPersonId={selectedPersonId}
            onSelectPerson={setSelectedPersonId}
            showOnlyDuplicates={showOnlyDuplicates}
            onToggleDuplicates={setShowOnlyDuplicates}
            onResetFilters={resetFilters}
          />
          <div className="mt-6">
            <FileGrid files={filteredFiles} searchQuery={submittedQuery} onSelectFile={setSelectedFile} onDeleteFile={(id) => setFiles((current) => current.filter((file) => file.id !== id))} />
          </div>
        </SearchResultsModal>
      )}

      {selectedFile && (
        <FileDetailModal
          key={selectedFile.id}
          file={selectedFile}
          searchQuery={isSearchOpen ? submittedQuery : ''}
          onClose={() => setSelectedFile(null)}
          onUpdateFile={(updated) => setFiles((current) => current.map((file) => file.id === updated.id ? updated : file))}
        />
      )}
      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => setIsSettingsOpen(false)}
          onSaveSettings={handleSaveSettings}
        />
      )}
      {isShotListOpen && <ShotListModal onClose={() => setIsShotListOpen(false)} files={files} />}
    </div>
  );
}
