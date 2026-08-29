import { FaceIndexEntry, MediaItem } from '@/types/file';

const MODEL_ROOT = '/face-models';
const MATCH_DISTANCE = 0.56;

type FaceApiModule = typeof import('@vladmandic/face-api');

let modelPromise: Promise<FaceApiModule> | null = null;

async function loadFaceApi(): Promise<FaceApiModule> {
  if (!modelPromise) {
    modelPromise = import('@vladmandic/face-api').then(async (faceapi) => {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_ROOT),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_ROOT),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_ROOT),
      ]);
      return faceapi;
    }).catch((error) => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

async function loadImage(file: File): Promise<{ image: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('图片无法解码'));
      element.src = url;
    });
    return { image, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function cropAvatar(image: HTMLImageElement, box: { x: number; y: number; width: number; height: number }): string {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const side = Math.min(
    Math.max(box.width, box.height) * 1.52,
    image.naturalWidth,
    image.naturalHeight,
  );
  const sourceX = Math.max(0, Math.min(image.naturalWidth - side, centerX - side / 2));
  const sourceY = Math.max(0, Math.min(image.naturalHeight - side, centerY - side / 2));
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建头像画布');
  context.drawImage(image, sourceX, sourceY, side, side, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.84);
}

export async function detectFaces(file: File): Promise<FaceIndexEntry[]> {
  const faceapi = await loadFaceApi();
  const { image, release } = await loadImage(file);
  try {
    const detections = await faceapi
      .detectAllFaces(image, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.44 }))
      .withFaceLandmarks(true)
      .withFaceDescriptors();

    return detections.map((result, index) => {
      const box = result.detection.box;
      return {
        id: `face-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        descriptor: Array.from(result.descriptor),
        avatarUrl: cropAvatar(image, box),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        detectionScore: result.detection.score,
      };
    });
  } finally {
    release();
  }
}

export function descriptorDistance(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let squared = 0;
  for (let index = 0; index < left.length; index += 1) squared += (left[index] - right[index]) ** 2;
  return Math.sqrt(squared);
}

function descriptorFingerprint(descriptor: number[]): string {
  let hash = 2166136261;
  descriptor.slice(0, 48).forEach((value) => {
    const quantized = Math.round((value + 1) * 10_000);
    hash ^= quantized;
    hash = Math.imul(hash, 16777619);
  });
  return (hash >>> 0).toString(36);
}

function readPersonNumber(label?: string): number | null {
  const match = label?.match(/^人物\s+(\d+)$/);
  return match ? Number(match[1]) : null;
}

/**
 * 对当前素材库中的人脸做本地无身份聚类。已有 personId 会被优先保留，
 * 因此继续导入素材时，人物筛选入口不会无故变化。
 */
export function clusterPeople(files: MediaItem[]): MediaItem[] {
  const refs = files.flatMap((file, fileIndex) => (file.faces || []).map((face, faceIndex) => ({ fileIndex, faceIndex, face })));
  if (!refs.length) return files;

  const parent = refs.map((_, index) => index);
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (let left = 0; left < refs.length; left += 1) {
    for (let right = left + 1; right < refs.length; right += 1) {
      if (descriptorDistance(refs[left].face.descriptor, refs[right].face.descriptor) <= MATCH_DISTANCE) union(left, right);
    }
  }

  const groups = new Map<number, number[]>();
  refs.forEach((_, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), index]);
  });

  const usedNumbers = new Set(refs.map(({ face }) => readPersonNumber(face.personLabel)).filter((value): value is number => value !== null));
  let nextNumber = 1;
  const assignment = new Map<number, { personId: string; personLabel: string }>();

  groups.forEach((members) => {
    const existingIds = members.map((index) => refs[index].face.personId).filter((value): value is string => Boolean(value)).sort();
    const existingLabels = members.map((index) => refs[index].face.personLabel).filter((value): value is string => Boolean(value));
    while (usedNumbers.has(nextNumber)) nextNumber += 1;
    const personLabel = existingLabels[0] || `人物 ${nextNumber}`;
    if (!existingLabels.length) {
      usedNumbers.add(nextNumber);
      nextNumber += 1;
    }
    const representative = refs[members.reduce((best, index) => {
      const bestFace = refs[best].face;
      const candidate = refs[index].face;
      const bestQuality = bestFace.detectionScore * Math.sqrt(bestFace.box.width * bestFace.box.height);
      const candidateQuality = candidate.detectionScore * Math.sqrt(candidate.box.width * candidate.box.height);
      return candidateQuality > bestQuality ? index : best;
    }, members[0])].face;
    const personId = existingIds[0] || `person-${descriptorFingerprint(representative.descriptor)}`;
    members.forEach((index) => assignment.set(index, { personId, personLabel }));
  });

  let refIndex = 0;
  return files.map((file) => {
    if (!file.faces?.length) return file;
    const faces = file.faces.map((face) => {
      const person = assignment.get(refIndex);
      refIndex += 1;
      return person ? { ...face, ...person } : face;
    });
    const tags = file.tags.filter((tag) => tag !== '#人物');
    if (!tags.includes('#人物')) tags.push('#人物');
    return { ...file, faces, tags };
  });
}
