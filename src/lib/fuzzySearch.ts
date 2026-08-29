import type { MediaItem, MediaType } from '@/types/file';

const LATIN_TOKEN = /[a-z0-9][a-z0-9._-]*/gi;

const MEDIA_TYPE_TERMS: Record<MediaType, string[]> = {
  video: ['视频', '影片', '录像', '短片', 'video', 'movie'],
  audio: ['音频', '声音', '录音', '音乐', 'audio', 'sound'],
  image: ['图片', '图像', '照片', '截图', 'image', 'photo', 'picture'],
  document: ['文档', '资料', '正文', 'document'],
  other: ['其他文件', '文件', 'other'],
};

const EXTENSION_TERMS: Record<string, string[]> = {
  doc: ['word', '文档'],
  docx: ['word', '文档'],
  xls: ['excel', '表格', '电子表格'],
  xlsx: ['excel', '表格', '电子表格'],
  csv: ['csv', 'excel', '表格'],
  ppt: ['ppt', 'powerpoint', '演示文稿', '幻灯片'],
  pptx: ['ppt', 'powerpoint', '演示文稿', '幻灯片'],
  pdf: ['pdf', '文档'],
  txt: ['txt', 'text', '文本', '纯文本'],
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[#_\-/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mediaSearchText(file: MediaItem): string {
  const extension = file.extension.trim().toLocaleLowerCase().replace(/^\./, '');
  return [
    file.originalName,
    file.projectPath,
    MEDIA_TYPE_TERMS[file.mediaType].join(' '),
    extension,
    EXTENSION_TERMS[extension]?.join(' '),
    file.category,
    file.extractedText,
    file.proofreadText,
    file.visualDescription,
    file.ocrText,
    file.tags.join(' '),
    Object.values(file.dimensions).join(' '),
    file.keyQuotes.map((quote) => quote.text).join(' '),
    file.transcriptSegments?.map((segment) => segment.text).join(' '),
    file.timelineFrames?.map((frame) => `${frame.timeFormatted} ${frame.description || ''}`).join(' '),
    file.faces?.map((face) => face.personLabel).filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

function levenshteinWithin(left: string, right: string, limit: number): boolean {
  if (Math.abs(left.length - right.length) > limit) return false;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let best = current[0];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      best = Math.min(best, current[column]);
    }
    if (best > limit) return false;
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] <= limit;
}

function fuzzyTokenMatch(queryToken: string, candidate: string): boolean {
  if (queryToken === candidate) return true;
  // NBA、AI、4K 等短词承担明确实体含义，不能用子串或错字容错扩大命中。
  if (queryToken.length <= 3 || candidate.length <= 3) return false;
  if (candidate.includes(queryToken) || queryToken.includes(candidate)) return true;
  const limit = queryToken.length >= 7 ? 2 : 1;
  return levenshteinWithin(queryToken, candidate, limit);
}

function queryMatchStats(text: string, query: string) {
  const normalizedText = normalizeSearchText(text);
  const normalizedQuery = normalizeSearchText(query);
  const queryUnits = [...new Set(normalizedQuery.split(/\s+/).filter(Boolean))];
  if (!normalizedQuery || !queryUnits.length) {
    return { normalizedText, normalizedQuery, queryUnits, matchedUnits: 0, score: 1 };
  }
  const shortLatinQuery = /^[a-z0-9]{1,3}$/i.test(normalizedQuery);
  const exactTextTokens: string[] = normalizedText.match(LATIN_TOKEN) || [];
  const hasExactMatch = shortLatinQuery
    ? exactTextTokens.includes(normalizedQuery)
    : normalizedText.includes(normalizedQuery);
  if (hasExactMatch) {
    return { normalizedText, normalizedQuery, queryUnits, matchedUnits: queryUnits.length, score: 1 };
  }

  const textTokens = normalizedText.match(LATIN_TOKEN) || [];
  const compactText = normalizedText.replace(/\s/g, '');
  const matched = queryUnits.filter((unit) => {
    const latin = unit.match(LATIN_TOKEN) || [];
    const nonLatin = unit.replace(LATIN_TOKEN, '');
    const latinMatches = latin.every((token) => textTokens.some((candidate) => fuzzyTokenMatch(token, candidate)));
    const nonLatinMatches = !nonLatin || compactText.includes(nonLatin);
    return latinMatches && nonLatinMatches;
  });
  const matchedCharacters = matched.reduce((total, unit) => total + unit.length, 0);
  const queryCharacters = queryUnits.reduce((total, unit) => total + unit.length, 0) || 1;
  const coverage = matched.length / queryUnits.length;
  const characterCoverage = matchedCharacters / queryCharacters;
  const score = coverage * 0.78 + characterCoverage * 0.22;
  return { normalizedText, normalizedQuery, queryUnits, matchedUnits: matched.length, score };
}

export function fuzzyMatchScore(text: string, query: string): number {
  return queryMatchStats(text, query).score;
}

export function fuzzyMatch(text: string, query: string): boolean {
  const { normalizedQuery, queryUnits, matchedUnits, score } = queryMatchStats(text, query);
  if (!normalizedQuery) return true;
  if (score === 1) return true;

  // 短查询保持严格；长句保证至少两个有效词命中，避免口语噪声拖垮召回。
  const requiredMatches = queryUnits.length <= 2
    ? queryUnits.length
    : Math.max(2, Math.ceil(queryUnits.length * 0.4));
  return matchedUnits >= requiredMatches;
}

export function matchedTerms(text: string, query: string): string[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const terms = new Set<string>();
  const lowerText = text.toLocaleLowerCase();
  const exactIndex = lowerText.indexOf(normalizedQuery);
  if (exactIndex >= 0) terms.add(text.slice(exactIndex, exactIndex + normalizedQuery.length));

  const queryTokens = normalizedQuery.match(LATIN_TOKEN) || [];
  const rawTokens = text.match(LATIN_TOKEN) || [];
  queryTokens.forEach((token) => {
    rawTokens.forEach((candidate) => {
      if (fuzzyTokenMatch(token, normalizeSearchText(candidate))) terms.add(candidate);
    });
  });

  normalizedQuery.split(/\s+/).forEach((unit) => {
    const nonLatin = unit.replace(LATIN_TOKEN, '').trim();
    if (!nonLatin) return;
    const index = lowerText.indexOf(nonLatin);
    if (index >= 0) terms.add(text.slice(index, index + nonLatin.length));
  });
  return [...terms].sort((left, right) => right.length - left.length);
}
