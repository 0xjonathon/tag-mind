import { MediaType, CreatorCategory, CreatorDimensions, TimelineFrame } from '@/types/file';

/**
 * 识别文件是否为视频、音频或图片
 */
export function getMediaTypeFromExtension(ext: string): MediaType {
  const cleanExt = ext.toLowerCase().replace('.', '');
  if (['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'flv'].includes(cleanExt)) {
    return 'video';
  }
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma'].includes(cleanExt)) {
    return 'audio';
  }
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(cleanExt)) {
    return 'image';
  }
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json', 'rtf', 'pdf'].includes(cleanExt)) {
    return 'document';
  }
  return 'other';
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * 格式化秒数为 MM:SS 或 HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * 本地浏览器端：按时间均匀采样画面与时长 (纯本地 0 Token)
 */
export async function captureVideoMetadata(file: File): Promise<{
  duration: number;
  durationFormatted: string;
  thumbnailUrl: string;
  resolution: string;
  timelineFrames: TimelineFrame[];
}> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    let res = '1920x1080';
    let duration = 0;
    let captureTimes: number[] = [];
    const timelineFrames: TimelineFrame[] = [];
    let captureIndex = 0;
    let settled = false;
    const timeout = window.setTimeout(() => finish(), 20_000);

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const thumbnailUrl = timelineFrames[Math.floor(timelineFrames.length / 2)]?.thumbnailUrl || timelineFrames[0]?.thumbnailUrl || '';
      resolve({ duration, durationFormatted: formatDuration(duration), thumbnailUrl, resolution: res, timelineFrames });
      URL.revokeObjectURL(url);
    };

    video.onloadedmetadata = () => {
      res = `${video.videoWidth || 1920}x${video.videoHeight || 1080}`;
      duration = Number.isFinite(video.duration) ? video.duration : 0;
      // 兼顾时间覆盖与视觉调用成本：约每 8 秒取一帧，单条视频最多 16 帧。
      const frameCount = duration > 0 ? Math.min(16, Math.max(4, Math.ceil(duration / 8) + 1)) : 1;
      captureTimes = Array.from({ length: frameCount }, (_, index) => {
        const lastReadableTime = Math.max(0, duration - 0.05);
        if (frameCount === 1) return Math.min(0.08, lastReadableTime);
        const sampled = (duration * index) / (frameCount - 1);
        return Math.min(lastReadableTime, index === 0 ? Math.min(0.08, lastReadableTime) : sampled);
      });
      video.currentTime = captureTimes[0] || 0;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const sourceWidth = video.videoWidth || 640;
        const sourceHeight = video.videoHeight || 360;
        canvas.width = Math.min(sourceWidth, 640);
        canvas.height = Math.max(1, Math.round(canvas.width * (sourceHeight / sourceWidth)));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const time = captureTimes[captureIndex] || 0;
          timelineFrames.push({
            time,
            timeFormatted: formatDuration(time),
            thumbnailUrl: canvas.toDataURL('image/jpeg', 0.72),
            label: `${formatDuration(time)} 画面采样`,
            kind: 'video-frame',
          });
        }
      } catch (e) {
        console.warn('Canvas capture error:', e);
      }
      captureIndex += 1;
      if (captureIndex < captureTimes.length) {
        video.currentTime = captureTimes[captureIndex];
      } else {
        finish();
      }
    };

    video.onerror = () => {
      duration = 0;
      res = '未知';
      finish();
    };
  });
}

function waveformDataUrl(samples: Float32Array, start: number, end: number): string | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 120;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.fillStyle = '#18332c';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#e0ae57';
  context.lineWidth = 2;
  context.beginPath();
  const range = Math.max(1, end - start);
  const bucket = Math.max(1, Math.floor(range / canvas.width));
  for (let x = 0; x < canvas.width; x += 1) {
    let peak = 0;
    const from = start + x * bucket;
    const to = Math.min(end, from + bucket);
    for (let index = from; index < to; index += 1) peak = Math.max(peak, Math.abs(samples[index] || 0));
    const height = Math.max(2, peak * canvas.height * 0.78);
    const center = canvas.height / 2;
    context.moveTo(x, center - height / 2);
    context.lineTo(x, center + height / 2);
  }
  context.stroke();
  return canvas.toDataURL('image/jpeg', 0.78);
}

/**
 * 本地浏览器端：音频读取时长 (纯本地 0 Token)
 */
