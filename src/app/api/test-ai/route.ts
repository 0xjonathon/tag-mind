import { NextRequest, NextResponse } from 'next/server';
import {
  extractMessageContent,
  GatewayError,
  gatewayHeaders,
  normalizeBaseUrl,
  readUpstreamError,
} from '@/lib/aiGateway';

interface TestRequest {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TestRequest;
    const baseUrl = normalizeBaseUrl(body.baseUrl);
    const model = body.model?.trim();
    if (!model) return NextResponse.json({ success: false, error: '请填写文本整理模型名称。' }, { status: 400 });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders(body.apiKey),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '只回复 PONG。' },
          { role: 'user', content: 'PING' },
        ],
        temperature: 0,
        max_tokens: 8,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new GatewayError(await readUpstreamError(response), response.status);
    }

    const data: unknown = await response.json();
    const answer = extractMessageContent(data).trim();
    return NextResponse.json({ success: true, model, answer });
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 500;
    const message = error instanceof Error ? error.message : '连接测试失败。';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
