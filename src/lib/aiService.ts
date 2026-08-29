import {
  AISettings,
  BatchAnalysisResult,
  MediaItem,
  TranscriptSegment,
  TranscriptionResult,
} from '@/types/file';
import {
  captureAudioMetadata,
  captureVideoMetadata,
  formatDuration,
  getMediaTypeFromExtension,
  localCreatorHeuristic,
} from './creatorParsers';
import { calculateFileHash } from './deduplication';
import { extractDocumentText } from './documentParsers';
import { detectFaces } from './faceRecognition';
import {
  createLocalFeatureIndex,
  createVisualContainmentQuery,
  createVisualDescriptors,
  VisualContainmentQuery,
  VisualDescriptor,
} from './visualSearch';

interface ApiResponse<T> {
  success: boolean;
  error?: string;
  warning?: string;
  result?: T;
  results?: T;
  embeddings?: number[][];
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

async function readApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const json = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !json.success) throw new Error(json.error || `请求失败 (${response.status})`);
  return json;
}

function formatTime(seconds: number): string {
  return formatDuration(Math.max(0, seconds));
}

function transcriptForPrompt(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => `[${formatTime(segment.start)}–${formatTime(segment.end)}] ${segment.text}`)
    .join('\n');
}

function searchableText(item: MediaItem): string {
  return [
    item.originalName,
    item.projectPath,
    item.category,
    item.timelineFrames?.map((frame) => `${frame.timeFormatted} ${frame.description || ''}`).join(' '),
    item.faces?.map((face) => face.personLabel).filter(Boolean).join(' '),
    item.extractedText,
    item.proofreadText,
    item.visualDescription,
    item.ocrText,
    item.tags.join(' '),
    Object.values(item.dimensions).join(' '),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8_000);
}

async function imageFileToPreview(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined;
  const source = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('图片读取失败'));
      element.src = source;
    });

    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.78);
  } finally {
    URL.revokeObjectURL(source);
  }
}

async function transcribeFile(file: File, settings: AISettings): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('apiKey', settings.apiKey);
  form.append('baseUrl', settings.baseUrl);
  form.append('model', settings.transcriptionModel);
  form.append('language', settings.language);

  const response = await fetch('/api/transcribe', { method: 'POST', body: form });
  const payload = await readApiResponse<TranscriptionResult>(response);
  if (!payload.result) throw new Error('语音接口没有返回转写结果。');
  return payload.result;
}

function createWavFile(samples: Int16Array, sampleRate: number, fileName: string): File {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return new File([buffer], fileName, { type: 'audio/wav' });
}

async function splitMediaForTranscription(file: File, maxUploadMb: number): Promise<Array<{ file: File; offset: number }>> {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('当前浏览器无法进行本地音频分段。');
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const sampleRate = Math.min(16_000, decoded.sampleRate);
    const maxPcmBytes = Math.max(1_000_000, Math.floor(maxUploadMb * 1024 * 1024 * 0.82));
    const samplesPerChunk = Math.max(sampleRate * 30, Math.floor((maxPcmBytes - 44) / 2));
    const totalSamples = Math.ceil(decoded.duration * sampleRate);
    const chunks: Array<{ file: File; offset: number }> = [];

    for (let chunkStart = 0, part = 1; chunkStart < totalSamples; chunkStart += samplesPerChunk, part += 1) {
      const chunkEnd = Math.min(totalSamples, chunkStart + samplesPerChunk);
      const pcm = new Int16Array(chunkEnd - chunkStart);
      for (let targetIndex = chunkStart; targetIndex < chunkEnd; targetIndex += 1) {
        const sourceStart = Math.floor((targetIndex / sampleRate) * decoded.sampleRate);
        const sourceEnd = Math.max(sourceStart + 1, Math.floor(((targetIndex + 1) / sampleRate) * decoded.sampleRate));
        let sum = 0;
        let count = 0;
        for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
          const data = decoded.getChannelData(channel);
          for (let sourceIndex = sourceStart; sourceIndex < Math.min(sourceEnd, data.length); sourceIndex += 1) {
            sum += data[sourceIndex];
            count += 1;
          }
        }
        const value = Math.max(-1, Math.min(1, count ? sum / count : 0));
        pcm[targetIndex - chunkStart] = value < 0 ? value * 0x8000 : value * 0x7fff;
      }
      chunks.push({
        file: createWavFile(pcm, sampleRate, `${file.name.replace(/\.[^.]+$/, '')}-part-${part}.wav`),
        offset: chunkStart / sampleRate,
      });
    }
    return chunks;
  } finally {
    await context.close();
  }
}

