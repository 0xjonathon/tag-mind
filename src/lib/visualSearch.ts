import { descriptorDistance } from './faceRecognition';
import { FaceIndexEntry } from '@/types/file';

export type VisualDescriptor = number[];

type BinaryFeature = {
  x: number;
  y: number;
  scale?: number;
  descriptor: number[];
};

export type LocalFeatureModel = {
  width: number;
  height: number;
  features: BinaryFeature[];
};

export interface VisualContainmentQuery {
  descriptor: VisualDescriptor;
  aspectRatio: number;
  localFeatures?: LocalFeatureModel;
  faceDescriptors?: number[][];
}

const SAMPLE_SIZE = 32;
const COLOR_GRID = 4;
const STRUCTURE_GRID = 8;
const HOG_GRID = 4;
const HOG_BINS = 8;
const HISTOGRAM_BINS = 64;
const FEATURE_MAX_EDGE = 800;
const CANDIDATE_MAX_EDGE = 1400;
const BRIEF_BITS = 256;

type Crop = { x: number; y: number; width: number; height: number };
type DescriptorWorkspace = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
};

type GrayRaster = {
  width: number;
  height: number;
  pixels: Float32Array;
};

const FAST_CIRCLE = [
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
] as const;

// 固定伪随机序列，生成 256 对 BRIEF 采样坐标（归一化半径范围 [-1, 1]）
const BASE_BRIEF_PAIRS: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]> = (() => {
  let state = 0x51f15e;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const point = () => {
    const radius = Math.sqrt(random()) * 8.5;
    const angle = random() * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
  };
  return Array.from({ length: BRIEF_BITS }, () => [point(), point()] as const);
})();

const BASE_CROPS: Crop[] = [
  { x: 0, y: 0, width: 1, height: 1 },
  { x: 0.06, y: 0.06, width: 0.88, height: 0.88 },
];

type IndexDensity = boolean | 'coarse' | 'dense';

function clampCropAroundCenter(centerX: number, centerY: number, width: number, height: number): Crop {
  const safeWidth = Math.max(0.01, Math.min(1, width));
  const safeHeight = Math.max(0.01, Math.min(1, height));
  return {
    x: Math.max(0, Math.min(1 - safeWidth, centerX - safeWidth / 2)),
    y: Math.max(0, Math.min(1 - safeHeight, centerY - safeHeight / 2)),
    width: safeWidth,
    height: safeHeight,
  };
}

/**
 * 建立多尺度预索引切片，覆盖 2x2, 3x3, 4x4 等多尺度区域与不同长宽比
 */
function createIndexCrops(image: HTMLImageElement, density: Exclude<IndexDensity, boolean>): Crop[] {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const imageAspect = sourceWidth / Math.max(1, sourceHeight);
  const grids = density === 'dense' ? [2, 3, 4] : [2, 3];
  const cropAspects = density === 'dense' ? [0.6, 1.0, 1.6] : [1.0, 1.5];
  const crops = [...BASE_CROPS];

  for (const grid of grids) {
    for (let row = 0; row < grid; row += 1) {
      for (let column = 0; column < grid; column += 1) {
        const centerX = (column + 0.5) / grid;
        const centerY = (row + 0.5) / grid;
        for (const cropAspect of cropAspects) {
          const baseSize = 1.35 / grid;
          const width = Math.min(1, baseSize * Math.sqrt(cropAspect / imageAspect));
          const height = Math.min(1, baseSize * Math.sqrt(imageAspect / cropAspect));
          crops.push(clampCropAroundCenter(centerX, centerY, width, height));
        }
      }
    }
  }
  return crops;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取图片视觉特征'));
    image.src = source;
  });
}

