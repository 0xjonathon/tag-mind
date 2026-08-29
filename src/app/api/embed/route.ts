import { NextRequest, NextResponse } from 'next/server';
import { GatewayError, gatewayHeaders, normalizeBaseUrl, readUpstreamError } from '@/lib/aiGateway';

interface EmbedRequest {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  input?: string[];
}

interface EmbeddingPayload {
  data?: Array<{ index?: number; embedding?: number[] }>;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as EmbedRequest;
    const baseUrl = normalizeBaseUrl(body.baseUrl);
    const model = body.model?.trim();
    const input = body.input?.filter((item) => typeof item === 'string' && item.trim()).slice(0, 64);

    if (!model) return NextResponse.json({ success: false, error: '请填写 Embedding 模型名称。' }, { status: 400 });
    if (!input?.length) return NextResponse.json({ success: false, error: '缺少需要向量化的文本。' }, { status: 400 });

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: gatewayHeaders(body.apiKey),
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) throw new GatewayError(await readUpstreamError(response), response.status);

    const upstream = (await response.json()) as EmbeddingPayload;
    const embeddings = (upstream.data || [])
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((item) => item.embedding || []);

    if (embeddings.length !== input.length) throw new GatewayError('Embedding 返回数量与输入不一致。');
    return NextResponse.json({ success: true, embeddings });
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 500;
    const message = error instanceof Error ? error.message : '语义索引失败。';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
