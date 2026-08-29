import { NextRequest, NextResponse } from 'next/server';
import { localCreatorHeuristic } from '@/lib/creatorParsers';
import {
  extractMessageContent,
  GatewayError,
  gatewayHeaders,
  normalizeBaseUrl,
  parseJsonContent,
  readUpstreamError,
} from '@/lib/aiGateway';
import { AnalysisSource, BatchAnalysisResult, MediaType, TimelineDescription } from '@/types/file';

interface TimelinePreviewInput {
  time: number;
  timeFormatted: string;
  imageDataUrl?: string;
}

interface AnalyzeFileInput {
  id: string;
  name: string;
  mediaType: MediaType;
  durationFormatted?: string;
  resolution?: string;
  rawText?: string;
  transcriptWithTimecodes?: string;
  previewDataUrl?: string;
  timelinePreviews?: TimelinePreviewInput[];
}

interface AnalyzeRequest {
  filesMeta?: AnalyzeFileInput[];
  customApiKey?: string;
  customBaseUrl?: string;
  model?: string;
  visionModel?: string;
  enableCloudAI?: boolean;
  enableVision?: boolean;
  enableTextOrganization?: boolean;
}

interface ParsedAnalysis {
  files?: BatchAnalysisResult[];
  results?: BatchAnalysisResult[];
}

const SYSTEM_PROMPT = `你是创作者素材库的严谨内容分析员。你会收到文件元数据、ASR 原始转写，以及图片或视频的多张按时间采样画面。

你的任务是基于证据整理素材，不得编造画面、台词、人物身份、数值或品牌。
1. category 只能是：A-Roll口播、B-Roll空镜、BGM配乐、转场音效、自媒体封面、表情包梗图、教程录屏、文档资料、其他文件。
2. proofreadText：有 ASR 或文档正文时修正明显错字、标点和断句，提炼主题但保留原意；无文字时生成客观画面场记。证据不足时明确写“未识别到”。
3. visualDescription：客观描述画面主体、动作、环境、构图、色彩和适用剪辑场景。没有视觉输入时留空。
4. ocrText：只记录画面中确实可读的文字，没有则留空。
5. tags：2~6 个短标签，以 # 开头，覆盖主体、场景、动作、情绪、主题。
6. keyQuotes：只从 ASR 中提取，必须附带原始时间戳；没有 ASR 时返回空数组。
7. dimensions 包含 shotType、mood、soundType、hookType，没有证据的字段用空字符串。
8. timelineDescriptions：只针对实际提供的时间采样画面逐张描述。time 必须原样返回对应秒数；description 要写该时刻真正看见的主体、动作与环境，例如“女生站在厨房台前切番茄”，禁止写“关键帧”“开场”“画面采样”等占位词。音频或没有采样画面时返回空数组。
9. 只返回合法 JSON，不要 Markdown。

返回结构：
{"files":[{"id":"文件id","category":"其他文件","tags":["#标签"],"dimensions":{"shotType":"","mood":"","soundType":"","hookType":""},"proofreadText":"","visualDescription":"","ocrText":"","keyQuotes":[{"time":"00:12","text":"原文金句"}],"timelineDescriptions":[{"time":12.5,"description":"该时刻的具体画面内容"}]}]}`;

function fallback(files: AnalyzeFileInput[], warning?: string) {
  const results: BatchAnalysisResult[] = files.map((item) => {
    const local = localCreatorHeuristic(item.name, item.mediaType);
    return {
      id: item.id,
      category: local.category,
      tags: local.tags,
      dimensions: local.dimensions,
      proofreadText: item.rawText?.trim() || local.proofreadText,
      keyQuotes: [],
      analysisSource: warning ? 'fallback' : 'local',
    };
  });
  return NextResponse.json({ success: true, source: warning ? 'fallback' : 'local', results, warning });
}

