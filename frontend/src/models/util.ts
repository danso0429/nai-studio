import ExifReader from 'exifreader';
import { CharacterPrompt, ImportableMetadata, SDAbstractJob, SDJob } from './types';

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 프로젝트 이름 충돌 메시지. basename은 전역 unique 정책(폴더 무관) — 다른 폴더에
// 있는 옛 프로젝트라 사용자가 인지 못 한 잔재일 때 "이미 존재"만 보면 위치 모름.
// folder=null이면 최상위, string이면 해당 폴더에 위치.
export function formatProjectNameConflict(folder: string | null): string {
  return folder == null
    ? '최상위에 이미 같은 이름의 프로젝트가 있어요'
    : `'${folder}' 폴더에 이미 같은 이름의 프로젝트가 있어요`;
}

// 한글 받침 유무에 따라 조사 형태 결정. 한글 외/빈 문자열은 받침 없음으로 처리.
export function hasFinalConsonant(word: string): boolean {
  if (!word) return false;
  const lastChar = word[word.length - 1];
  const code = lastChar.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return false;
  return (code - 0xAC00) % 28 !== 0;
}

// 받침에 맞춘 조사 헬퍼. 사용: `${name}${josaIGa(name)} 복원되었습니다`.
export function josaIGa(word: string): string { return hasFinalConsonant(word) ? '이' : '가'; }
export function josaEunNeun(word: string): string { return hasFinalConsonant(word) ? '은' : '는'; }
export function josaEulReul(word: string): string { return hasFinalConsonant(word) ? '을' : '를'; }
export function josaRo(word: string): string { return hasFinalConsonant(word) ? '으로' : '로'; }
export function josaWaGwa(word: string): string { return hasFinalConsonant(word) ? '과' : '와'; }

// Base path (e.g. '/nainai') with trailing slash stripped. Empty string when not reverse-proxied.
export const API_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

// Absolute URL for an /api endpoint. Use when full origin is needed.
// `path` should start with '/api/...' (or any path beginning with '/').
export function apiUrl(path: string): string {
  return location.protocol + '//' + location.host + API_BASE_PATH + path;
}

// Convert a thrown error into a user-friendly message. If it's a wrapped server
// API error (serverBackend.ts throws "API error N: <body>" with JSON body containing
// an `error` field), surface just the inner error string. 흔한 status/네트워크
// 케이스는 한국어 친절 메시지로 매핑 (401/429/timeout/fetch fail). 그 외엔
// 원본 또는 unwrap된 server 메시지를 그대로 반환. 매핑 후보가 더 늘어나면
// 본인 페인 보고에 맞춰 케이스 추가.
export function extractApiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  let inner = msg;
  const m = /^API error \d+: (.+)$/s.exec(msg);
  if (m) {
    inner = m[1];
    try {
      const body = JSON.parse(m[1]);
      if (body && typeof body.error === 'string') inner = body.error;
    } catch {}
  }
  if (/^API error 401\b/.test(msg) || /\bunauthor/i.test(inner)) {
    return '인증 실패 (401) — 로그인을 다시 시도해주세요.';
  }
  if (/^API error 429\b/.test(msg) || /rate limit/i.test(inner)) {
    return '요청 과다 (429) — 잠시 후 다시 시도해주세요.';
  }
  if (/^API timeout/.test(msg)) {
    return '서버 응답 시간 초과 — 네트워크를 확인해주세요.';
  }
  if (/failed to fetch|networkerror|network request/i.test(msg)) {
    return '네트워크 오류 — 인터넷 연결을 확인해주세요.';
  }
  return inner;
}

export async function getPlatform() {
  const platform = window.navigator.platform;
  if (platform.startsWith('Win')) return 'windows';
  const arch = await (navigator as any).userAgentData.getHighEntropyValues([
    'architecture',
  ]);
  if (arch.architecture === 'arm64') return 'mac-arm64';
  return 'mac-x64';
}

export async function getFirstFile(accept?: string) {
  return new Promise((resolve, reject) => {
    // Create a hidden file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    if (accept) input.accept = accept;

    // Listen for file selection
    input.addEventListener('change', (event: any) => {
      const file = event.target.files[0];
      if (file) {
        resolve(file);
      } else {
        reject(new Error('No file selected'));
      }
    });

    // Trigger the file input click
    document.body.appendChild(input);
    input.click();

    // Clean up the DOM
    document.body.removeChild(input);
  });
}

