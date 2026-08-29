import { NextRequest, NextResponse } from 'next/server';
import { GatewayError, normalizeBaseUrl, openAIEndpointCandidates, readUpstreamError } from '@/lib/aiGateway';
import { TranscriptSegment, TranscriptionResult } from '@/types/file';

interface UpstreamSegment {
  start?: number;
  end?: number;
  text?: string;
  avg_logprob?: number;
}

interface UpstreamTranscription {
  text?: string;
  language?: string;
  duration?: number;
  segments?: UpstreamSegment[];
}

interface StepFunSseEvent {
  type?: string;
  delta?: string;
  text?: string;
  message?: string;
  start_time?: number;
  end_time?: number;
}

const STEPFUN_SSE_MODELS = /^(?:stepaudio-|step-asr-1\.1)/i;
const STEPFUN_AUDIO_FORMATS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'pcm']);

function isStepFunService(baseUrl: string, model: string): boolean {
  return new URL(baseUrl).hostname.endsWith('stepfun.com') || STEPFUN_SSE_MODELS.test(model);
}

function audioFormat(file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (STEPFUN_AUDIO_FORMATS.has(extension)) return extension;
  const mimeSubtype = file.type.split('/')[1]?.split(';')[0]?.toLowerCase() || '';
  if (STEPFUN_AUDIO_FORMATS.has(mimeSubtype)) return mimeSubtype;
  throw new GatewayError('阶跃 ASR 支持 MP3、WAV、M4A、OGG、PCM。视频会先在浏览器本地转为 WAV 后再识别。', 400);
}

function parseStepFunSse(raw: string): TranscriptionResult {
  const events = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]')
    .map((line) => {
      try { return JSON.parse(line) as StepFunSseEvent; } catch { return null; }
    })
    .filter((event): event is StepFunSseEvent => Boolean(event));

  const failure = events.find((event) => event.type === 'error');
  if (failure) throw new GatewayError(failure.message || '阶跃 ASR 返回了未知错误。');

  const deltas = events.filter((event) => event.type === 'transcript.text.delta' && event.delta);
  const finalText = events.findLast((event) => event.type === 'transcript.text.done')?.text?.trim();
  const text = finalText || deltas.map((event) => event.delta).join('').trim();
  if (!text) throw new GatewayError('阶跃 ASR 已响应，但没有返回可用的转写文字。');

  const segments: TranscriptSegment[] = deltas
    .filter((event) => Number.isFinite(event.start_time) && Number.isFinite(event.end_time))
    .map((event) => ({
      start: Number(event.start_time) / 1000,
      end: Number(event.end_time) / 1000,
      text: event.delta?.trim() || '',
    }))
    .filter((segment) => segment.text);

  return {
    text,
    segments,
    duration: segments.length ? Math.max(...segments.map((segment) => segment.end)) : undefined,
  };
}

async function transcribeWithStepFun(
  file: File,
  baseUrl: string,
  apiKey: string,
  model: string,
  language: string,
): Promise<TranscriptionResult> {
  const format = audioFormat(file);
  const requestedModel = model === 'step-asr-1.1' ? 'step-asr-1.1-stream' : model;
  const endpoints = openAIEndpointCandidates(baseUrl, 'audio/asr/sse');
  const audioData = Buffer.from(await file.arrayBuffer()).toString('base64');
  let lastError = '';

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        audio: {
          data: audioData,
          input: {
            transcription: {
              model: requestedModel,
              ...(language && language !== 'auto' ? { language } : {}),
              enable_itn: true,
              enable_timestamp: true,
            },
            format: {
              type: format,
              ...(format === 'pcm' ? { codec: 'pcm_s16le', rate: 16000, bits: 16, channel: 1 } : {}),
            },
          },
        },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (response.ok) return parseStepFunSse(await response.text());
    lastError = await readUpstreamError(response);
    if (response.status !== 404) throw new GatewayError(`阶跃 ASR 调用失败：${lastError}`, response.status);
  }

  throw new GatewayError(
    `阶跃 ASR 路径不可用。已尝试 /audio/asr/sse；请检查 Base URL 是否为 https://api.stepfun.com/v1（Step Plan 为 /step_plan/v1）。上游信息：${lastError || '404'}`,
    502,
  );
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const baseUrl = normalizeBaseUrl(form.get('baseUrl'));
    const apiKey = String(form.get('apiKey') || '').trim();
    const model = String(form.get('model') || '').trim();
    const language = String(form.get('language') || '').trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: '缺少需要转写的媒体文件。' }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ success: false, error: '请填写语音识别模型名称。' }, { status: 400 });
    }

    if (isStepFunService(baseUrl, model) && model !== 'step-asr') {
      const result = await transcribeWithStepFun(file, baseUrl, apiKey, model, language);
      return NextResponse.json({ success: true, result });
    }

    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const endpoints = openAIEndpointCandidates(baseUrl, 'audio/transcriptions');
    let response: Response | undefined;
    let lastError = '';
    for (const endpoint of endpoints) {
      const upstreamForm = new FormData();
      upstreamForm.append('file', file, file.name);
      upstreamForm.append('model', model);
      upstreamForm.append('response_format', model === 'step-asr' ? 'json' : 'verbose_json');
      if (model !== 'step-asr') upstreamForm.append('timestamp_granularities[]', 'segment');
      if (language && language !== 'auto') upstreamForm.append('language', language);

      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: upstreamForm,
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) break;
      lastError = await readUpstreamError(response);
      if (response.status !== 404) throw new GatewayError(lastError, response.status);
    }

    if (!response?.ok) {
      throw new GatewayError(
        `当前 Base URL 没有 OpenAI 兼容的语音转写接口。更换模型名无法解决接口路径 404；请确认服务支持 /audio/transcriptions，或填写服务商的 API 根地址。当前模型：${model}。${lastError && !/404|page not found/i.test(lastError) ? ` 上游信息：${lastError}` : ''}`,
        502,
      );
    }

    const upstream = (await response.json()) as UpstreamTranscription;
    const segments: TranscriptSegment[] = (upstream.segments || [])
      .filter((segment) => typeof segment.text === 'string')
      .map((segment) => ({
        start: Number(segment.start || 0),
        end: Number(segment.end || segment.start || 0),
        text: segment.text?.trim() || '',
        confidence:
          typeof segment.avg_logprob === 'number'
            ? Math.max(0, Math.min(1, Math.exp(segment.avg_logprob)))
            : undefined,
      }));

    const result: TranscriptionResult = {
      text: upstream.text?.trim() || segments.map((segment) => segment.text).join(' '),
      segments,
      language: upstream.language,
      duration: upstream.duration,
    };

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 500;
    const message = error instanceof Error ? error.message : '语音识别失败。';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