function rasterizeGray(image: HTMLImageElement, crop: Crop, maxEdge: number): GrayRaster | null {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropWidth = Math.max(1, crop.width * sourceWidth);
  const cropHeight = Math.max(1, crop.height * sourceHeight);
  const scale = Math.min(1, maxEdge / Math.max(cropWidth, cropHeight));
  const width = Math.max(1, Math.round(cropWidth * scale));
  const height = Math.max(1, Math.round(cropHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(
    image,
    crop.x * sourceWidth,
    crop.y * sourceHeight,
    cropWidth,
    cropHeight,
    0,
    0,
    width,
    height,
  );
  const rgba = context.getImageData(0, 0, width, height).data;
  const pixels = new Float32Array(width * height);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    pixels[index] = (rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114) / 255;
  }
  return { width, height, pixels };
}

function resizeGray(source: GrayRaster, scale: number): GrayRaster {
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const pixels = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, (y + 0.5) / scale - 0.5);
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, (x + 0.5) / scale - 0.5);
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = sourceX - x0;
      const top = source.pixels[y0 * source.width + x0] * (1 - fx) + source.pixels[y0 * source.width + x1] * fx;
      const bottom = source.pixels[y1 * source.width + x0] * (1 - fx) + source.pixels[y1 * source.width + x1] * fx;
      pixels[y * width + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return { width, height, pixels };
}

