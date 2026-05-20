export interface WordTag {
  normalized: string;
  word: string;
  redirect: string;
  freq: number;
  priority: number;
  category: number;
}

export const inf = 1e9 | 0;

export function normalize(word: string) {
  let result = '';
  let mapping = [];
  let complexMedials: any = {
    ㅘ: 'ㅗㅏ',
    ㅙ: 'ㅗㅐ',
    ㅚ: 'ㅗㅣ',
    ㅝ: 'ㅜㅓ',
    ㅞ: 'ㅜㅔ',
    ㅟ: 'ㅜㅣ',
    ㅢ: 'ㅡㅣ',
  };

  let initialJamos = [
    'ㄱ',
    'ㄲ',
    'ㄴ',
    'ㄷ',
    'ㄸ',
    'ㄹ',
    'ㅁ',
    'ㅂ',
    'ㅃ',
    'ㅅ',
    'ㅆ',
    'ㅇ',
    'ㅈ',
    'ㅉ',
    'ㅊ',
    'ㅋ',
    'ㅌ',
    'ㅍ',
    'ㅎ',
  ];
  let medialJamos = [
    'ㅏ',
    'ㅐ',
    'ㅑ',
    'ㅒ',
    'ㅓ',
    'ㅔ',
    'ㅕ',
    'ㅖ',
    'ㅗ',
    'ㅘ',
    'ㅙ',
    'ㅚ',
    'ㅛ',
    'ㅜ',
    'ㅝ',
    'ㅞ',
    'ㅟ',
    'ㅠ',
    'ㅡ',
    'ㅢ',
    'ㅣ',
  ];
  let finalJamos = [
    '',
    'ㄱ',
    'ㄲ',
    'ㄳ',
    'ㄴ',
    'ㄵ',
    'ㄶ',
    'ㄷ',
    'ㄹ',
    'ㄺ',
    'ㄻ',
    'ㄼ',
    'ㄽ',
    'ㄾ',
    'ㄿ',
    'ㅀ',
    'ㅁ',
    'ㅂ',
    'ㅄ',
    'ㅅ',
    'ㅆ',
    'ㅇ',
    'ㅈ',
    'ㅊ',
    'ㅋ',
    'ㅌ',
    'ㅍ',
    'ㅎ',
  ];

  for (let i = 0; i < word.length; i++) {
    let code = word.codePointAt(i)!;
    let originalIndex = i;

    if (code > 0xffff) {
      i++;
    }

    if (code >= 0x41 && code <= 0x5a) {
      result += String.fromCharCode(code + 0x20);
      mapping.push(originalIndex);
    } else if (
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39)
    ) {
      // 'a' to 'z' or '0' to '9'
      result += String.fromCharCode(code);
      mapping.push(originalIndex);
    } else if (code >= 0xac00 && code <= 0xd7a3) {
      let code_offset = code - 0xac00;
      let initial = Math.floor(code_offset / (21 * 28));
      let medial = Math.floor((code_offset % (21 * 28)) / 28);
      let final = code_offset % 28;

      result += initialJamos[initial];
      mapping.push(originalIndex);

      let medialJamo = medialJamos[medial];
      if (complexMedials[medialJamo]) {
        for (let char of complexMedials[medialJamo]) {
          result += char;
          mapping.push(originalIndex);
        }
      } else {
        result += medialJamo;
        mapping.push(originalIndex);
      }

      if (final !== 0) {
        result += finalJamos[final];
        mapping.push(originalIndex);
      }
    } else {
      result += String.fromCodePoint(code);
      mapping.push(originalIndex);
    }
  }

  return [result, mapping];
}

export function calcGapMatch(small: string, large: string) {
  const [smallN, smallMapping] = normalize(small);
  const [largeN, largeMapping] = normalize(large);
  const m = smallN.length;
  const n = largeN.length;
  // dp[i][j][k] → flat Int32Array (M+1)(N+1)2. 옛 nested Array.from은 keystroke마다
  // (m+1)(n+1) array 객체 + 2 tuple alloc → 50 candidate 누적 시 MB 단위 GC churn.
  // typed array는 1 buffer만 alloc, 인덱스 산술로 access. inf=1e9|0 sentinel.
  const stride0 = (n + 1) * 2;
  const idx = (i: number, j: number, k: number) => i * stride0 + j * 2 + k;
  const dpSize = (m + 1) * stride0;
  const dp = new Int32Array(dpSize).fill(inf);
  // backtrack[i][j][k] = [prevI, prevJ, prevK] → 3 ints 묶음. sentinel -1.
  const backtrack = new Int32Array(dpSize * 3).fill(-1);
  const bIdx = (i: number, j: number, k: number) => idx(i, j, k) * 3;

  dp[idx(0, 0, 0)] = 0;

  for (let i = 0; i <= m; i++) {
    for (let j = 0; j < n; j++) {
      if (i < m && smallN[i] === largeN[j]) {
        if (dp[idx(i, j, 0)] + 1 < dp[idx(i + 1, j + 1, 1)]) {
          dp[idx(i + 1, j + 1, 1)] = dp[idx(i, j, 0)] + 1;
          const bi = bIdx(i + 1, j + 1, 1);
          backtrack[bi] = i; backtrack[bi + 1] = j; backtrack[bi + 2] = 0;
        }
        if (dp[idx(i, j, 1)] < dp[idx(i + 1, j + 1, 1)]) {
          dp[idx(i + 1, j + 1, 1)] = dp[idx(i, j, 1)];
          const bi = bIdx(i + 1, j + 1, 1);
          backtrack[bi] = i; backtrack[bi + 1] = j; backtrack[bi + 2] = 1;
        }
      }
      if (dp[idx(i, j, 0)] < dp[idx(i, j + 1, 0)]) {
        dp[idx(i, j + 1, 0)] = dp[idx(i, j, 0)];
        const bi = bIdx(i, j + 1, 0);
        backtrack[bi] = i; backtrack[bi + 1] = j; backtrack[bi + 2] = 0;
      }
      if (dp[idx(i, j, 1)] < dp[idx(i, j + 1, 0)]) {
        dp[idx(i, j + 1, 0)] = dp[idx(i, j, 1)];
        const bi = bIdx(i, j + 1, 0);
        backtrack[bi] = i; backtrack[bi + 1] = j; backtrack[bi + 2] = 1;
      }
    }
  }

  const result = Math.min(dp[idx(m, n, 0)], dp[idx(m, n, 1)]);
  if (result === inf) {
    return { result, path: [] };
  }
  const path: any[] = [];
  let i = m;
  let j = n;
  let k = dp[idx(m, n, 0)] < dp[idx(m, n, 1)] ? 0 : 1;

  while (i !== 0 || j !== 0) {
    const bi = bIdx(i, j, k);
    const prevI = backtrack[bi];
    const prevJ = backtrack[bi + 1];
    const prevK = backtrack[bi + 2];
    if (i - 1 === prevI && j - 1 === prevJ) {
      path.push(largeMapping[j - 1]);
    }
    i = prevI;
    j = prevJ;
    k = prevK;
  }

  path.reverse();
  return { result, path };
}
