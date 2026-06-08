// 클라 ImageService.reencodeReferenceForApi(canvas)의 서버 sharp 등가물.
//
// 목적(클라와 동일): 캐릭터 레퍼런스 이미지를 NAI Precise Reference 스펙에 맞춰
// 3채널 RGB JPEG으로 재인코딩. alpha 픽셀이 투명한 경우 검정 배경으로 flatten
// (클라 canvas의 fillStyle 'black' + fillRect와 letterbox 색 일치).
//
// 클라 원본(frontend/src/models/ImageService.ts:438): canvas 검정 fill → drawImage →
// toDataURL('image/jpeg', 0.95). 여기선 sharp flatten(검정) + jpeg(quality 95)로 등가.
// 입력/출력 모두 raw base64 (data URI prefix 없음). 실패 시 원본 반환(클라 catch와 동일).

let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

async function reencodeReferenceForApi(base64) {
  if (!sharp) return base64; // sharp 미설치 — 클라의 ctx 없음 fallback과 동일 정신
  try {
    const buf = Buffer.from(base64, 'base64');
    const out = await sharp(buf)
      .flatten({ background: { r: 0, g: 0, b: 0 } }) // 투명부 검정 (letterbox)
      .jpeg({ quality: 95 })
      .toBuffer();
    return out.toString('base64');
  } catch (e) {
    return base64; // 클라 reencode catch fallback과 동일 (원본 유지)
  }
}

module.exports = { reencodeReferenceForApi };
