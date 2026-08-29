import { NextRequest, NextResponse } from 'next/server';
import {
  extractMessageContent,
  gatewayHeaders,
  openAIEndpointCandidates,
  readUpstreamError,
} from '@/lib/aiGateway';
import { localSearchIntent, normalizeIntentKeywords } from '@/lib/searchIntent';

interface OrganizeSearchRequest {
  transcript?: string;
  text?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  enableCloudAI?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as OrganizeSearchRequest;
    const text = (body.text || body.transcript)?.trim();
    if (!text) {
      return NextResponse.json({ success: false, error: '没有可搜索的内容。' }, { status: 400 });
    }

    const localIntent = localSearchIntent(text);
    // 搜索结果先由前端的本地意图即时返回；只要模型可用，这里始终用 LLM 复核并优化。
    if (!body.enableCloudAI || !body.model?.trim() || !body.baseUrl?.trim()) {
      return NextResponse.json({ success: true, query: localIntent.searchQuery, keywords: localIntent.keywords, source: 'local' });
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
              content: `你是数字资产检索意图解析器。理解用户真正想找的内容，而不是机械复述整句话。
提取可在文件名、台词、画面描述、人物标签、OCR、文档正文和时间轴中命中的关键词。
即使用户只输入若干零散词，也要判断其核心检索意图。保留明确的文件类型、人物、对象、动作、场景、地点、台词、标题、错误代码、文档主题、时间和情绪。
删除“帮我找一下”“我记得好像”“之类”“字样”等请求、犹豫或弱信息词。有意义的复合词和固定标题必须保持完整，例如“安全限制”，不要机械拆成“安全”“限制”。
不得添加用户没有表达的信息；拼写纠正只能用于明显错别字或近似英文，并保留原词可检索含义。
仅输出严格 JSON：{"searchQuery":"空格分隔的精炼检索词","keywords":["关键词1","关键词2"]}。keywords 保留 2 至 8 个，极短查询允许 1 个。`,
            },
            { role: 'user', content: text.slice(0, 1200) },
          ],
          temperature: 0.1,
          max_tokens: 220,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (response.ok) {
        const content = extractMessageContent(await response.json()).trim();
        try {
          const jsonText = content.replace(/^```(?:json)?\s*|\s*```$/g, '');
          const parsed = JSON.parse(jsonText) as { searchQuery?: unknown; keywords?: unknown };
          const query = typeof parsed.searchQuery === 'string' ? parsed.searchQuery.trim() : '';
          const keywords = normalizeIntentKeywords(parsed.keywords, query || text);
          const searchQuery = query || keywords.join(' ') || localIntent.searchQuery;
          return NextResponse.json({ success: true, query: searchQuery, keywords, source: 'llm' });
        } catch {
          const query = content.replace(/^['"“”]|['"“”]$/g, '') || localIntent.searchQuery;
          return NextResponse.json({ success: true, query, keywords: normalizeIntentKeywords([], query), source: 'llm' });
        }
      }
      lastError = await readUpstreamError(response);
      if (response.status !== 404) break;
    }

    return NextResponse.json({
      success: true,
      query: localIntent.searchQuery,
      keywords: localIntent.keywords,
      source: 'local',
      warning: lastError || 'LLM 意图理解暂不可用，已自动提炼本地关键词。',
    });
  } catch {
    return NextResponse.json({ success: false, error: '搜索意图理解失败。' }, { status: 500 });
  }
}
