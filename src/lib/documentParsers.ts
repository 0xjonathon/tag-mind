import JSZip from 'jszip';

export interface DocumentExtraction {
  text: string;
  summary: string;
  warning?: string;
}

const MAX_TEXT_LENGTH = 120_000;

function cleanText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

async function extractDocx(file: File): Promise<DocumentExtraction> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const text = cleanText(result.value);
  return {
    text,
    summary: `${text.length.toLocaleString('zh-CN')} 字`,
    warning: result.messages.length ? '部分 Word 格式元素已转换为纯文字。' : undefined,
  };
}

async function extractSpreadsheet(file: File): Promise<DocumentExtraction> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sections = workbook.SheetNames.map((sheetName) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false });
    return `【工作表：${sheetName}】\n${csv}`;
  });
  const text = cleanText(sections.join('\n\n'));
  return { text, summary: `${workbook.SheetNames.length} 个工作表` };
}

function xmlText(xml: string): string {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(document.querySelectorAll('a\\:t, t'))
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .join(' ');
}

async function extractPptx(file: File): Promise<DocumentExtraction> {
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const slideNames = Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  const slides = await Promise.all(slideNames.map(async (name, index) => {
    const xml = await archive.file(name)?.async('text');
    return `【第 ${index + 1} 页】\n${xml ? xmlText(xml) : ''}`;
  }));
  return { text: cleanText(slides.join('\n\n')), summary: `${slideNames.length} 页幻灯片` };
}

async function extractPdf(file: File): Promise<DocumentExtraction> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ');
    pages.push(`【第 ${pageNumber} 页】\n${text}`);
  }
  return { text: cleanText(pages.join('\n\n')), summary: `${pdf.numPages} 页` };
}

function extractRtf(source: string): string {
  return source
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'[0-9a-f]{2}/gi, ' ')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '');
}

export async function extractDocumentText(file: File, extension: string): Promise<DocumentExtraction> {
  const ext = extension.toLowerCase();
  if (ext === 'docx') return extractDocx(file);
  if (ext === 'xlsx' || ext === 'xls') return extractSpreadsheet(file);
  if (ext === 'pptx') return extractPptx(file);
  if (ext === 'pdf') return extractPdf(file);
  if (['txt', 'md', 'csv', 'json'].includes(ext)) {
    const text = cleanText(await file.text());
    return { text, summary: `${text.length.toLocaleString('zh-CN')} 字` };
  }
  if (ext === 'rtf') {
    const text = cleanText(extractRtf(await file.text()));
    return { text, summary: `${text.length.toLocaleString('zh-CN')} 字` };
  }
  return {
    text: '',
    summary: '已识别文档',
    warning: `暂无法读取旧版 .${ext} 文档正文，请另存为 ${ext === 'doc' ? 'DOCX' : 'PPTX'} 后重新导入。`,
  };
}