export async function captureAudioMetadata(file: File): Promise<{
  duration: number;
  durationFormatted: string;
  timelineFrames: TimelineFrame[];
}> {
  const metadata = await new Promise<{ duration: number; durationFormatted: string }>((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const url = URL.createObjectURL(file);
    audio.src = url;

    audio.onloadedmetadata = () => {
      const duration = audio.duration || 0;
      URL.revokeObjectURL(url);
      resolve({ duration, durationFormatted: formatDuration(duration) });
    };

    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ duration: 0, durationFormatted: '00:00' });
    };
  });

  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return { ...metadata, timelineFrames: [] };
    const context = new AudioContextClass();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const samples = buffer.getChannelData(0);
    const frameCount = Math.min(7, Math.max(3, Math.ceil(buffer.duration / 30)));
    const segmentLength = Math.max(1, Math.floor(samples.length / frameCount));
    const timelineFrames = Array.from({ length: frameCount }, (_, index): TimelineFrame => {
      const start = index * segmentLength;
      const end = index === frameCount - 1 ? samples.length : Math.min(samples.length, start + segmentLength);
      const time = (buffer.duration * index) / frameCount;
      return {
        time,
        timeFormatted: formatDuration(time),
        thumbnailUrl: waveformDataUrl(samples, start, end),
        label: `${formatDuration(time)} 音频片段`,
        kind: 'audio-waveform',
      };
    });
    await context.close();
    return { ...metadata, timelineFrames };
  } catch (error) {
    console.warn('Audio waveform capture failed:', error);
    return { ...metadata, timelineFrames: [] };
  }
}

/**
 * 离线启发式规则打标引擎（当关闭云端 AI 或无网络时使用，0 Token 保护）
 */
export function localCreatorHeuristic(fileName: string, mediaType: MediaType): {
  category: CreatorCategory;
  tags: string[];
  dimensions: CreatorDimensions;
  proofreadText: string;
} {
  const lower = fileName.toLowerCase();
  let category: CreatorCategory = '其他文件';
  const tags: string[] = [];
  const dimensions: CreatorDimensions = {};
  let proofreadText = '';

  if (mediaType === 'video') {
    if (/a_roll|aroll|口播|录制|讲话|正片|讲解/.test(lower)) {
      category = 'A-Roll口播';
      tags.push('#口播原声', '#主视角', '#核心台词');
      dimensions.shotType = '主视角/中景';
      dimensions.soundType = '人声口播';
      dimensions.hookType = '干货讲解';
      proofreadText = '【口播视频素材】包含主播正面讲解与核心干货输出，适合作为视频主线轨道。';
    } else if (/b_roll|broll|空镜|街头|风景|特写|延时|夜景/.test(lower)) {
      category = 'B-Roll空镜';
      tags.push('#B-Roll空镜', '#氛围转场', '#视觉补充');
      dimensions.shotType = '空镜/特写';
      dimensions.mood = '治愈/质感';
      proofreadText = '【B-Roll 视觉空镜】画面节奏舒适，适合用于口播间隙垫入或情绪转场。';
    } else if (/fail|搞笑|翻车|高能|名场面/.test(lower)) {
      category = 'A-Roll口播';
      tags.push('#高能爆点', '#爆笑反转', '#开头Hook');
      dimensions.mood = '爆笑/反差';
      dimensions.hookType = '开头Hook/爆点';
      proofreadText = '【高能瞬间】情绪起伏剧烈，极度适合切片作为前 3 秒黄金抓人 Hook。';
    } else {
      category = 'A-Roll口播';
      tags.push('#视频素材', '#剪辑片段');
      proofreadText = '【视频素材】已完成本地元数据索引与抽帧。';
    }
  } else if (mediaType === 'audio') {
    if (/bgm|music|配乐|伴奏|lofi|chill|beat/.test(lower)) {
      category = 'BGM配乐';
      tags.push('#卡点BGM', '#背景配乐', '#节奏感');
      dimensions.soundType = '背景配乐 (BGM)';
      dimensions.mood = '舒适/卡点';
      proofreadText = '【背景音乐 BGM】旋律清晰不抢人声，适合作为全片垫底配乐。';
    } else if (/sfx|whoosh|转场|音效|hit|ding|金币|打字|枪声/.test(lower)) {
      category = '转场音效';
      tags.push('#拟音音效', '#转场强化', '#高能卡点');
      dimensions.soundType = '拟音音效 (SFX)';
      dimensions.hookType = '强化注意力';
      proofreadText = '【瞬态音效 SFX】适合配合花字、画面缩放与转场瞬间使用。';
    } else {
      category = '转场音效';
      tags.push('#音频素材', '#声音片段');
      proofreadText = '【音频素材】已提取时长与音频流。';
    }
  } else if (mediaType === 'image') {
    if (/cover|封面|首图|海报|banner/.test(lower)) {
      category = '自媒体封面';
      tags.push('#爆款首图', '#高点击率', '#大字排版');
      dimensions.shotType = '封面设计';
      dimensions.hookType = '黄金首图';
      proofreadText = '【自媒体封面图】视觉冲击力强，适合用于小红书/B站视频首图引流。';
    } else if (/meme|表情包|梗图|emoji|搞笑/.test(lower)) {
      category = '表情包梗图';
      tags.push('#热门梗图', '#趣味插画', '#增加网感');
      dimensions.mood = '搞笑/幽默';
      proofreadText = '【情绪梗图】适合在口播吐槽或反转节点作为贴纸弹窗切入。';
    } else {
      category = '其他文件';
      tags.push('#画面素材', '#参考图');
      proofreadText = '【图片素材】已提取分辨率并生成缩略图。';
    }
  } else if (mediaType === 'document') {
    category = '文档资料';
    tags.push('#文档资料', '#可全文检索');
    dimensions.hookType = '信息参考';
    proofreadText = '【文档资料】已读取文档文字并建立全文索引。';
  }

  return { category, tags, dimensions, proofreadText };
}
