# TagMind

> 听懂台词，看懂画面，读懂文档，一点线索直达内容。

TagMind 是一个面向内容团队的数字资产提炼检索 Agent，也是 VibeHack #05「Vibe Coding for 准点下班」参赛项目。它为本地视频、音频、图片和文档建立内容级索引，让用户不必记住文件名，只需描述台词、画面、人物或正文，就能定位到真正需要的文件，甚至视频与音频中的具体时间点。

**在线体验：[tagmind-ai.vercel.app](https://tagmind-ai.vercel.app/)**

## 为什么做 TagMind

内容团队的时间经常不是花在创作上，而是消耗在寻找内容：逐个打开 `IMG_`、`VID_` 文件，反复播放录音，拖动视频进度条，或者翻遍散落的 Word、PPT 和 PDF。

TagMind 把这段机械工作压缩成一次搜索：

- 从“按文件名找文件”升级为“按内容找片段”；
- 不需要重新命名、移动或整理原文件；
- 搜索结果保留原始证据，可预览、可高亮、可跳转时间点；
- AI 服务可自行配置，单项能力失败时仍可使用本地索引。

## 核心能力

### 多模态内容理解

- **视频：**抽取时间轴画面，理解各时刻的真实内容，并结合语音转写定位台词。
- **音频：**ASR 转写并保留时间片段，命中结果可直接跳到对应秒数。
- **图片：**提取画面描述与 OCR 信息，支持人脸识别、同人物聚类和头像筛选。
- **文档：**读取 Word、Excel、PPT、PDF、TXT 等文件正文，统一建立搜索索引。

### 多入口智能检索

- 自然语言搜索台词、画面、人物和文档正文，长句会先由 LLM 理解意图并提炼关键词；
- 关键词模糊匹配，例如输入近似拼写也能找到目标内容；
- Embedding 语义召回，不要求搜索词与原文完全一致；
- 语音输入先由 LLM 整理为清晰查询，再由用户确认搜索；
- 上传参考图片，以图寻找相关图片和视频；
- 搜索结果高亮关键词，并支持按文件、人物、标签和扩展名筛选。

### 内容整理与交付

- 自动生成摘要、标签、实体和可追溯的内容描述；
- 基于 SHA-256 指纹识别重复文件；
- 最近文件以动态卡牌形式展示；
- 导出包含文件名、时间点、台词和标签的 Markdown / CSV 场记单。

## 工作流程

```text
导入文件或文件夹
        ↓
浏览器读取元数据、缩略图与文件指纹
        ↓
ASR 转写 / 视频时间轴 / 视觉理解 / 文档解析 / 人脸聚类
        ↓
LLM 整理内容并生成 Embedding
        ↓
自然语言、语音、关键词或图片检索
        ↓
高亮命中内容、筛选结果、跳转时间点、导出场记单
```

## 支持的文件

| 类型 | 常见格式 | 索引内容 |
| --- | --- | --- |
| 视频 | MP4、MOV、WebM 等 | 台词、时间轴画面、OCR、人物、标签 |
| 音频 | MP3、WAV、M4A 等 | 转写文本、时间片段、摘要、标签 |
| 图片 | JPG、PNG、WebP 等 | 画面描述、OCR、人脸、标签 |
| 文档 | DOCX、XLSX、PPTX、PDF、TXT 等 | 正文、摘要、实体、标签 |

具体格式支持取决于浏览器解码能力和所配置的 AI 服务。

## 本地运行

环境要求：Node.js 20+ 与 npm。

```bash
git clone https://github.com/0xjonathon/tag-mind.git
cd tag-mind
npm install
npm run dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。

## 模型配置

点击页面右上角「模型配置」，可选择 OpenAI-compatible 云端服务、本地 Ollama 或自定义服务。ASR、Vision、LLM 整理和 Embedding 均可单独启用与配置。

OpenAI-compatible 服务通常需要提供以下接口：

```text
POST /chat/completions
POST /audio/transcriptions
POST /embeddings
```

服务商可以只实现部分能力。若某个外部接口不可用，TagMind 会提示对应能力降级，其他文件处理与本地关键词检索仍可继续使用。

## 技术栈

- Next.js 16、React 19、TypeScript
- Tailwind CSS、Framer Motion、Lucide React
- PDF.js、Mammoth、SheetJS、JSZip
- face-api、Web Crypto API
- OpenAI-compatible AI 接口

## 隐私与数据边界

- 只建立索引，不修改、移动或删除原文件；
- API Key 仅保存在当前浏览器的 Local Storage，不写入项目文件；
- 未启用外部 AI 时，元数据读取、文件指纹、去重和关键词检索均在本地完成；
- 启用外部 AI 后，仅相关转写文件、关键帧或文本证据会经 Next.js 路由转发至用户配置的服务商；
- 当前比赛版本不提供账户系统、团队同步或服务端持久化。

## 项目验证

```bash
npm run lint
npx tsc --noEmit
npm run build -- --webpack
```

## 更多资料

- [黑客松演讲稿](docs/HACKATHON_PITCH.md)
- [项目说明](docs/PROJECT_BRIEF.md)
- [UI 设计说明](docs/UI_DESIGN.md)

## 黑客松主题

TagMind 对「Vibe Coding for 准点下班」的回答很直接：不替职场人制造更多内容，而是消灭最机械、最重复、最不值得加班的查找工作。

**过去，文件名告诉你它叫什么；现在，TagMind 告诉你它里面有什么。**

**TagMind 不帮你加速加班，它帮你删掉加班。**
