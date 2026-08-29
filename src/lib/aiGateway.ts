import 'server-only';

export interface GatewayConfig {
  apiKey?: string;
  baseUrl: string;
}

export class GatewayError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

export function normalizeBaseUrl(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new GatewayError('请填写 API Base URL。', 400);
  }

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new GatewayError('API Base URL 格式不正确。', 400);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new GatewayError('API Base URL 仅支持 http 或 https。', 400);
  }

  return url.toString().replace(/\/$/, '');
}

/**
 * 接受「服务根地址」「/v1 根地址」或误填的具体 OpenAI 兼容接口地址，
 * 生成按优先级尝试的端点。部分自建网关要求 /v1，另一些则不需要。
 */
export function openAIEndpointCandidates(baseUrl: string, endpoint: string): string[] {
  const url = new URL(normalizeBaseUrl(baseUrl));
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  const knownSuffixes = [
    '/chat/completions',
    '/audio/transcriptions',
    '/audio/asr/sse',
    '/embeddings',
    '/responses',
  ];
  let pathname = url.pathname.replace(/\/$/, '');
  const suffix = knownSuffixes.find((item) => pathname.endsWith(item));
  if (suffix) pathname = pathname.slice(0, -suffix.length).replace(/\/$/, '');

  const build = (path: string) => {
    const next = new URL(url.origin);
    next.pathname = `${path}/${cleanEndpoint}`.replace(/\/{2,}/g, '/');
    return next.toString().replace(/\/$/, '');
  };

  if (/\/v\d+(?:beta)?$/i.test(pathname)) return [build(pathname)];

  const direct = build(pathname);
  const versioned = build(`${pathname}/v1`);
  const ordered = url.hostname === 'api.openai.com' || pathname === ''
    ? [versioned, direct]
    : [direct, versioned];
  return Array.from(new Set(ordered));
}

export function gatewayHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  return headers;
}

export async function readUpstreamError(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) return `上游接口返回 ${response.status}`;

  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === 'string') return parsed.error;
    return parsed.error?.message || parsed.message || raw.slice(0, 500);
  } catch {
    return raw.slice(0, 500);
  }
}

export function extractMessageContent(payload: unknown): string {
  const data = payload as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item) => item.text || '').join('');
  throw new GatewayError('模型响应中没有可解析的文本内容。');
}

export function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced.trim());

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new GatewayError('模型没有返回合法 JSON。');
  }
}
