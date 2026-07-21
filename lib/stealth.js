'use strict';

const STEALTH_MAGICS = new Set(['stealth_pnginfo', 'stealth_pngcomp']);
const MAGIC_BITS = 15 * 8;
const LENGTH_BITS = 32;
const HEADER_BITS = MAGIC_BITS + LENGTH_BITS;

function alphaOffset(index, width, height, channels) {
  const x = Math.floor(index / height);
  const y = index - x * height;
  return (y * width + x) * channels + (channels - 1);
}

function extractStealthBits(rgba, width, height, channels) {
  const pixels = width * height;
  if (channels < 4 || pixels < HEADER_BITS) return null;
  const bitAt = (index) => rgba[alphaOffset(index, width, height, channels)] & 1;
  let magic = '';
  for (let charIndex = 0; charIndex < 15; charIndex++) {
    let code = 0;
    for (let bit = 0; bit < 8; bit++) {
      code = (code << 1) | bitAt(charIndex * 8 + bit);
    }
    magic += String.fromCharCode(code);
  }
  if (!STEALTH_MAGICS.has(magic)) return null;
  let payloadBits = 0;
  for (let bit = 0; bit < LENGTH_BITS; bit++) {
    payloadBits = payloadBits * 2 + bitAt(MAGIC_BITS + bit);
  }
  const total = HEADER_BITS + payloadBits;
  if (payloadBits <= 0 || total > pixels) return null;
  const result = new Uint8Array(total);
  for (let index = 0; index < total; index++) result[index] = bitAt(index);
  return result;
}

function embedStealthBits(rgba, width, height, channels, bits) {
  const pixels = width * height;
  if (channels < 4 || bits.length > pixels) {
    throw new Error('stealth payload does not fit output image');
  }
  for (let index = 0; index < pixels; index++) {
    const offset = alphaOffset(index, width, height, channels);
    rgba[offset] = index < bits.length ? 0xfe | bits[index] : 0xff;
  }
}

function canEmbedStealth(bits, width, height) {
  return width * height >= bits.length;
}

module.exports = {
  extractStealthBits,
  embedStealthBits,
  canEmbedStealth,
};
