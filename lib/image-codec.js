'use strict';

const zlib = require('zlib');
const sharp = require('sharp');
const {
  extractStealthBits,
  embedStealthBits,
  canEmbedStealth,
} = require('./stealth');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COMMENT_LIMIT = 4 * 1024 * 1024;

function pngChunks(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return [];
  const result = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length > COMMENT_LIMIT || offset + 12 + length > buffer.length) break;
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    result.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return result;
}

function extractPngComment(buffer) {
  for (const chunk of pngChunks(buffer)) {
    try {
      if (chunk.type === 'tEXt') {
        const separator = chunk.data.indexOf(0);
        if (separator < 0) continue;
        if (chunk.data.toString('latin1', 0, separator) === 'Comment') {
          return chunk.data.toString('utf8', separator + 1);
        }
      } else if (chunk.type === 'zTXt') {
        const separator = chunk.data.indexOf(0);
        if (separator < 0 || chunk.data.toString('latin1', 0, separator) !== 'Comment') continue;
        if (chunk.data[separator + 1] !== 0) continue;
        const text = zlib.inflateSync(chunk.data.subarray(separator + 2), {
          maxOutputLength: COMMENT_LIMIT,
        });
        return text.toString('utf8');
      } else if (chunk.type === 'iTXt') {
        const keywordEnd = chunk.data.indexOf(0);
        if (keywordEnd < 0 || chunk.data.toString('latin1', 0, keywordEnd) !== 'Comment') continue;
        const compressed = chunk.data[keywordEnd + 1] === 1;
        if (chunk.data[keywordEnd + 2] !== 0) continue;
        const languageEnd = chunk.data.indexOf(0, keywordEnd + 3);
        const translatedEnd = languageEnd < 0 ? -1 : chunk.data.indexOf(0, languageEnd + 1);
        if (translatedEnd < 0) continue;
        const payload = chunk.data.subarray(translatedEnd + 1);
        const text = compressed
          ? zlib.inflateSync(payload, { maxOutputLength: COMMENT_LIMIT })
          : payload;
        return text.toString('utf8');
      }
    } catch {
      // 손상된 선택 chunk는 무시하고 다음 metadata 표현을 확인한다.
    }
  }
  return null;
}

function equalBits(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function encodeImageBuffer(source, options) {
  const format = options.format;
  const comment = options.carryMetadata ? extractPngComment(source) : null;
  let sourceBits = null;
  if (options.preserveStealth && format === 'webp') {
    const rawSource = await sharp(source, { failOn: 'none' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    sourceBits = extractStealthBits(
      rawSource.data,
      rawSource.info.width,
      rawSource.info.height,
      rawSource.info.channels,
    );
  }

  let pipeline = sharp(source, { failOn: 'none' });
  if (options.resize) {
    pipeline = pipeline.resize(options.resize.width, options.resize.height, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  let stealthPreserved = false;
  if (sourceBits) {
    const outputRaw = await pipeline
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (canEmbedStealth(sourceBits, outputRaw.info.width, outputRaw.info.height)) {
      embedStealthBits(
        outputRaw.data,
        outputRaw.info.width,
        outputRaw.info.height,
        outputRaw.info.channels,
        sourceBits,
      );
      pipeline = sharp(outputRaw.data, {
        raw: {
          width: outputRaw.info.width,
          height: outputRaw.info.height,
          channels: outputRaw.info.channels,
        },
      });
      stealthPreserved = true;
    }
  }

  if (format === 'avif') {
    pipeline = pipeline.avif({
      quality: options.quality ?? 65,
      effort: options.effort ?? 2,
    });
  } else if (options.lossless) {
    pipeline = pipeline.webp({ lossless: true });
  } else {
    pipeline = pipeline.webp({
      quality: options.quality ?? 80,
      lossless: false,
      alphaQuality: stealthPreserved ? 100 : undefined,
    });
  }
  if (comment) {
    pipeline = pipeline.withMetadata({
      exif: { IFD0: { ImageDescription: comment } },
    });
  }
  const output = await pipeline.toBuffer();
  const metadata = await sharp(output).metadata();
  if (metadata.format !== format) throw new Error(`encoded format mismatch: ${metadata.format}`);

  if (stealthPreserved && sourceBits) {
    const check = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const roundTrip = extractStealthBits(
      check.data,
      check.info.width,
      check.info.height,
      check.info.channels,
    );
    if (!equalBits(sourceBits, roundTrip)) {
      throw new Error('stealth metadata verification failed');
    }
  }
  return {
    buffer: output,
    commentPreserved: !!comment,
    stealthFound: !!sourceBits,
    stealthPreserved,
  };
}

module.exports = { encodeImageBuffer, extractPngComment };