// 다중 파일 선택. iOS Safari/Files 앱에서 multiple 지원 (드래그드롭이 안 되는 환경 대체).
// 사용자 취소 시 reject. 0개 선택은 cancel과 구분 안 됨 — 둘 다 reject.
export async function getFiles(accept?: string): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    if (accept) input.accept = accept;

    input.addEventListener('change', (event: any) => {
      const files: File[] = Array.from(event.target.files || []);
      if (files.length > 0) resolve(files);
      else reject(new Error('No file selected'));
    });

    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  });
}

function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;

  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
}

export async function extractExifFromBase64(base64: string) {
  const arrayBuffer = base64ToArrayBuffer(base64);
  const exif = ExifReader.load(arrayBuffer);
  return exif;
}

const STEALTH_MAGIC = 'stealth_pngcomp';

// Models L: gzip bomb cap — 사용자 입력 PNG의 alpha LSB에 무한 압축비 페이로드 가능.
// 64MB 도달 시 abort. 정상 stealth-pngcomp metadata는 ~수 KB ~ 수십 KB.
const GZIP_DECOMPRESS_MAX = 64 * 1024 * 1024;
async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(data as BufferSource);
  writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalLength += value.length;
    if (totalLength > GZIP_DECOMPRESS_MAX) {
      throw new Error(`gzip decompressed size exceeds ${GZIP_DECOMPRESS_MAX} bytes (bomb)`);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function loadImageFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}

// Models L: 이미지 크기 cap — 4096² = 67MB pixel buffer는 모바일 Safari OOM 위험.
// 정상 NAI 이미지는 ~1024×1024 (4MB), 최대 사용자 케이스도 2048² (16MB)에서 끊음.
const EXTRACT_METADATA_MAX_PIXELS = 4096 * 4096;
export async function extractMetadataFromAlpha(
  base64: string,
): Promise<any | undefined> {
  try {
    const img = await loadImageFromBase64(base64);
    if (img.width * img.height > EXTRACT_METADATA_MAX_PIXELS) {
      console.warn(`[extractMetadataFromAlpha] image too large (${img.width}×${img.height}), skip`);
      return undefined;
    }
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    const pixels = imageData.data;
    const width = img.width;
    const height = img.height;

    // Extract LSBs from alpha channel in column-major order
    const totalPixels = width * height;
    const bits = new Uint8Array(totalPixels);
    let bitIdx = 0;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const idx = (y * width + x) * 4 + 3; // alpha channel
        bits[bitIdx++] = pixels[idx] & 1;
      }
    }

    // Pack bits into bytes (MSB first, same as np.packbits)
    const byteLen = Math.ceil(totalPixels / 8);
    const bytes = new Uint8Array(byteLen);
    for (let i = 0; i < totalPixels; i++) {
      if (bits[i]) {
        bytes[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
      }
    }

    // Check magic string
    const magicBytes = new TextEncoder().encode(STEALTH_MAGIC);
    for (let i = 0; i < magicBytes.length; i++) {
      if (bytes[i] !== magicBytes[i]) return undefined;
    }

    // Read 32-bit big-endian length (in bits)
    let offset = STEALTH_MAGIC.length;
    const lengthBits =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    offset += 4;
    const lengthBytes = Math.ceil(lengthBits / 8);

    // Extract and decompress gzip data
    const compressed = bytes.slice(offset, offset + lengthBytes);
    const decompressed = await decompressGzip(compressed);
    const jsonString = new TextDecoder().decode(decompressed);
    const metadata = JSON.parse(jsonString);

    // The Comment field may be a nested JSON string
    if (metadata['Comment'] && typeof metadata['Comment'] === 'string') {
      metadata['Comment'] = JSON.parse(metadata['Comment']);
    }

    return metadata;
  } catch (e) {
    return undefined;
  }
}

