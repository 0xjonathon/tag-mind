export type MediaType = 'video' | 'audio' | 'image' | 'document' | 'other';

export type CreatorCategory = 
  | 'A-Roll口播' 
  | 'B-Roll空镜' 
  | 'BGM配乐' 
  | '转场音效' 
  | '自媒体封面' 
  | '表情包梗图' 
  | '教程录屏' 
  | '文档资料'
  | '其他文件';

export interface KeyQuote {
  time?: string;
  text: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export interface TimelineFrame {
  time: number;
  timeFormatted: string;
  thumbnailUrl?: string;
  label?: string;
  description?: string;
  visualDescriptors?: number[][];
  visualFeatureModel?: {
    width: number;
    height: number;
    features: Array<{ x: number; y: number; descriptor: number[] }>;
  };
  kind: 'video-frame' | 'audio-waveform';
}

export interface TimelineDescription {
  time: number;
  description: string;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceIndexEntry {
  id: string;
  descriptor: number[];
  avatarUrl: string;
  box: FaceBox;
  detectionScore: number;
  personId?: string;
  personLabel?: string;
}

export type AnalysisSource =
  | 'local'
  | 'asr'
  | 'vision_llm'
  | 'asr_llm'
  | 'llm'
  | 'fallback';

export interface CreatorDimensions {
  shotType?: string;    // 景别机位: 特写 / 全景 / B-Roll / 主视角 / 延时
  mood?: string;        // 情绪氛围: 爆笑 / 治愈 / 悬疑 / 燃向 / 科技感 / 焦虑
  soundType?: string;   // 声音类型: 人声口播 / 卡点BGM / 转场音效 / 拟音SFX / 环境音
  hookType?: string;    // 爆点价值: 开头Hook / 金句观点 / 反转时刻 / 痛点共鸣 / 总结升华
}

export interface MediaItem {
  id: string;
  originalName: string;         // 原始文件名（绝不修改原名）
  projectPath: string;          // 导入项目中的相对路径；桌面宿主可提供绝对路径
  pathKind: 'absolute' | 'relative' | 'filename';
  size: number;
  mediaType: MediaType;         // 视频 / 音频 / 图片 / 文档 / 其他
  extension: string;
  category: CreatorCategory;    // 素材分类
  tags: string[];               // AI 总结的多维标签列表
  dimensions: CreatorDimensions;// 四维标签体系
  extractedText?: string;       // 原始转录/OCR文本
  proofreadText: string;        // AI 校对整理后的精修台词 / 纯画面场记描述
  keyQuotes: KeyQuote[];        // 提炼的高能金句与时间戳
  transcriptSegments?: TranscriptSegment[];
  timelineFrames?: TimelineFrame[]; // 本地关键帧 / 音频波形时间轴
  faces?: FaceIndexEntry[];          // 本地人脸特征与头像裁剪，不用于推断真实身份
  visualDescription?: string;
  ocrText?: string;
  analysisSource?: AnalysisSource;
  analysisWarning?: string;
  embedding?: number[];
  visualDescriptors?: number[][];  // 本地像素视觉索引，不包含文字语义
  visualFeatureModel?: {
    width: number;
    height: number;
    features: Array<{ x: number; y: number; descriptor: number[] }>;
  };                              // 本地局部特征索引，用于元素包含定位
  duration?: number;            // 时长（秒）
  durationFormatted?: string;   // 时长格式化 (如 "01:23")
  resolution?: string;          // 分辨率 (如 "1920x1080")
  thumbnailUrl?: string;        // 代表帧缩略图 / 封面
  fileUrl?: string;             // 本地或 ObjectURL 播放源
  isDuplicate?: boolean;
  duplicateOfId?: string;
  hash?: string;
  status: 'pending' | 'analyzing' | 'done' | 'error';
  fileObject?: File;
  createdAt: string;
}

export interface AISettings {
  enableCloudAI: boolean;       // 外部 AI 总开关 (OFF 时走纯本地离线规则)
  provider: 'openai' | 'ollama' | 'custom';
  providerName: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  visionModel: string;
  transcriptionModel: string;
  embeddingModel: string;
  enableTranscription: boolean;
  enableVision: boolean;
  enableTextOrganization: boolean;
  enableSemanticSearch: boolean;
  language: string;
  maxUploadMb: number;
  enableLocalDeduplication: boolean;
  autoProofread: boolean;
}

export interface BatchAnalysisResult {
  id: string;
  category: CreatorCategory;
  tags: string[];
  dimensions: CreatorDimensions;
  proofreadText: string;
  keyQuotes: KeyQuote[];
  visualDescription?: string;
  ocrText?: string;
  timelineDescriptions?: TimelineDescription[];
  analysisSource?: AnalysisSource;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
  duration?: number;
}
