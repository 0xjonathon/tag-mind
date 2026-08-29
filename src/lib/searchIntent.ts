export interface SearchIntent {
  searchQuery: string;
  keywords: string[];
  source: 'llm' | 'local';
}

const REQUEST_PREFIXES = [
  /^(?:请|麻烦)?(?:帮我|给我)?(?:找|搜|搜索|查|查找|寻找|定位|筛选)(?:一下|一找|出来|到)?/,
  /^(?:我想|我要|我需要|想要)(?:找|搜|搜索|查|查找|寻找|看|找到)?/,
  /^(?:能不能|可以|可不可以)(?:帮我|给我)?(?:找|搜|搜索|查|查找|寻找)?/,
  /^(?:有没有|我记得|印象中|好像有)(?:一个|一张|一段|一份|那个|那张|那段)?/,
];

const NOISE_PHRASES = [
  '相关的文件', '相关文件', '这样的文件', '这种文件', '那个文件', '这个文件',
  '相关的内容', '相关内容', '这样的内容', '这种内容', '那个内容', '这个内容',
  '给我看一下', '让我看一下', '发给我', '找出来', '搜出来', '查出来',
  '大概是', '应该是', '可能是', '好像是', '好像有', '我记得', '印象中', '有一个',
];

const TRAILING_PARTICLES = /(?:在哪里|在哪儿|在哪|来着|可以吗|行吗|好吗|谢谢|吧|呢|啊|呀)[。！？?!,.，\s]*$/;

const STOP_WORDS = new Set([
  '一个', '一些', '一下', '那个', '这个', '这些', '那些', '一张', '一段', '一份',
  '有个', '有一个', '里面', '其中', '关于', '相关', '大概', '应该', '可能', '好像',
  '提到', '说到', '讲到', '出现', '内容', '文件', '东西', '时候', '然后',
  '我', '你', '他', '她', '它', '的', '了', '在', '是', '有', '和', '与', '或', '看', '说',
  '那', '这', '段', '张', '份',
]);

function segmentKeywords(value: string): string[] {
  try {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    const keywords: string[] = [];
    let cjkBuffer = '';
    const flush = () => {
      if (cjkBuffer) keywords.push(cjkBuffer);
      cjkBuffer = '';
    };

    [...segmenter.segment(value)].forEach((part) => {
      const word = part.segment.trim().toLocaleLowerCase();
      if (!part.isWordLike || STOP_WORDS.has(word)) {
        flush();
        return;
      }
      if (/^[\u3400-\u9fff]$/.test(word)) {
        cjkBuffer += word;
        return;
      }
      flush();
      if (word.length >= 2) keywords.push(word);
    });
    flush();
    return keywords;
  } catch {
    return value.split(/\s+/).map((part) => part.trim()).filter((part) => part.length >= 2);
  }
}

export function normalizeIntentKeywords(values: unknown, fallback: string): string[] {
  const raw = Array.isArray(values) ? values : [];
  const keywords = raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().replace(/^[-#\s]+|[-#\s]+$/g, ''))
    .filter((value) => value.length >= 2 && value.length <= 40);

  const unique = [...new Set(keywords)].slice(0, 10);
  if (unique.length) return unique;
  return localSearchIntent(fallback).keywords;
}

export function shouldInterpretSearch(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return text.length >= 16
    || /[，。！？?,!]/.test(text)
    || /帮我|给我|我想|我要|我需要|能不能|可以.*找|有没有|我记得|印象中|好像|查找|搜索|寻找|定位/.test(text);
}

export function localSearchIntent(value: string): SearchIntent {
  const original = value.trim();
  let cleaned = original;
  REQUEST_PREFIXES.forEach((pattern) => { cleaned = cleaned.replace(pattern, ''); });
  NOISE_PHRASES.forEach((phrase) => { cleaned = cleaned.replaceAll(phrase, ' '); });
  cleaned = cleaned
    .replace(TRAILING_PARTICLES, '')
    .replace(/[“”"'‘’]/g, '')
    .replace(/[，。；！？?,;!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const searchQuery = cleaned || original;
  const keywords = [...new Set(segmentKeywords(searchQuery))].slice(0, 10);

  return {
    searchQuery: keywords.length > 1 ? keywords.join(' ') : searchQuery,
    keywords: keywords.length ? keywords : [searchQuery],
    source: 'local',
  };
}