function parseCommentToJob(
  data: any,
): ImportableMetadata | undefined {
  if (!data || !data['prompt']) return undefined;
  try {
    // v4 캐릭터 프롬프트 추출 (실패 시 빈 배열로 폴백)
    let characterPrompts: CharacterPrompt[] = [];
    let useCoords = false;
    let legacyPromptConditioning = false;
    try {
      const charCaptions = data['v4_prompt']?.['caption']?.['char_captions'] || [];
      const charUCCaptions = data['v4_negative_prompt']?.['caption']?.['char_captions'] || [];
      for (let i = 0; i < charCaptions.length; i++) {
        characterPrompts.push({
          id: `${i}`,
          prompt: charCaptions[i]?.char_caption ?? '',
          position: charCaptions[i]?.centers?.[0],
          uc: charUCCaptions[i]?.char_caption ?? '',
        });
      }
      useCoords = data['v4_prompt']?.['use_coords'] ?? false;
      legacyPromptConditioning = data['v4_negative_prompt']?.['legacy_uc'] ?? false;
    } catch (e) {
      // v4 포맷 없음 — 폴백
    }

    // 바이브 트랜스퍼 데이터 추출
    const vibeImages: string[] = data['reference_image_multiple'] || [];
    const vibeStrengths: number[] = data['reference_strength_multiple'] || [];
    const vibeInfos: number[] = data['reference_information_extracted_multiple'] || [];
    const vibes = vibeStrengths.map((strength, i) => ({
      path: '',
      strength,
      info: vibeInfos[i] ?? 1,
    }));

    // 캐릭터 레퍼런스 데이터 추출
    const refImages: string[] = data['director_reference_images'] || [];
    const refStrengths: number[] = data['director_reference_strength_values'] || [];
    const refFidelities: number[] = (data['director_reference_secondary_strength_values'] || []).map(
      (v: number) => 1 - v,
    );
    const refInfos: number[] = data['director_reference_information_extracted'] || [];
    const refDescs: any[] = data['director_reference_descriptions'] || [];
    const characterReferences = refStrengths.map((strength, i) => ({
      path: '',
      strength,
      fidelity: refFidelities[i] ?? 1,
      info: refInfos[i] ?? 1,
      referenceType: (refDescs[i]?.caption?.base_caption || 'character') as 'character' | 'style' | 'character&style',
      enabled: true,
    }));

    // 해상도 추출
    const resolution = data['width'] && data['height']
      ? { width: data['width'], height: data['height'] }
      : undefined;

    return {
      prompt: data['prompt'],
      seed: data['seed'],
      promptGuidance: data['scale'],
      cfgRescale: data['cfg_rescale'],
      sampling: data['sampler'],
      noiseSchedule: data['noise_schedule'],
      steps: data['steps'],
      uc: data['uc'],
      vibes,
      normalizeStrength: data['normalize_reference_strength_multiple'] ?? true,
      varietyPlus: data['skip_cfg_above_sigma'] ? true : false,
      deliberateEulerAncestralBug: data['deliberate_euler_ancestral_bug'] ?? false,
      characterReferences,
      backend: { type: 'NAI' },
      useCoords,
      legacyPromptConditioning,
      characterPrompts,
      vibeImageData: vibeImages.length > 0 ? vibeImages : undefined,
      referenceImageData: refImages.length > 0 ? refImages : undefined,
      resolution,
    };
  } catch (e) {
    return undefined;
  }
}

export async function extractPromptDataFromBase64(
  base64: string,
): Promise<ImportableMetadata | undefined> {
  // 1차: EXIF Comment에서 추출 시도
  try {
    const exif = await extractExifFromBase64(base64);
    const comment = exif['Comment'];
    if (comment && comment.value) {
      const data = JSON.parse(comment.value as string);
      const result = parseCommentToJob(data);
      if (result) return result;
    }
  } catch (e) {
    // EXIF 추출 실패 — 스테가노그래피로 폴백
  }

  // 2차: 알파 채널 스테가노그래피에서 추출 시도
  try {
    const metadata = await extractMetadataFromAlpha(base64);
    if (metadata) {
      const commentData = metadata['Comment'] || metadata;
      const result = parseCommentToJob(commentData);
      if (result) return result;
    }
  } catch (e) {
    // 스테가노그래피 추출도 실패
  }

  return undefined;
}

export function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