function requiresWavConversion(file: File, settings: AISettings): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const usesStepFunAsr = /(?:^|\.)api\.stepfun\.com$/i.test((() => {
    try { return new URL(settings.baseUrl).hostname; } catch { return ''; }
  })()) || /^step(?:audio|-asr)/i.test(settings.transcriptionModel);
  return usesStepFunAsr && !['mp3', 'wav', 'm4a', 'ogg', 'pcm'].includes(extension);
}

async function transcribeWithChunking(file: File, settings: AISettings): Promise<TranscriptionResult> {
  const maxBytes = settings.maxUploadMb * 1024 * 1024;
  if (file.size <= maxBytes && !requiresWavConversion(file, settings)) return transcribeFile(file, settings);

  const chunks = await splitMediaForTranscription(file, settings.maxUploadMb);
  const results: TranscriptionResult[] = [];
  for (const chunk of chunks) results.push(await transcribeFile(chunk.file, settings));
  return {
    text: results.map((result) => result.text).filter(Boolean).join(' '),
    segments: results.flatMap((result, index) => {
      const offset = chunks[index].offset;
      return result.segments.map((segment) => ({ ...segment, start: segment.start + offset, end: segment.end + offset }));
    }),
    language: results.find((result) => result.language)?.language,
    duration: chunks.length ? chunks[chunks.length - 1].offset + (results.at(-1)?.duration || 0) : undefined,
  };
}

async function analyzeOne(item: MediaItem, previewDataUrl: string | undefined, settings: AISettings) {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filesMeta: [
        {
          id: item.id,
          name: item.originalName,
          mediaType: item.mediaType,
          durationFormatted: item.durationFormatted,
          resolution: item.resolution,
          rawText: item.extractedText || '',
          transcriptWithTimecodes: transcriptForPrompt(item.transcriptSegments || []),
          previewDataUrl,
          timelinePreviews: item.timelineFrames
            ?.filter((frame) => frame.kind === 'video-frame' && frame.thumbnailUrl)
            .slice(0, 16)
            .map((frame) => ({
              time: frame.time,
              timeFormatted: frame.timeFormatted,
              imageDataUrl: frame.thumbnailUrl,
            })),
        },
      ],
      customApiKey: settings.apiKey,
      customBaseUrl: settings.baseUrl,
      model: settings.model,
      visionModel: settings.visionModel,
      enableCloudAI: settings.enableCloudAI,
      enableVision: settings.enableVision,
      enableTextOrganization: settings.enableTextOrganization,
    }),
  });

  const payload = await readApiResponse<BatchAnalysisResult[]>(response);
  return { result: payload.results?.[0], warning: payload.warning };
}

async function attachEmbeddings(items: MediaItem[], settings: AISettings): Promise<MediaItem[]> {
  if (!settings.enableCloudAI || !settings.enableSemanticSearch || !settings.embeddingModel.trim()) return items;
  const targets = items.filter((item) => !item.isDuplicate);
  if (!targets.length) return items;

  const response = await fetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.embeddingModel,
      input: targets.map(searchableText),
    }),
  });
  const payload = await readApiResponse<never>(response);
  const vectors = payload.embeddings || [];
  const vectorById = new Map(targets.map((item, index) => [item.id, vectors[index]]));
  return items.map((item) => ({ ...item, embedding: vectorById.get(item.id) || item.embedding }));
}

/**
 * 本地读取元数据和指纹；外部 AI 仅处理用户显式开启的 ASR、视觉与文本整理任务。
 */
