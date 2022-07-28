/**
 * Ported from https://www-igm.univ-mlv.fr/~lecroq/string/node26.html
 */

/**
 * Note: object will grow indefinitely! It is a good idea to free up the memory
 * using {@link resetStrArrCmpMemoryIfRequired}
 */
const stringToArbitraryInt: Map<string, i32> = new Map();
let arbitraryInt: i32 = 0;

export function resetStrArrCmpMemoryIfRequired(): void {
  if (stringToArbitraryInt.size > 100) stringToArbitraryInt.clear();
}

function getCmpValue(a: string): i32 {
  if (stringToArbitraryInt.has(a)) return stringToArbitraryInt.get(a);
  arbitraryInt += 1;
  stringToArbitraryInt.set(a, arbitraryInt);
  return arbitraryInt;
}

/**
 * @returns the arbitrary positional difference between two strings
 */
function strelecmp(str1: string, str2: string): i32 {
  const a = getCmpValue(str1);
  const b = getCmpValue(str2);
  if (a > b) return 1;
  if (a < b) return -1;
  // if (a == b)
  return 0;
}

class MaximalSuffixes {
  index: i32;
  period: i32;
}

/* Computing of the maximal suffix for <= */
function maxSufForward(x: string[], m: i32, p: i32): MaximalSuffixes {
  let ms: i32, j: i32, k: i32;
  let a: string, b: string;

  ms = -1;
  j = 0;
  k = p = 1;
  while (j + k < m) {
    a = x[j + k];
    b = x[ms + k];
    if (strelecmp(a, b) < 0) {
      j += k;
      k = 1;
      p = j - ms;
    } else if (strelecmp(a, b) === 0)
      if (k != p) ++k;
      else {
        j += p;
        k = 1;
      }
    else {
      /* a > b */
      ms = j;
      j = ms + 1;
      k = p = 1;
    }
  }
  return {
    index: ms,
    period: p,
  };
}

/* Computing of the maximal suffix for >= */
function maxSufReverse(x: string[], m: i32, p: i32): MaximalSuffixes {
  let ms: i32, j: i32, k: i32;
  let a: string, b: string;

  ms = -1;
  j = 0;
  k = p = 1;
  while (j + k < m) {
    a = x[j + k];
    b = x[ms + k];
    if (a > b) {
      j += k;
      k = 1;
      p = j - ms;
    } else if (a == b)
      if (k != p) ++k;
      else {
        j += p;
        k = 1;
      }
    else {
      /* a < b */
      ms = j;
      j = ms + 1;
      k = p = 1;
    }
  }
  return {
    index: ms,
    period: p,
  };
}

/* Two Way string matching algorithm. */
export function arrayIndexOf(
  source: string[],
  target: string[],
  position: i32 = 0
): i32 {
  resetStrArrCmpMemoryIfRequired();

  source = source.slice(Math.max(0, position) as i32);

  const m: i32 = target.length;
  const n: i32 = source.length;
  let forwardIndex: i32;
  let forwardPeriod: i32 = 0;
  let reverseIndex: i32;
  let reversePeriod: i32 = 0;
  let elementIndex: i32;
  let memory: i32;
  let period: i32;

  /* Preprocessing */
  const msf = maxSufForward(target, m, forwardPeriod);
  forwardIndex = msf.index;
  forwardPeriod = msf.index;
  const msr = maxSufReverse(target, m, reversePeriod);
  reverseIndex = msr.index;
  reversePeriod = msr.period;

  if (forwardIndex > reverseIndex) {
    elementIndex = forwardIndex;
    period = forwardPeriod;
  } else {
    elementIndex = reverseIndex;
    period = reversePeriod;
  }

  /* Searching */
  if (strArrDiffAt(target, target.slice(period), elementIndex + 1) == 0) {
    reverseIndex = 0;
    memory = -1;
    while (reverseIndex <= n - m) {
      forwardIndex = max(elementIndex, memory) + 1;
      while (
        forwardIndex < m &&
        target[forwardIndex] == source[forwardIndex + reverseIndex]
      )
        ++forwardIndex;
      if (forwardIndex >= m) {
        forwardIndex = elementIndex;
        while (
          forwardIndex > memory &&
          target[forwardIndex] == source[forwardIndex + reverseIndex]
        )
          --forwardIndex;
        if (forwardIndex <= memory) return reverseIndex;
        reverseIndex += period;
        memory = m - period - 1;
      } else {
        reverseIndex += forwardIndex - elementIndex;
        memory = -1;
      }
    }
  } else {
    period = max(elementIndex + 1, m - elementIndex - 1) + 1;
    reverseIndex = 0;
    while (reverseIndex <= n - m) {
      forwardIndex = elementIndex + 1;
      while (
        forwardIndex < m &&
        target[forwardIndex] == source[forwardIndex + reverseIndex]
      )
        ++forwardIndex;
      if (forwardIndex >= m) {
        forwardIndex = elementIndex;
        while (
          forwardIndex >= 0 &&
          target[forwardIndex] == source[forwardIndex + reverseIndex]
        )
          --forwardIndex;
        if (forwardIndex < 0) return reverseIndex;
        reverseIndex += period;
      } else reverseIndex += forwardIndex - elementIndex;
    }
  }
  return -1;
}

function strArrDiffAt(x: string[], y: string[], count: i32): i32 {
  for (let index: i32 = 0; index < count; index++) {
    const x1 = x[index];
    const y1 = y[index];
    if (x1 !== y1) return index + 1;
  }
  return 0;
}

function max(i: i32, j: i32): i32 {
  return i > j ? i : j;
}
