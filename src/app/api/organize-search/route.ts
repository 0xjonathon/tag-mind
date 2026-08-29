import { NextRequest, NextResponse } from 'next/server';
import {
  extractMessageContent,
  gatewayHeaders,
  openAIEndpointCandidates,
  readUpstreamError,
} from '@/lib/aiGateway';

interface OrganizeSearchRequest {
  transcript?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  enableCloudAI?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as OrganizeSearchRequest;
    const transcript = body.transcript?.trim();
    if (!transcript) {
      return NextResponse.json({ success: false, error: '没有识别到可搜索的语音内容。' }, { status: 400 });
    }

    if (!body.enableCloudAI || !body.model?.trim() || !body.baseUrl?.trim()) {
      return NextResponse.json({ success: true, query: transcript, source: 'speech' });
    }

    const endpoints = openAIEndpointCandidates(body.baseUrl, 'chat/completions');
    let lastError = '';
    for (const endpoint of endpoints) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: gatewayHeaders(body.apiKey),
        body: JSON.stringify({
          model: body.model.trim(),
          messages: [
            {
              role: 'system',
              content: '你是素材库搜索词整理助手。将语音转写整理成一句简洁、自然、可直接搜索的中文查询。保留人物、台词、画面、地点、时间与情绪等实体，删除“帮我找一下”等口头语，不得添加原文没有的信息。只输出搜索词本身。',
            },
            { role: 'user', content: transcript.slice(0, 800) },
          ],
          temperature: 0.1,
          max_tokens: 120,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (response.ok) {
        const query = extractMessageContent(await response.json()).trim().replace(/^['"“”]|['"“”]$/g, '');
        return NextResponse.json({ success: true, query: query || transcript, source: 'llm' });
      }
      lastError = await readUpstreamError(response);
      if (response.status !== 404) break;
    }

    return NextResponse.json({ success: true, query: transcript, source: 'speech', warning: lastError || 'LLM 整理暂不可用，已使用语音原文搜索。' });
  } catch {
    return NextResponse.json({ success: false, error: '语音搜索整理失败。' }, { status: 500 });
  }
}