export async function processCreatorFiles(
  rawFiles: File[],
  settings: AISettings,
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<MediaItem[]> {
  const validFiles = rawFiles.filter((file) => {
    const extension = file.name.split('.').pop() || '';
    return getMediaTypeFromExtension(extension) !== 'other';
  });
  if (!validFiles.length) return [];

  const total = validFiles.length;
  const prepared: Array<{ item: MediaItem; previewDataUrl?: string }> = [];

  for (let index = 0; index < validFiles.length; index += 1) {
    const file = validFiles[index];
    const fileWithPath = file as File & { path?: string; tagMindAbsolutePath?: string; tagMindRelativePath?: string };
    const absolutePath = (fileWithPath.tagMindAbsolutePath || fileWithPath.path)?.trim();
    const relativePath = (fileWithPath.tagMindRelativePath || file.webkitRelativePath).replace(/^\/+/, '');
    const projectPath = absolutePath || relativePath || file.name;
    const pathKind: MediaItem['pathKind'] = absolutePath
      ? 'absolute'
      : relativePath
        ? 'relative'
        : 'filename';
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const mediaType = getMediaTypeFromExtension(extension);
    onProgress?.(index + 1, total, `读取素材：${file.name}`);

    let hash: string | undefined;
    if (settings.enableLocalDeduplication) {
      try {
        hash = await calculateFileHash(file);
      } catch (error) {
        console.warn('File hash failed:', error);
      }
    }

    let duration: number | undefined;
    let durationFormatted: string | undefined;
    let resolution: string | undefined;
    let thumbnailUrl: string | undefined;
    let previewDataUrl: string | undefined;
    let timelineFrames: MediaItem['timelineFrames'];
    let faces: MediaItem['faces'];
    let extractedText: string | undefined;
    let documentSummary: string | undefined;
    let documentWarning: string | undefined;
    let faceWarning: string | undefined;
    let visualDescriptors: VisualDescriptor[] | undefined;
    let visualFeatureModel: MediaItem['visualFeatureModel'];
    const fileUrl = URL.createObjectURL(file);

    if (mediaType === 'video') {
      const meta = await captureVideoMetadata(file);
      duration = meta.duration;
      durationFormatted = meta.durationFormatted;
      resolution = meta.resolution;
      thumbnailUrl = meta.thumbnailUrl;
      previewDataUrl = meta.thumbnailUrl || undefined;
      timelineFrames = meta.timelineFrames;
      const visualFrames = timelineFrames.filter((frame) => frame.kind === 'video-frame' && frame.thumbnailUrl);
      for (const frame of visualFrames) {
        try {
          frame.visualDescriptors = await createVisualDescriptors(frame.thumbnailUrl || '', 'coarse');
          frame.visualFeatureModel = await createLocalFeatureIndex(frame.thumbnailUrl || '');
        } catch (error) {
          console.warn('Video visual index failed:', error);
        }
      }
      visualDescriptors = visualFrames.flatMap((frame) => frame.visualDescriptors || []);
    } else if (mediaType === 'audio') {
      const meta = await captureAudioMetadata(file);
      duration = meta.duration;
      durationFormatted = meta.durationFormatted;
      timelineFrames = meta.timelineFrames;
    } else if (mediaType === 'image') {
      thumbnailUrl = fileUrl;
      previewDataUrl = await imageFileToPreview(file);
      try {
        visualDescriptors = await createVisualDescriptors(previewDataUrl || fileUrl);
        visualFeatureModel = await createLocalFeatureIndex(previewDataUrl || fileUrl);
      } catch (error) {
        console.warn('Image visual index failed:', error);
      }
      onProgress?.(index + 1, total, `本地识别人脸：${file.name}`);
      try {
        faces = await detectFaces(file);
      } catch (error) {
        faceWarning = `人脸索引暂不可用：${asErrorMessage(error)}`;
      }
    } else if (mediaType === 'document') {
      try {
        const document = await extractDocumentText(file, extension);
        extractedText = document.text;
        documentSummary = document.summary;
        documentWarning = document.warning;
      } catch (error) {
        documentWarning = `文档正文读取失败：${asErrorMessage(error)}`;
      }
    }

    const heuristic = localCreatorHeuristic(file.name, mediaType);
    prepared.push({
      previewDataUrl,
      item: {
        id: `media-${Date.now()}-${index}`,
        originalName: file.name,
        projectPath,
        pathKind,
        size: file.size,
        mediaType,
        extension,
        category: heuristic.category,
        tags: heuristic.tags,
        dimensions: heuristic.dimensions,
        proofreadText: heuristic.proofreadText,
        extractedText,
        keyQuotes: [],
        duration,
        durationFormatted,
        resolution: documentSummary || resolution,
        thumbnailUrl,
        fileUrl,
        fileObject: file,
        timelineFrames,
        faces,
        hash,
        status: 'pending',
        analysisSource: 'local',
        analysisWarning: [documentWarning, faceWarning].filter(Boolean).join('；') || undefined,
        visualDescriptors,
        visualFeatureModel,
        createdAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      },
    });
  }

  const seenHashes = new Map<string, string>();
  prepared.forEach(({ item }) => {
    if (!item.hash) return;
    const originalId = seenHashes.get(item.hash);
    if (originalId) {
      item.isDuplicate = true;
      item.duplicateOfId = originalId;
      item.tags = ['#重复素材', '#待清理'];
    } else {
      seenHashes.set(item.hash, item.id);
    }
  });

  if (!settings.enableCloudAI) {
    return prepared.map(({ item }) => ({ ...item, status: 'done', analysisSource: 'local' }));
  }

  const analyzed: MediaItem[] = [];
  for (let index = 0; index < prepared.length; index += 1) {
    const { item, previewDataUrl } = prepared[index];
    if (item.isDuplicate) {
      analyzed.push({ ...item, status: 'done' });
      continue;
    }

    let working = { ...item, status: 'analyzing' as const };
    const warnings: string[] = item.analysisWarning ? [item.analysisWarning] : [];
    if (settings.enableTranscription && ['audio', 'video'].includes(item.mediaType)) {
      onProgress?.(index + 1, total, item.size > settings.maxUploadMb * 1024 * 1024
        ? `本地分段并识别：${item.originalName}`
        : `语音识别：${item.originalName}`);
      try {
        const transcript = await transcribeWithChunking(item.fileObject as File, settings);
        working = {
          ...working,
          extractedText: transcript.text,
          transcriptSegments: transcript.segments,
          analysisSource: 'asr',
        };
      } catch (error) {
        warnings.push(`语音识别暂不可用：${asErrorMessage(error)}`);
      }
    }

    onProgress?.(index + 1, total, `AI整理中：${item.originalName}`);
    try {
      const { result, warning } = await analyzeOne(working, previewDataUrl, settings);
      if (warning) warnings.push(warning);
      if (result) {
        working = {
          ...working,
          category: result.category,
          tags: result.tags,
          dimensions: result.dimensions,
          proofreadText: result.proofreadText,
          keyQuotes: result.keyQuotes || [],
          visualDescription: result.visualDescription,
          ocrText: result.ocrText,
          timelineFrames: working.timelineFrames?.map((frame) => {
            const description = result.timelineDescriptions?.reduce<{ distance: number; text?: string }>(
              (best, entry) => {
                const distance = Math.abs(entry.time - frame.time);
                return distance < best.distance ? { distance, text: entry.description } : best;
              },
              { distance: Number.POSITIVE_INFINITY },
            );
            return description?.text && description.distance <= 2
              ? { ...frame, description: description.text }
              : frame;
          }),
          analysisSource: result.analysisSource || working.analysisSource,
        };
      }
    } catch (error) {
      warnings.push(`LLM：${asErrorMessage(error)}`);
      working.analysisSource = working.mediaType === 'document' ? 'local' : working.extractedText ? 'asr' : 'fallback';
    }

    analyzed.push({
      ...working,
      status: warnings.length && !working.extractedText && working.analysisSource === 'fallback' ? 'error' : 'done',
      analysisWarning: warnings.join('；') || undefined,
    });
  }

  if (settings.enableSemanticSearch) {
    onProgress?.(total, total, '正在建立语义搜索索引…');
    try {
      return await attachEmbeddings(analyzed, settings);
    } catch (error) {
      console.info('Embedding unavailable, fuzzy search remains active:', asErrorMessage(error));
      return analyzed;
    }
  }

  return analyzed;
}

export async function createQueryEmbedding(query: string, settings: AISettings): Promise<number[] | null> {
  if (!settings.enableCloudAI || !settings.enableSemanticSearch || !settings.embeddingModel.trim()) return null;
  const response = await fetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.embeddingModel,
      input: [query],
    }),
  });
  const payload = await readApiResponse<never>(response);
  return payload.embeddings?.[0] || null;
}

export async function createVisualSearchQuery(
  file: File,
): Promise<{ query: VisualContainmentQuery; previewUrl: string }> {
  if (!file.type.startsWith('image/')) throw new Error('请选择 JPG、PNG、WEBP 等图片文件。');
  const previewUrl = await imageFileToPreview(file);
  if (!previewUrl) throw new Error('图片读取失败，请换一张图片重试。');
  const query = await createVisualContainmentQuery(previewUrl);
  if (!query) throw new Error('无法建立图片视觉特征，请换一张图片重试。');
  return { query, previewUrl };
}

export function cosineSimilarity(left?: number[], right?: number[]): number {
  if (!left?.length || !right?.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
