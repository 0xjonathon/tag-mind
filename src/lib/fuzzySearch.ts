import { MediaItem } from '@/types/file';

const LATIN_TOKEN = /[a-z0-9][a-z0-9._-]*/gi;

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[#_\-/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mediaSearchText(file: MediaItem): string {
  return [
    file.originalName,
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
  if (candidate.includes(queryToken) || queryToken.includes(candidate)) return true;
  if (queryToken.length < 3 || candidate.length < 3) return false;
  const limit = queryToken.length >= 7 ? 2 : 1;
  return levenshteinWithin(queryToken, candidate, limit);
}

export function fuzzyMatch(text: string, query: string): boolean {
  const normalizedText = normalizeSearchText(text);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  if (normalizedText.includes(normalizedQuery)) return true;

  const textTokens = normalizedText.match(LATIN_TOKEN) || [];
  const compactText = normalizedText.replace(/\s/g, '');
  const queryUnits = normalizedQuery.split(/\s+/).filter(Boolean);
  const matchedUnits = queryUnits.filter((unit) => {
    const latin = unit.match(LATIN_TOKEN) || [];
    const nonLatin = unit.replace(LATIN_TOKEN, '');
    const latinMatches = latin.every((token) => textTokens.some((candidate) => fuzzyTokenMatch(token, candidate)));
    const nonLatinMatches = !nonLatin || compactText.includes(nonLatin);
    return latinMatches && nonLatinMatches;
  }).length;

  // 多关键词（尤其是视觉模型提取的标签）允许部分命中；短查询仍保持严格匹配。
  const requiredMatches = queryUnits.length <= 2 ? queryUnits.length : Math.ceil(queryUnits.length * 0.45);
  return matchedUnits >= requiredMatches;
}

export function matchedTerms(text: string, query: string): string[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const terms = new Set<string>();
  const exactIndex = text.toLocaleLowerCase().indexOf(normalizedQuery);
  if (exactIndex >= 0) terms.add(text.slice(exactIndex, exactIndex + normalizedQuery.length));

  const queryTokens = normalizedQuery.match(LATIN_TOKEN) || [];
  const rawTokens = text.match(LATIN_TOKEN) || [];
  queryTokens.forEach((token) => {
    rawTokens.forEach((candidate) => {
      if (fuzzyTokenMatch(token, normalizeSearchText(candidate))) terms.add(candidate);
    });
  });

  const nonLatin = normalizedQuery.replace(LATIN_TOKEN, '').trim();
  if (nonLatin) terms.add(nonLatin);
  return [...terms].sort((left, right) => right.length - left.length);
}