function safeResults(value: unknown, files: AnalyzeFileInput[], source: AnalysisSource): BatchAnalysisResult[] {
  const parsed = value as ParsedAnalysis | BatchAnalysisResult[];
  const candidates = Array.isArray(parsed) ? parsed : parsed.files || parsed.results || [];
  const inputIds = new Set(files.map((file) => file.id));

  return candidates
    .filter((item) => item && typeof item.id === 'string' && inputIds.has(item.id))
    .map((item) => ({
      id: item.id,
      category: item.category || '其他文件',
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 8).map((tag) => tag.startsWith('#') ? tag : `#${tag}`) : [],
      dimensions: item.dimensions || {},
      proofreadText: item.proofreadText || '未生成整理内容。',
      keyQuotes: Array.isArray(item.keyQuotes) ? item.keyQuotes.slice(0, 6) : [],
      visualDescription: item.visualDescription || '',
      ocrText: item.ocrText || '',
      timelineDescriptions: Array.isArray(item.timelineDescriptions)
        ? item.timelineDescriptions
            .filter((entry): entry is TimelineDescription => Boolean(entry && Number.isFinite(Number(entry.time)) && String(entry.description || '').trim()))
            .slice(0, 16)
            .map((entry) => ({ time: Number(entry.time), description: String(entry.description).trim() }))
        : [],
      analysisSource: source,
    }));
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AnalyzeRequest;
    const files = body.filesMeta?.slice(0, 12) || [];
    if (!files.length) {
      return NextResponse.json({ success: false, error: 'filesMeta array is required' }, { status: 400 });
    }

    if (!body.enableCloudAI) return fallback(files);

    const baseUrl = normalizeBaseUrl(body.customBaseUrl);
    const hasVisualInput = Boolean(body.enableVision && files.some((file) => file.previewDataUrl));
    const model = (hasVisualInput ? body.visionModel : body.model)?.trim() || body.model?.trim();
    if (!model) return NextResponse.json({ success: false, error: '请填写可用的模型名称。' }, { status: 400 });

    const evidence = files.map((file) => ({
      id: file.id,
      name: file.name,
      mediaType: file.mediaType,
      duration: file.durationFormatted || '',
      resolution: file.resolution || '',
      rawTranscript: file.rawText?.slice(0, 12_000) || '',
      timestampedTranscript: file.transcriptWithTimecodes?.slice(0, 14_000) || '',
      hasPreview: Boolean(file.previewDataUrl),
      timelineSamples: file.timelinePreviews?.map((frame) => ({ time: frame.time, timeFormatted: frame.timeFormatted })) || [],
    }));

    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: `${body.enableTextOrganization === false ? '仅做分类和标签，不要改写原始转写。' : '请校对并结构化整理原始转写。'}\n素材证据：${JSON.stringify(evidence)}`,
      },
    ];

    if (body.enableVision) {
      files.forEach((file) => {
        const timelinePreviews = (file.timelinePreviews || []).filter((frame) => frame.imageDataUrl?.startsWith('data:image/'));
        if (timelinePreviews.length) {
          timelinePreviews.forEach((frame) => {
            content.push({ type: 'text', text: `文件 id=${file.id} 在 time=${frame.time} 秒（${frame.timeFormatted}）的实际采样画面：` });
            content.push({ type: 'image_url', image_url: { url: frame.imageDataUrl, detail: 'low' } });
          });
          return;
        }
        if (file.previewDataUrl?.startsWith('data:image/')) {
          content.push({ type: 'text', text: `下面图片对应文件 id=${file.id}，name=${file.name}` });
          content.push({ type: 'image_url', image_url: { url: file.previewDataUrl, detail: 'low' } });
        }
      });
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders(body.customApiKey),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) throw new GatewayError(await readUpstreamError(response), response.status);

    const upstream: unknown = await response.json();
    const parsed = parseJsonContent(extractMessageContent(upstream));
    const hasTranscript = files.some((file) => ['audio', 'video'].includes(file.mediaType) && file.rawText);
    const source: AnalysisSource = hasVisualInput
      ? hasTranscript ? 'asr_llm' : 'vision_llm'
      : hasTranscript ? 'asr_llm' : 'llm';
    const results = safeResults(parsed, files, source);

    if (!results.length) throw new GatewayError('模型返回的数据没有匹配到任何素材。');
    return NextResponse.json({ success: true, source, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 分析失败。';
    const status = error instanceof GatewayError ? error.status : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
