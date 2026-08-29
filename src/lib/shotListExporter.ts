import { saveAs } from 'file-saver';
import { MediaItem } from '@/types/file';

/**
 * 导出剪辑师专用《多模态素材场记单 (Shot List)》为 Markdown 或 CSV
 */
export function exportShotList(
  items: MediaItem[],
  format: 'markdown' | 'csv' = 'markdown',
  excludeDuplicates: boolean = true
) {
  const targetItems = excludeDuplicates ? items.filter((i) => !i.isDuplicate) : items;
  const dateStr = new Date().toISOString().slice(0, 10);

  if (format === 'markdown') {
    let md = `# 🎬 TagMind AI 创作者素材场记单 (Shot List)\n\n`;
    md += `> 生成时间: ${new Date().toLocaleString()}  \n`;
    md += `> 素材总计: **${targetItems.length}** 份 (已自动剔除冗余重复素材)\n\n`;

    md += `## 📋 剪辑素材索引与台词明细\n\n`;
    md += `| 原始素材文件名 | 分类与标签 | 时长/规格 | 情绪/机位 | AI 校对精修台词 / 画面场记 |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;

    targetItems.forEach((item) => {
      const tagsStr = item.tags.map((t) => `\`${t}\``).join(' ');
      const specs = item.durationFormatted ? `⏱️ ${item.durationFormatted}` : item.resolution ? `📐 ${item.resolution}` : '-';
      const dimensionsStr = [item.dimensions.shotType, item.dimensions.mood, item.dimensions.hookType].filter(Boolean).join(' | ') || '-';
      const cleanSummary = item.proofreadText.replace(/\n/g, ' ').slice(0, 120);

      md += `| \`${item.originalName}\` | **${item.category}**<br>${tagsStr} | ${specs} | ${dimensionsStr} | ${cleanSummary} |\n`;
    });

    md += `\n\n---\n*由 TagMind AI (VibeHack #05「准点下班」创作者版) 自动化生成*`;

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    saveAs(blob, `剪辑场记单_TagMind_${dateStr}.md`);
  } else {
    // CSV 格式
    let csv = `\uFEFF原始文件名,素材分类,时长/规格,景别与机位,情绪氛围,声音类型,爆点Hook,AI总结标签,校对台词与场记\n`;
    targetItems.forEach((item) => {
      const specs = item.durationFormatted || item.resolution || '';
      const tagsStr = item.tags.join(' ');
      const cleanText = `"${(item.proofreadText || '').replace(/"/g, '""')}"`;
      csv += `"${item.originalName}","${item.category}","${specs}","${item.dimensions.shotType || ''}","${item.dimensions.mood || ''}","${item.dimensions.soundType || ''}","${item.dimensions.hookType || ''}","${tagsStr}",${cleanText}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, `剪辑素材索引表_TagMind_${dateStr}.csv`);
  }
}
