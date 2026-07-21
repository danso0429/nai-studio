'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const ExifReader = require('../frontend/node_modules/exifreader');
const { embedStealthBits, extractStealthBits } = require('../lib/stealth');
const { encodeImageBuffer, extractPngComment } = require('../lib/image-codec');

function bytesToBits(bytes) {
  const result = [];
  for (const byte of bytes) {
    for (let shift = 7; shift >= 0; shift--) result.push((byte >> shift) & 1);
  }
  return result;
}

function stealthPayload(payload) {
  const magic = bytesToBits(Buffer.from('stealth_pngcomp', 'ascii'));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.length * 8, false);
  return Uint8Array.from([...magic, ...bytesToBits(length), ...bytesToBits(payload)]);
}

function fakeTextPng(comment) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from(comment)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([signature, length, Buffer.from('tEXt'), data, Buffer.alloc(4)]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function insertTextChunk(png, comment) {
  const data = Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from(comment)]);
  const type = Buffer.from('tEXt');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const chunk = Buffer.concat([length, type, data, crc]);
  return Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]);
}

test('PNG Comment text is extracted without a server EXIF dependency', () => {
  assert.equal(extractPngComment(fakeTextPng('{"prompt":"hello"}')), '{"prompt":"hello"}');
});

test('lossy WebP round-trip keeps the exact NAI alpha stealth bitstream', async () => {
  const width = 64;
  const height = 64;
  const rgba = Buffer.alloc(width * height * 4, 255);
  const bits = stealthPayload(Buffer.from('fixture payload'));
  embedStealthBits(rgba, width, height, 4, bits);
  const plainPng = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const png = insertTextChunk(plainPng, '{"prompt":"combined metadata"}');
  const encoded = await encodeImageBuffer(png, {
    format: 'webp',
    quality: 72,
    carryMetadata: true,
    preserveStealth: true,
  });
  assert.equal(encoded.commentPreserved, true);
  assert.equal(encoded.stealthFound, true);
  assert.equal(encoded.stealthPreserved, true);
  const decoded = await sharp(encoded.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(
    Array.from(extractStealthBits(decoded.data, decoded.info.width, decoded.info.height, decoded.info.channels)),
    Array.from(bits),
  );
});

test('PNG Comment is carried into WebP EXIF ImageDescription', async () => {
  const plain = await sharp({
    create: { width: 16, height: 16, channels: 4, background: '#ffffffff' },
  }).png().toBuffer();
  const comment = '{"prompt":"metadata fixture","seed":42}';
  const png = insertTextChunk(plain, comment);
  const encoded = await encodeImageBuffer(png, {
    format: 'webp',
    quality: 80,
    carryMetadata: true,
  });
  assert.equal(encoded.commentPreserved, true);
  const tags = ExifReader.load(encoded.buffer);
  const value = tags.ImageDescription?.value;
  assert.equal(Array.isArray(value) ? value.join('') : value, comment);
});

test('resize that cannot fit stealth reports the limit and still returns a valid WebP', async () => {
  const width = 64;
  const height = 64;
  const rgba = Buffer.alloc(width * height * 4, 255);
  embedStealthBits(rgba, width, height, 4, stealthPayload(Buffer.alloc(128, 7)));
  const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const encoded = await encodeImageBuffer(png, {
    format: 'webp',
    quality: 80,
    preserveStealth: true,
    resize: { width: 8, height: 8 },
  });
  assert.equal(encoded.stealthFound, true);
  assert.equal(encoded.stealthPreserved, false);
  assert.equal((await sharp(encoded.buffer).metadata()).format, 'webp');
});