function grayAt(raster: GrayRaster, x: number, y: number): number {
  const safeX = Math.max(0, Math.min(raster.width - 1, x));
  const safeY = Math.max(0, Math.min(raster.height - 1, y));
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(raster.width - 1, x0 + 1);
  const y1 = Math.min(raster.height - 1, y0 + 1);
  const fx = safeX - x0;
  const fy = safeY - y0;
  const top = raster.pixels[y0 * raster.width + x0] * (1 - fx) + raster.pixels[y0 * raster.width + x1] * fx;
  const bottom = raster.pixels[y1 * raster.width + x0] * (1 - fx) + raster.pixels[y1 * raster.width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function fastCornerScore(raster: GrayRaster, x: number, y: number, threshold = 0.048): number {
  const center = raster.pixels[y * raster.width + x];
  const signs = FAST_CIRCLE.map(([offsetX, offsetY]) => {
    const difference = raster.pixels[(y + offsetY) * raster.width + x + offsetX] - center;
    return difference > threshold ? 1 : difference < -threshold ? -1 : 0;
  });
  let bestRun = 0;
  for (const target of [-1, 1]) {
    let run = 0;
    for (let index = 0; index < signs.length * 2; index += 1) {
      run = signs[index % signs.length] === target ? run + 1 : 0;
      bestRun = Math.max(bestRun, Math.min(run, signs.length));
    }
  }
  if (bestRun < 9) return 0;
  return FAST_CIRCLE.reduce((score, [offsetX, offsetY]) => (
    score + Math.abs(raster.pixels[(y + offsetY) * raster.width + x + offsetX] - center)
  ), 0);
}

function describeBinaryFeature(raster: GrayRaster, x: number, y: number): number[] {
  let momentX = 0;
  let momentY = 0;
  for (let offsetY = -8; offsetY <= 8; offsetY += 2) {
    for (let offsetX = -8; offsetX <= 8; offsetX += 2) {
      const value = grayAt(raster, x + offsetX, y + offsetY);
      momentX += offsetX * value;
      momentY += offsetY * value;
    }
  }
  const angle = Math.atan2(momentY, momentX);
  const cosineAngle = Math.cos(angle);
  const sineAngle = Math.sin(angle);
  const descriptor = new Array<number>(BRIEF_BITS / 32).fill(0);

  BASE_BRIEF_PAIRS.forEach(([left, right], bit) => {
    const leftX = x + left[0] * cosineAngle - left[1] * sineAngle;
    const leftY = y + left[0] * sineAngle + left[1] * cosineAngle;
    const rightX = x + right[0] * cosineAngle - right[1] * sineAngle;
    const rightY = y + right[0] * sineAngle + right[1] * cosineAngle;
    if (grayAt(raster, leftX, leftY) < grayAt(raster, rightX, rightY)) {
      descriptor[bit >>> 5] = (descriptor[bit >>> 5] | (1 << (bit & 31))) >>> 0;
    }
  });
  return descriptor;
}

function extractLevelFeatures(raster: GrayRaster, scale: number, limit: number): BinaryFeature[] {
  if (raster.width < 28 || raster.height < 28) return [];
  const cells = new Map<string, { x: number; y: number; score: number }[]>();
  const cellSize = 22;

  // 自适应阈值：先用标准阈值，若角点过少则降级重探
  for (const threshold of [0.048, 0.032]) {
    cells.clear();
    for (let y = 11; y < raster.height - 11; y += 2) {
      for (let x = 11; x < raster.width - 11; x += 2) {
        const score = fastCornerScore(raster, x, y, threshold);
        if (!score) continue;
        const key = `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
        const entries = cells.get(key) || [];
        entries.push({ x, y, score });
        entries.sort((left, right) => right.score - left.score);
        entries.length = Math.min(3, entries.length);
        cells.set(key, entries);
      }
    }
    const count = [...cells.values()].reduce((sum, list) => sum + list.length, 0);
    if (count >= Math.min(24, limit * 0.4)) break;
  }

  return [...cells.values()]
    .flat()
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ x, y }) => ({
      x: x / scale,
      y: y / scale,
      scale,
      descriptor: describeBinaryFeature(raster, x, y),
    }));
}

function extractLocalFeatureModel(image: HTMLImageElement, crop: Crop, query: boolean): LocalFeatureModel | undefined {
  const base = rasterizeGray(image, crop, query ? FEATURE_MAX_EDGE : CANDIDATE_MAX_EDGE);
  if (!base) return undefined;
  // 覆盖更宽广的尺度金字塔（从 1.0 到 0.25）以捕获大图中的任意尺寸子元素
  const scales = query ? [1.0, 0.8, 0.64, 0.5, 0.38, 0.28] : [1.0, 0.75, 0.5, 0.35, 0.25];
  const features: BinaryFeature[] = [];
  for (const scale of scales) {
    const raster = scale === 1.0 ? base : resizeGray(base, scale);
    features.push(...extractLevelFeatures(raster, scale, query ? 90 : 140));
  }
  return { width: base.width, height: base.height, features };
}

export async function createLocalFeatureIndex(source: string): Promise<LocalFeatureModel | undefined> {
  if (!source) return undefined;
  const image = await loadImage(source);
  return extractLocalFeatureModel(image, BASE_CROPS[0], false);
}

function createWorkspace(): DescriptorWorkspace | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return context ? { canvas, context } : null;
}

/**
 * 提取融合描述符：
 * 1. 64-bin 全局色彩分布直方图（平移不变）
 * 2. 4x4 空间色彩金字塔（抗轻微位移）
 * 3. HOG 梯度方向直方图（4x4 空间区域，8 方向，抓取轮廓与笔画特征）
 * 4. 8x8 结构亮度与对比度
 */
function describeCrop(image: HTMLImageElement, crop: Crop, workspace?: DescriptorWorkspace): VisualDescriptor | null {
  const ownedWorkspace = workspace || createWorkspace();
  if (!ownedWorkspace) return null;
  const { context } = ownedWorkspace;

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  context.drawImage(
    image,
    crop.x * sourceWidth,
    crop.y * sourceHeight,
    crop.width * sourceWidth,
    crop.height * sourceHeight,
    0,
    0,
    SAMPLE_SIZE,
    SAMPLE_SIZE,
  );

  const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  const luminance = new Float32Array(SAMPLE_SIZE * SAMPLE_SIZE);
  const colorGrid = new Float32Array(COLOR_GRID * COLOR_GRID * 3);
  const colorCounts = new Float32Array(COLOR_GRID * COLOR_GRID);
  const histogram = new Float32Array(HISTOGRAM_BINS);

  for (let y = 0; y < SAMPLE_SIZE; y += 1) {
    for (let x = 0; x < SAMPLE_SIZE; x += 1) {
      const pixelIndex = (y * SAMPLE_SIZE + x) * 4;
      const red = pixels[pixelIndex] / 255;
      const green = pixels[pixelIndex + 1] / 255;
      const blue = pixels[pixelIndex + 2] / 255;
      luminance[y * SAMPLE_SIZE + x] = red * 0.299 + green * 0.587 + blue * 0.114;

      const gridX = Math.min(COLOR_GRID - 1, Math.floor((x / SAMPLE_SIZE) * COLOR_GRID));
      const gridY = Math.min(COLOR_GRID - 1, Math.floor((y / SAMPLE_SIZE) * COLOR_GRID));
      const gridIndex = gridY * COLOR_GRID + gridX;
      colorGrid[gridIndex * 3] += red;
      colorGrid[gridIndex * 3 + 1] += green;
      colorGrid[gridIndex * 3 + 2] += blue;
      colorCounts[gridIndex] += 1;

      const histIndex = Math.min(3, Math.floor(red * 4)) * 16
        + Math.min(3, Math.floor(green * 4)) * 4
        + Math.min(3, Math.floor(blue * 4));
      histogram[histIndex] += 1;
    }
  }

  for (let index = 0; index < colorCounts.length; index += 1) {
    const count = colorCounts[index] || 1;
    colorGrid[index * 3] /= count;
    colorGrid[index * 3 + 1] /= count;
    colorGrid[index * 3 + 2] /= count;
  }

  const totalPixels = SAMPLE_SIZE * SAMPLE_SIZE;
  const normalizedHistogram = Array.from(histogram).map((val) => val / totalPixels);

  // 8x8 结构特征（局部均值 + 边缘能量）
  const structure = new Array<number>(STRUCTURE_GRID * STRUCTURE_GRID);
  const bucketSize = SAMPLE_SIZE / STRUCTURE_GRID;
  for (let gridY = 0; gridY < STRUCTURE_GRID; gridY += 1) {
    for (let gridX = 0; gridX < STRUCTURE_GRID; gridX += 1) {
      let sum = 0;
      let count = 0;
      for (let y = Math.floor(gridY * bucketSize); y < Math.floor((gridY + 1) * bucketSize); y += 1) {
        for (let x = Math.floor(gridX * bucketSize); x < Math.floor((gridX + 1) * bucketSize); x += 1) {
          sum += luminance[y * SAMPLE_SIZE + x];
          count += 1;
        }
      }
      structure[gridY * STRUCTURE_GRID + gridX] = sum / (count || 1);
    }
  }

  // 4x4 HOG (8 方向梯度方向直方图，总共 128 维)
  const hog = new Float32Array(HOG_GRID * HOG_GRID * HOG_BINS);
  const hogCellSize = SAMPLE_SIZE / HOG_GRID;
  for (let y = 1; y < SAMPLE_SIZE - 1; y += 1) {
    for (let x = 1; x < SAMPLE_SIZE - 1; x += 1) {
      const gx = luminance[y * SAMPLE_SIZE + (x + 1)] - luminance[y * SAMPLE_SIZE + (x - 1)];
      const gy = luminance[(y + 1) * SAMPLE_SIZE + x] - luminance[(y - 1) * SAMPLE_SIZE + x];
      const magnitude = Math.hypot(gx, gy);
      if (magnitude < 0.005) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      const bin = Math.min(HOG_BINS - 1, Math.floor((angle / Math.PI) * HOG_BINS));
      const cellX = Math.min(HOG_GRID - 1, Math.floor(x / hogCellSize));
      const cellY = Math.min(HOG_GRID - 1, Math.floor(y / hogCellSize));
      const cellIndex = (cellY * HOG_GRID + cellX) * HOG_BINS + bin;
      hog[cellIndex] += magnitude;
    }
  }

  // L2 归一化 HOG 特征块
  for (let cell = 0; cell < HOG_GRID * HOG_GRID; cell += 1) {
    let norm = 0;
    for (let b = 0; b < HOG_BINS; b += 1) norm += hog[cell * HOG_BINS + b] ** 2;
    const scale = Math.sqrt(norm) + 1e-4;
    for (let b = 0; b < HOG_BINS; b += 1) hog[cell * HOG_BINS + b] /= scale;
  }

  return [
    ...Array.from(colorGrid),
    ...structure,
    ...normalizedHistogram,
    ...Array.from(hog),
  ];
}

export async function createVisualDescriptors(source: string, density: IndexDensity = 'dense'): Promise<VisualDescriptor[]> {
  if (!source) return [];
  const image = await loadImage(source);
  const crops = density === false
    ? BASE_CROPS.slice(0, 1)
    : createIndexCrops(image, density === true ? 'dense' : density);
  const workspace = createWorkspace();
  if (!workspace) return [];
  return crops
    .map((crop) => describeCrop(image, crop, workspace))
    .filter((descriptor): descriptor is VisualDescriptor => Boolean(descriptor));
}

/**
 * 寻找元素主体区域，避免过度裁切导致丢失关键轮廓
 */
function findContentCrop(image: HTMLImageElement): Crop {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const maxEdge = 240;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return BASE_CROPS[0];
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

  const corners = [
    0,
    (canvas.width - 1) * 4,
    (canvas.width * (canvas.height - 1)) * 4,
    (canvas.width * canvas.height - 1) * 4,
  ];
  const background = [0, 1, 2].map((channel) => corners.reduce((sum, offset) => sum + pixels[offset + channel], 0) / corners.length);
  const cornerSpread = Math.max(...corners.map((offset) => Math.hypot(
    pixels[offset] - background[0],
    pixels[offset + 1] - background[1],
    pixels[offset + 2] - background[2],
  )));

  // 四角颜色不一致说明是真实照片或复杂背景，不强行裁切
  if (cornerSpread > 28) return BASE_CROPS[0];

  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let foregroundCount = 0;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const alpha = pixels[offset + 3];
      const distance = Math.hypot(
        pixels[offset] - background[0],
        pixels[offset + 1] - background[1],
        pixels[offset + 2] - background[2],
      );
      if (alpha > 20 && distance > 28) {
        foregroundCount += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (foregroundCount < canvas.width * canvas.height * 0.01 || maxX <= minX || maxY <= minY) return BASE_CROPS[0];

  // 适度保留外边缘（10% 留白），避免切断笔画或阴影
  const paddingX = Math.max(2, Math.round((maxX - minX + 1) * 0.10));
  const paddingY = Math.max(2, Math.round((maxY - minY + 1) * 0.10));
  minX = Math.max(0, minX - paddingX);
  minY = Math.max(0, minY - paddingY);
  maxX = Math.min(canvas.width - 1, maxX + paddingX);
  maxY = Math.min(canvas.height - 1, maxY + paddingY);

  return {
    x: minX / canvas.width,
    y: minY / canvas.height,
    width: (maxX - minX + 1) / canvas.width,
    height: (maxY - minY + 1) / canvas.height,
  };
}

export async function createVisualContainmentQuery(source: string): Promise<VisualContainmentQuery | null> {
  if (!source) return null;
  const image = await loadImage(source);
  const crop = findContentCrop(image);
  const descriptor = describeCrop(image, crop);
  if (!descriptor) return null;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  return {
    descriptor,
    aspectRatio: (crop.width * sourceWidth) / Math.max(1, crop.height * sourceHeight),
    localFeatures: extractLocalFeatureModel(image, crop, true),
  };
}

/**
 * 密集多尺度与多长宽比滑动窗口生成
 */
function createContainmentCrops(image: HTMLImageElement, queryAspectRatio: number): Crop[] {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const imageAspectRatio = sourceWidth / Math.max(1, sourceHeight);
  const crops: Crop[] = [BASE_CROPS[0], BASE_CROPS[1]];

  // 针对长宽比增加扰动，容忍用户裁剪留白偏差
  const aspectMultipliers = [0.82, 1.0, 1.22];
  const areaFractions = [0.003, 0.008, 0.018, 0.038, 0.075, 0.14, 0.26, 0.48, 0.76, 1.0];

  for (const multiplier of aspectMultipliers) {
    const targetAspect = queryAspectRatio * multiplier;
    for (const area of areaFractions) {
      const width = Math.sqrt((area * targetAspect) / imageAspectRatio);
      const height = Math.sqrt((area * imageAspectRatio) / targetAspect);
      if (width > 1.001 || height > 1.001 || width < 0.025 || height < 0.025) continue;

      const columns = Math.min(20, Math.max(1, Math.ceil((1 - width) / Math.max(0.02, width * 0.45)) + 1));
      const rows = Math.min(20, Math.max(1, Math.ceil((1 - height) / Math.max(0.02, height * 0.45)) + 1));

      for (let row = 0; row < rows; row += 1) {
        const y = rows === 1 ? (1 - height) / 2 : (row / (rows - 1)) * (1 - height);
        for (let column = 0; column < columns; column += 1) {
          const x = columns === 1 ? (1 - width) / 2 : (column / (columns - 1)) * (1 - width);
          crops.push({ x, y, width, height });
        }
      }
    }
  }
  return crops;
}

function popcount(value: number): number {
  let bits = value >>> 0;
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function hammingDistance(left: number[], right: number[]): number {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    distance += popcount((left[index] ^ right[index]) >>> 0);
  }
  return distance;
}

type FeatureMatch = { query: BinaryFeature; candidate: BinaryFeature; distance: number };

function matchBinaryFeatures(query: LocalFeatureModel, candidate: LocalFeatureModel): FeatureMatch[] {
  if (query.features.length < 4 || candidate.features.length < 4) return [];
  const matches: FeatureMatch[] = [];

  for (const queryFeature of query.features) {
    let best: BinaryFeature | undefined;
    let bestDistance = Infinity;
    let secondDistance = Infinity;

    for (const candidateFeature of candidate.features) {
      const distance = hammingDistance(queryFeature.descriptor, candidateFeature.descriptor);
      if (distance < bestDistance) {
        if (!best || Math.hypot(candidateFeature.x - best.x, candidateFeature.y - best.y) > 6) {
          secondDistance = bestDistance;
        }
        bestDistance = distance;
        best = candidateFeature;
      } else if ((!best || Math.hypot(candidateFeature.x - best.x, candidateFeature.y - best.y) > 6) && distance < secondDistance) {
        secondDistance = distance;
      }
    }

    // 采用宽松但稳健的 Lowe Ratio 检验与绝对汉明距离门限
    if (best && bestDistance <= 92 && (bestDistance < secondDistance * 0.88 || bestDistance <= 52)) {
      matches.push({ query: queryFeature, candidate: best, distance: bestDistance });
    }
  }
  return matches.sort((left, right) => left.distance - right.distance).slice(0, 120);
}

/**
 * 局部特征几何一致性评分（RANSAC）
 */
function featureContainmentScore(query: LocalFeatureModel | undefined, candidate: LocalFeatureModel | undefined): number {
  if (!query || !candidate || query.features.length < 6 || candidate.features.length < 6) return 0;
  const matches = matchBinaryFeatures(query, candidate);
  if (matches.length < 3) return 0;

  const diagonal = Math.hypot(candidate.width, candidate.height);
  const tolerance = Math.max(5, Math.min(22, diagonal * 0.016));
  let bestInliers: FeatureMatch[] = [];

  const maxSamples = Math.min(matches.length * 4, 180);
  for (let sample = 0; sample < maxSamples; sample += 1) {
    const first = Math.floor(Math.random() * matches.length);
    let second = Math.floor(Math.random() * matches.length);
    if (first === second) second = (first + 1) % matches.length;

    const q1 = matches[first].query;
    const q2 = matches[second].query;
    const c1 = matches[first].candidate;
    const c2 = matches[second].candidate;

    const qx = q2.x - q1.x;
    const qy = q2.y - q1.y;
    const cx = c2.x - c1.x;
    const cy = c2.y - c1.y;
    const denominator = qx * qx + qy * qy;
    if (denominator < 64 || cx * cx + cy * cy < 16) continue;

    const a = (cx * qx + cy * qy) / denominator;
    const b = (cy * qx - cx * qy) / denominator;
    const scale = Math.hypot(a, b);
    if (scale < 0.02 || scale > 20) continue;

    const translateX = c1.x - (a * q1.x - b * q1.y);
    const translateY = c1.y - (b * q1.x + a * q1.y);

    const inliers = matches.filter((match) => {
      const projectedX = a * match.query.x - b * match.query.y + translateX;
      const projectedY = b * match.query.x + a * match.query.y + translateY;
      return Math.hypot(projectedX - match.candidate.x, projectedY - match.candidate.y) <= tolerance;
    });

    if (inliers.length > bestInliers.length) {
      bestInliers = inliers;
      if (bestInliers.length >= 24) break;
    }
  }

  const uniqueCandidateCells = new Set(bestInliers.map((match) => (
    `${Math.round(match.candidate.x / (tolerance * 1.5))}:${Math.round(match.candidate.y / (tolerance * 1.5))}`
  ))).size;
  const reliableInliers = Math.min(uniqueCandidateCells, bestInliers.length);

  if (reliableInliers < 3) return 0;

  const inlierRatio = bestInliers.length / matches.length;
  const descriptorQuality = 1 - bestInliers.reduce((sum, match) => sum + match.distance, 0) / bestInliers.length / BRIEF_BITS;

  // 平滑连续的几何置信度评分函数
  const baseScore = reliableInliers >= 8 ? 0.78 : reliableInliers >= 5 ? 0.68 : 0.58;
  const inlierBonus = Math.min(0.20, (reliableInliers - 3) * 0.025);
  const qualityBonus = Math.max(0, descriptorQuality - 0.65) * 0.25;
  const ratioBonus = inlierRatio * 0.08;

  return Math.min(0.99, baseScore + inlierBonus + qualityBonus + ratioBonus);
}

function cosine(left: number[], right: number[], start: number, length: number): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = start; index < start + length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function visualSimilarity(left?: VisualDescriptor, right?: VisualDescriptor): number {
  if (!left?.length || !right?.length || left.length !== right.length) return 0;

  const colorLength = COLOR_GRID * COLOR_GRID * 3;
  const structureLength = STRUCTURE_GRID * STRUCTURE_GRID;
  const histogramStart = colorLength + structureLength;
  const histogramLength = HISTOGRAM_BINS;
  const hogStart = histogramStart + histogramLength;
  const hogLength = HOG_GRID * HOG_GRID * HOG_BINS;

  // 1. 空间色彩相似度（非线性加权，严格惩罚颜色与空间布局差异）
  let colorDistance = 0;
  for (let index = 0; index < colorLength; index += 1) colorDistance += (left[index] - right[index]) ** 2;
  const normalizedColorDist = Math.sqrt(colorDistance / colorLength);
  const colorScore = Math.max(0, 1 - normalizedColorDist * 1.8) ** 2;

  // 2. 结构亮度相似度 (NCC, 过滤弱相关与负相关基底)
  const rawStructureCos = cosine(left, right, colorLength, structureLength);
  const structureScore = Math.max(0, (rawStructureCos - 0.25) / 0.75) ** 2;

  // 3. 全局色彩分布直方图交集 (减去随机重合基底)
  let histogramOverlap = 0;
  for (let index = histogramStart; index < histogramStart + histogramLength; index += 1) {
    histogramOverlap += Math.min(left[index], right[index]);
  }
  const histogramScore = Math.max(0, (histogramOverlap - 0.38) / 0.62) ** 2;

  // 4. HOG 梯度方向轮廓相似度
  const rawHogCos = cosine(left, right, hogStart, hogLength);
  const hogScore = Math.max(0, (rawHogCos - 0.20) / 0.80) ** 2;

  return colorScore * 0.25 + structureScore * 0.25 + histogramScore * 0.20 + hogScore * 0.30;
}

export function bestVisualSimilarity(query: VisualDescriptor | null, candidates?: VisualDescriptor[]): number {
  if (!query || !candidates?.length) return 0;
  return candidates.reduce((best, candidate) => Math.max(best, visualSimilarity(query, candidate)), 0);
}

/**
 * 局部包含综合匹配引擎
 */
export async function containedVisualSimilarity(
  query: VisualContainmentQuery,
  candidateSources: string[],
  fallbackDescriptors?: VisualDescriptor[],
  indexedFeatureModels?: Array<LocalFeatureModel | undefined>,
  candidateFaces?: FaceIndexEntry[],
): Promise<number> {
  // 1. 若检索图包含人脸：优先以高精度 128 维深度人脸向量进行身份比对
  if (query.faceDescriptors && query.faceDescriptors.length > 0) {
    if (candidateFaces && candidateFaces.length > 0) {
      let minDistance = Infinity;
      for (const queryFace of query.faceDescriptors) {
        for (const candidateFace of candidateFaces) {
          const distance = descriptorDistance(queryFace, candidateFace.descriptor);
          if (distance < minDistance) minDistance = distance;
        }
      }

      // 人脸欧氏距离判断：
      // <= 0.44: 极高置信度同一人 (0.90 ~ 0.99)
      // <= 0.54: 确认为同一人 (0.78 ~ 0.89)
      // <= 0.58: 临界可能同一人 (0.65)
      // > 0.58: 明确为不同人物！硬拒绝，直接返回 0.02
      if (minDistance <= 0.44) {
        return Math.min(0.99, 0.90 + (0.44 - minDistance) * 0.20);
      }
      if (minDistance <= 0.54) {
        return Math.min(0.89, 0.78 + (0.54 - minDistance) * 1.10);
      }
      if (minDistance <= 0.58) {
        return 0.65;
      }
      return 0.02;
    }
  }

  let best = bestVisualSimilarity(query.descriptor, fallbackDescriptors);
  let bestLocalFeatureScore = 0;
  const workspace = createWorkspace();
  if (!workspace) return best;

  for (const [sourceIndex, source] of candidateSources.filter(Boolean).entries()) {
    try {
      const image = await loadImage(source);

      // 2. 局部关键点特征几何验证
      const localFeatureScore = featureContainmentScore(
        query.localFeatures,
        indexedFeatureModels?.[sourceIndex] || extractLocalFeatureModel(image, BASE_CROPS[0], false),
      );
      bestLocalFeatureScore = Math.max(bestLocalFeatureScore, localFeatureScore);
      best = Math.max(best, localFeatureScore);
      if (localFeatureScore >= 0.88) return localFeatureScore;

      // 3. 密集多尺度/多长宽比滑动窗口扫描
      const crops = createContainmentCrops(image, query.aspectRatio);
      const strongest: Array<{ score: number; crop: Crop }> = [];
      const remember = (score: number, crop: Crop) => {
        if (strongest.length < 8 || score > strongest[strongest.length - 1].score) {
          strongest.push({ score, crop });
          strongest.sort((left, right) => right.score - left.score);
          strongest.length = Math.min(8, strongest.length);
        }
      };

      for (let index = 0; index < crops.length; index += 1) {
        const descriptor = describeCrop(image, crops[index], workspace);
        const score = visualSimilarity(query.descriptor, descriptor || undefined);
        best = Math.max(best, score);
        remember(score, crops[index]);
        if (best >= 0.985) return best;
        if (index > 0 && index % 280 === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }

      // 4. 在最强响应区域周围做位置与尺寸微调 (Fine Sub-pixel Refinement)
      for (const { crop } of [...strongest]) {
        const centerX = crop.x + crop.width / 2;
        const centerY = crop.y + crop.height / 2;
        for (const scale of [0.88, 1.0, 1.14]) {
          for (const offsetY of [-0.2, 0, 0.2]) {
            for (const offsetX of [-0.2, 0, 0.2]) {
              const refined = clampCropAroundCenter(
                centerX + crop.width * offsetX,
                centerY + crop.height * offsetY,
                crop.width * scale,
                crop.height * scale,
              );
              const score = visualSimilarity(query.descriptor, describeCrop(image, refined, workspace) || undefined);
              best = Math.max(best, score);
              if (best >= 0.985) return best;
            }
          }
        }
      }
    } catch (error) {
      console.warn('Containment visual scan failed:', error);
    }
  }

  // 5. 多路特征融合决策
  if (bestLocalFeatureScore >= 0.65 && best >= 0.60) {
    return Math.min(0.99, Math.max(bestLocalFeatureScore, best) + 0.08);
  }

  return Math.max(best, bestLocalFeatureScore);
}
