/**
 * This library modifies the diff-patch-match library by Neil Fraser
 * by removing the patch and match functionality and certain advanced
 * options in the diff function. The original license is as follows:
 *
 * ===
 *
 * Diff Match and Patch
 *
 * Copyright 2006 Google Inc.
 * http://code.google.com/p/google-diff-match-patch/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { arrayIndexOf } from "./str-array-cmp";

/**
 * The data structure representing a diff is an array of tuples:
 * [[DIFF_DELETE, 'Hello'], [DIFF_INSERT, 'Goodbye'], [DIFF_EQUAL, ' world.']]
 * which means: delete 'Hello', add 'Goodbye' and keep ' world.'
 */
const DIFF_DELETE = -1;
const DIFF_INSERT = 1;
const DIFF_EQUAL = 0;

class CursorPosRange {
  index: i32;
  length: i32;
}

class CursorPos {
  oldRange: CursorPosRange;
  newRange: CursorPosRange;
}

class DiffObject {
  type: i32;
  text: string[];
}

/**
 * Find the differences between two texts.  Simplifies the problem by stripping
 * any common prefix or suffix off the texts before diffing.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {Int|Object} [cursor_pos] Edit position in text1 or object with more info
 * @return {Array} Array of diff tuples.
 */
function diff_main(
  text1: string[],
  text2: string[],
  cursor_pos: i32 = -1,
  cursor_pos_obj: CursorPos | null = null
): DiffObject[] {
  const diffArr: DiffObject[] = [];
  // Check for equality
  if (strArrayEqual(text1, text2)) {
    if (text1) {
      diffArr.push({
        type: DIFF_EQUAL,
        text: text1,
      });
    }
    return diffArr;
  }

  // optimisation: just generalize diff
  // when the array length is just less than 6
  if (text1.length < 6 || text2.length < 6) {
    diffArr.push({ type: DIFF_DELETE, text: text1 });
    diffArr.push({ type: DIFF_INSERT, text: text2 });
    return diffArr;
  }

  if (cursor_pos > -1 || cursor_pos_obj != null) {
    const editdiff = find_cursor_edit_diff(
      text1,
      text2,
      cursor_pos,
      cursor_pos_obj
    );
    if (editdiff) {
      return editdiff;
    }
  }

  // Trim off common prefix (speedup).
  let commonlength = diff_commonPrefix(text1, text2);
  const commonprefix = text1.slice(0, commonlength);
  text1 = text1.slice(commonlength);
  text2 = text2.slice(commonlength);

  // Trim off common suffix (speedup).
  commonlength = diff_commonSuffix(text1, text2);
  const commonsuffix = text1.slice(text1.length - commonlength);
  text1 = text1.slice(0, text1.length - commonlength);
  text2 = text2.slice(0, text2.length - commonlength);

  // Compute the diff on the middle block.
  const diffs = diff_compute_(text1, text2);

  // Restore the prefix and suffix.
  if (commonprefix) {
    diffs.unshift({
      type: DIFF_EQUAL,
      text: commonprefix,
    });
  }
  if (commonsuffix) {
    diffs.push({
      type: DIFF_EQUAL,
      text: commonsuffix,
    });
  }
  diff_cleanupMerge(diffs);
  return remove_empty_tuples(diffs);
}

/**
 * Find the differences between two texts.  Assumes that the texts do not
 * have any common prefix or suffix.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @return {Array} Array of diff tuples.
 */
function diff_compute_(text1: string[], text2: string[]): DiffObject[] {
  let diffs: DiffObject[] = [];

  if (!text1.length) {
    // Just add some text (speedup).
    diffs.push({
      type: DIFF_INSERT,
      text: text2,
    });
    return diffs;
  }

  if (!text2.length) {
    // Just delete some text (speedup).
    diffs.push({
      type: DIFF_DELETE,
      text: text1,
    });
    return diffs;
  }

  const longtext = text1.length > text2.length ? text1 : text2;
  const shorttext = text1.length > text2.length ? text2 : text1;
  // assume longtext and shorttext is space separated
  const i = arrayIndexOf(longtext, shorttext);
  if (i !== -1) {
    // Shorter text is inside the longer text (speedup).
    diffs.push({ type: DIFF_INSERT, text: longtext.slice(0, i) });
    diffs.push({ type: DIFF_EQUAL, text: shorttext });
    diffs.push({
      type: DIFF_INSERT,
      text: longtext.slice(i + shorttext.length),
    });
    // Swap insertions for deletions if diff is reversed.
    if (text1.length > text2.length) {
      diffs[0].type = diffs[2].type = DIFF_DELETE;
    }
    return diffs;
  }

  if (shorttext.length === 1) {
    // Single character string.
    // After the previous speedup, the character can't be an equality.
    diffs.push({
      type: DIFF_DELETE,
      text: text1,
    });
    diffs.push({
      type: DIFF_INSERT,
      text: text2,
    });
    return diffs;
  }

  // Check to see if the problem can be split in two.
  const hm = diff_halfMatch_(text1, text2);
  if (hm) {
    // A half-match was found, sort out the return data.
    const text1_a = hm[0];
    const text1_b = hm[1];
    const text2_a = hm[2];
    const text2_b = hm[3];
    const mid_common = hm[4];
    // Send both pairs off for separate processing.
    const diffs_a = diff_main(text1_a, text2_a);
    const diffs_b = diff_main(text1_b, text2_b);
    // Merge the results.
    return diffs_a
      .concat([
        {
          type: DIFF_EQUAL,
          text: mid_common,
        },
      ])
      .concat(diffs_b);
  }

  return diff_bisect_(text1, text2);
}

/**
 * Find the 'middle snake' of a diff, split the problem in two
 * and return the recursively constructed diff.
 * See Myers 1986 paper: An O(ND) Difference Algorithm and Its Variations.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @return {Array} Array of diff tuples.
 * @private
 */
function diff_bisect_(text1: string[], text2: string[]): DiffObject[] {
  // Cache the text lengths to prevent multiple calls.
  const text1_length = text1.length;
  const text2_length = text2.length;
  const max_d: i32 = Math.ceil((text1_length + text2_length) / 2) as i32;
  const v_offset: i32 = max_d;
  const v_length: i32 = 2 * max_d;
  const v1 = new Array<i32>(v_length);
  const v2 = new Array<i32>(v_length);
  // Setting all elements to -1 is faster in Chrome & Firefox than mixing
  // integers and undefined.
  for (let x: i32 = 0; x < v_length; x++) {
    v1[x] = -1;
    v2[x] = -1;
  }
  v1[v_offset + 1] = 0;
  v2[v_offset + 1] = 0;
  const delta = text1_length - text2_length;
  // If the total i32 of characters is odd, then the front path will collide
  // with the reverse path.
  const front = delta % 2 !== 0;
  // Offsets for start and end of k loop.
  // Prevents mapping of space beyond the grid.
  let k1start: i32 = 0;
  let k1end: i32 = 0;
  let k2start: i32 = 0;
  let k2end: i32 = 0;
  for (let d: i32 = 0; d < max_d; d++) {
    // Walk the front path one step.
    for (let k1: i32 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1_offset = v_offset + k1;
      let x1: i32;
      if (k1 === -d || (k1 !== d && v1[k1_offset - 1] < v1[k1_offset + 1])) {
        x1 = v1[k1_offset + 1];
      } else {
        x1 = v1[k1_offset - 1] + 1;
      }
      let y1 = x1 - k1;
      while (
        x1 < text1_length &&
        y1 < text2_length &&
        text1[x1] === text2[y1]
      ) {
        x1++;
        y1++;
      }
      v1[k1_offset] = x1;
      if (x1 > text1_length) {
        // Ran off the right of the graph.
        k1end += 2;
      } else if (y1 > text2_length) {
        // Ran off the bottom of the graph.
        k1start += 2;
      } else if (front) {
        const k2_offset = v_offset + delta - k1;
        if (k2_offset >= 0 && k2_offset < v_length && v2[k2_offset] !== -1) {
          // Mirror x2 onto top-left coordinate system.
          const x2 = text1_length - v2[k2_offset];
          if (x1 >= x2) {
            // Overlap detected.
            return diff_bisectSplit_(text1, text2, x1, y1);
          }
        }
      }
    }

    // Walk the reverse path one step.
    for (let k2: i32 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2_offset = v_offset + k2;
      let x2: i32;
      if (k2 === -d || (k2 !== d && v2[k2_offset - 1] < v2[k2_offset + 1])) {
        x2 = v2[k2_offset + 1];
      } else {
        x2 = v2[k2_offset - 1] + 1;
      }
      let y2 = x2 - k2;
      while (
        x2 < text1_length &&
        y2 < text2_length &&
        text1[text1_length - x2 - 1] === text2[text2_length - y2 - 1]
      ) {
        x2++;
        y2++;
      }
      v2[k2_offset] = x2;
      if (x2 > text1_length) {
        // Ran off the left of the graph.
        k2end += 2;
      } else if (y2 > text2_length) {
        // Ran off the top of the graph.
        k2start += 2;
      } else if (!front) {
        const k1_offset = v_offset + delta - k2;
        if (k1_offset >= 0 && k1_offset < v_length && v1[k1_offset] !== -1) {
          const x1: i32 = v1[k1_offset];
          const y1 = v_offset + x1 - k1_offset;
          // Mirror x2 onto top-left coordinate system.
          x2 = text1_length - x2;
          if (x1 >= x2) {
            // Overlap detected.
            return diff_bisectSplit_(text1, text2, x1, y1);
          }
        }
      }
    }
  }
  // Diff took too long and hit the deadline or
  // i32 of diffs equals i32 of characters, no commonality at all.
  const d: DiffObject[] = [];
  d.push({ type: DIFF_DELETE, text: text1 });
  d.push({ type: DIFF_INSERT, text: text2 });
  return d;
}

/**
 * Given the location of the 'middle snake', split the diff in two parts
 * and recurse.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {i32} x Index of split point in text1.
 * @param {i32} y Index of split point in text2.
 * @return {Array} Array of diff tuples.
 */
function diff_bisectSplit_(
  text1: string[],
  text2: string[],
  x: i32,
  y: i32
): DiffObject[] {
  const text1a = text1.slice(0, x);
  const text2a = text2.slice(0, y);
  const text1b = text1.slice(x);
  const text2b = text2.slice(y);

  // Compute both diffs serially.
  const diffs = diff_main(text1a, text2a);
  const diffsb = diff_main(text1b, text2b);

  return diffs.concat(diffsb);
}

function strArrayEqual(arr1: string[], arr2: string[]): boolean {
  if (arr1.length !== arr2.length) return false;
  for (let index: i32 = 0; index < arr1.length; index++) {
    const s1 = arr1[index];
    const s2 = arr2[index];
    if (s1 !== s2) return false;
  }
  return true;
}

/**
 * Determine the common prefix of two strings.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {i32} The i32 of characters common to the start of each string.
 */
export function diff_commonPrefix(text1: string[], text2: string[]): i32 {
  // Quick check for common null cases.
  if (!text1.length || !text2.length) {
    return 0;
  }
  // Binary search.
  // Performance analysis: http://neil.fraser.name/news/2007/10/09/
  let pointermin: i32 = 0;
  let pointermax: i32 = Math.min(text1.length, text2.length) as i32;
  let pointermid: i32 = pointermax;
  let pointerstart: i32 = 0;
  while (pointermin < pointermid) {
    if (
      strArrayEqual(
        text1.slice(pointerstart, pointermid),
        text2.slice(pointerstart, pointermid)
      )
    ) {
      pointermin = pointermid;
      pointerstart = pointermin;
    } else {
      pointermax = pointermid;
    }
    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin) as i32;
  }

  // if (is_surrogate_pair_start(text1.charCodeAt(pointermid - 1))) {
  //   pointermid--;
  // }

  return pointermid;
}

/**
 * Determine the common suffix of two strings.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {i32} The i32 of characters common to the end of each string.
 */
function diff_commonSuffix(text1: string[], text2: string[]): i32 {
  // Quick check for common null cases.
  if (
    !text1.length ||
    !text2.length ||
    text1.slice(-1)[0] !== text2.slice(-1)[0]
  ) {
    return 0;
  }
  // Binary search.
  // Performance analysis: http://neil.fraser.name/news/2007/10/09/
  let pointermin: i32 = 0;
  let pointermax: i32 = Math.min(text1.length, text2.length) as i32;
  let pointermid: i32 = pointermax;
  let pointerend: i32 = 0;
  while (pointermin < pointermid) {
    if (
      strArrayEqual(
        text1.slice(text1.length - pointermid, text1.length - pointerend),
        text2.slice(text2.length - pointermid, text2.length - pointerend)
      )
    ) {
      pointermin = pointermid;
      pointerend = pointermin;
    } else {
      pointermax = pointermid;
    }
    pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin) as i32;
  }

  // if (is_surrogate_pair_end(text1.charCodeAt(text1.length - pointermid))) {
  //   pointermid--;
  // }

  return pointermid;
}

/**
 * Do the two texts share a substring which is at least half the length of the
 * longer text?
 * This speedup can produce non-minimal diffs.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {Array.<string>} Five element Array, containing the prefix of
 *     text1, the suffix of text1, the prefix of text2, the suffix of
 *     text2 and the common middle.  Or null if there was no match.
 */
function diff_halfMatch_(text1: string[], text2: string[]): string[][] | null {
  const longtext = text1.length > text2.length ? text1 : text2;
  const shorttext = text1.length > text2.length ? text2 : text1;
  if (longtext.length < 4 || shorttext.length * 2 < longtext.length) {
    return null; // Pointless.
  }

  /**
   * Does a substring of shorttext exist within longtext such that the substring
   * is at least half the length of longtext?
   * Closure, but does not reference any external variables.
   * @param {string} longtext Longer string.
   * @param {string} shorttext Shorter string.
   * @param {i32} i Start index of quarter length substring within longtext.
   * @return {Array.<string>} Five element Array, containing the prefix of
   *     longtext, the suffix of longtext, the prefix of shorttext, the suffix
   *     of shorttext and the common middle.  Or null if there was no match.
   * @private
   */
  function diff_halfMatchI_(
    longtext: string[],
    shorttext: string[],
    i: i32
  ): string[][] | null {
    // Start with a 1/4 length substring at position i as a seed.
    const seed = longtext.slice(
      i,
      i + (Math.floor(longtext.length / 4) as i32)
    );
    let j = -1;
    let best_common: string[] = [];
    let best_longtext_a: string[] = [];
    let best_longtext_b: string[] = [];
    let best_shorttext_a: string[] = [];
    let best_shorttext_b: string[] = [];
    while ((j = arrayIndexOf(shorttext, seed, j + 1)) !== -1) {
      const prefixLength = diff_commonPrefix(
        longtext.slice(i),
        shorttext.slice(j)
      );
      const suffixLength = diff_commonSuffix(
        longtext.slice(0, i),
        shorttext.slice(0, j)
      );
      if (best_common.length < suffixLength + prefixLength) {
        best_common = shorttext
          .slice(j - suffixLength, j)
          .concat(shorttext.slice(j, j + prefixLength));
        best_longtext_a = longtext.slice(0, i - suffixLength);
        best_longtext_b = longtext.slice(i + prefixLength);
        best_shorttext_a = shorttext.slice(0, j - suffixLength);
        best_shorttext_b = shorttext.slice(j + prefixLength);
      }
    }
    if (best_common.length * 2 >= longtext.length) {
      return [
        best_longtext_a,
        best_longtext_b,
        best_shorttext_a,
        best_shorttext_b,
        best_common,
      ];
    } else {
      return null;
    }
  }

  // First check if the second quarter is the seed for a half-match.
  const hm1 = diff_halfMatchI_(
    longtext,
    shorttext,
    Math.ceil(longtext.length / 4) as i32
  );
  // Check again based on the third quarter.
  const hm2 = diff_halfMatchI_(
    longtext,
    shorttext,
    Math.ceil(longtext.length / 2) as i32
  );
  let hm: string[][] | null = null;
  if (!hm1 && !hm2) {
    return null;
  } else if (!hm2) {
    hm = hm1;
  } else if (!hm1) {
    hm = hm2;
  } else {
    // Both matched.  Select the longest.
    hm = hm1[4].length > hm2[4].length ? hm1 : hm2;
  }

  // should not be null here, but panic return
  if (!hm) {
    return null;
  }

  // A half-match was found, sort out the return data.
  let text1_a: string[];
  let text1_b: string[];
  let text2_a: string[];
  let text2_b: string[];
  if (text1.length > text2.length) {
    text1_a = hm[0];
    text1_b = hm[1];
    text2_a = hm[2];
    text2_b = hm[3];
  } else {
    text2_a = hm[0];
    text2_b = hm[1];
    text1_a = hm[2];
    text1_b = hm[3];
  }
  const mid_common = hm[4];
  return [text1_a, text1_b, text2_a, text2_b, mid_common];
}

/**
 * Reorder and merge like edit sections.  Merge equalities.
 * Any edit section can move as long as it doesn't cross an equality.
 * @param {Array} diffs Array of diff tuples.
 */
function diff_cleanupMerge(diffs: DiffObject[]): void {
  diffs.push({
    type: DIFF_EQUAL,
    text: [],
  }); // Add a dummy entry at the end.
  let pointer: i32 = 0;
  let count_delete: i32 = 0;
  let count_insert: i32 = 0;
  let text_delete: string[] = [];
  let text_insert: string[] = [];
  let commonlength: i32;
  while (pointer < diffs.length) {
    if (pointer < diffs.length - 1 && !diffs[pointer].text.length) {
      diffs.splice(pointer, 1);
      continue;
    }
    switch (diffs[pointer].type) {
      case DIFF_INSERT:
        count_insert++;
        text_insert = text_insert.concat(diffs[pointer].text);
        pointer++;
        break;
      case DIFF_DELETE:
        count_delete++;
        text_delete = text_delete.concat(diffs[pointer].text);
        pointer++;
        break;
      case DIFF_EQUAL:
        const previous_equality = pointer - count_insert - count_delete - 1;
        if (pointer < diffs.length - 1 && !diffs[pointer].text.length) {
          // for empty equality not at end, wait for next equality
          diffs.splice(pointer, 1);
          break;
        }
        if (text_delete.length > 0 || text_insert.length > 0) {
          // note that diff_commonPrefix and diff_commonSuffix are unicode-aware
          if (text_delete.length > 0 && text_insert.length > 0) {
            // Factor out any common prefixes.
            commonlength = diff_commonPrefix(text_insert, text_delete);
            if (commonlength !== 0) {
              if (previous_equality >= 0) {
                diffs[previous_equality].text = diffs[
                  previous_equality
                ].text.concat(text_insert.slice(0, commonlength));
              } else {
                diffs.unshift({
                  type: DIFF_EQUAL,
                  text: text_insert.slice(0, commonlength),
                });
                pointer++;
              }
              text_insert = text_insert.slice(commonlength);
              text_delete = text_delete.slice(commonlength);
            }
            // Factor out any common suffixes.
            commonlength = diff_commonSuffix(text_insert, text_delete);
            if (commonlength !== 0) {
              diffs[pointer].text = text_insert
                .slice(text_insert.length - commonlength)
                .concat(diffs[pointer].text);
              text_insert = text_insert.slice(
                0,
                text_insert.length - commonlength
              );
              text_delete = text_delete.slice(
                0,
                text_delete.length - commonlength
              );
            }
          }
          // Delete the offending records and add the merged ones.
          const n = count_insert + count_delete;
          if (text_delete.length === 0 && text_insert.length === 0) {
            diffs.splice(pointer - n, n);
            pointer = pointer - n;
          } else if (text_delete.length === 0) {
            // ORIGINAL:
            // diffs.splice(pointer - n, n, [DIFF_INSERT, text_insert]);
            diffs = diffs
              .slice(0, pointer - n)
              .concat([
                {
                  type: DIFF_INSERT,
                  text: text_insert,
                },
              ])
              .concat(diffs.slice(pointer));
            pointer = pointer - n + 1;
          } else if (text_insert.length === 0) {
            // ORIGINAL:
            // diffs.splice(pointer - n, n, [DIFF_DELETE, text_delete]);
            diffs = diffs
              .slice(0, pointer - n)
              .concat([{ type: DIFF_DELETE, text: text_delete }])
              .concat(diffs.slice(pointer));
            pointer = pointer - n + 1;
          } else {
            // ORIGINAL:
            // diffs.splice(
            //   pointer - n,
            //   n,
            //   [DIFF_DELETE, text_delete],
            //   [DIFF_INSERT, text_insert]
            // );
            diffs = diffs
              .slice(0, pointer)
              .concat([
                { type: DIFF_DELETE, text: text_delete },
                { type: DIFF_INSERT, text: text_insert },
              ])
              .concat(diffs.slice(pointer));
            pointer = pointer - n + 2;
          }
        }
        if (pointer !== 0 && diffs[pointer - 1].type === DIFF_EQUAL) {
          // Merge this equality with the previous one.
          diffs[pointer - 1].text = diffs[pointer - 1].text.concat(
            diffs[pointer].text
          );
          diffs.splice(pointer, 1);
        } else {
          pointer++;
        }
        count_insert = 0;
        count_delete = 0;
        text_delete = [];
        text_insert = [];
        break;
    }
  }
  if (diffs[diffs.length - 1].text.length === 0) {
    diffs.pop(); // Remove the dummy entry at the end.
  }

  // Second pass: look for single edits surrounded on both sides by equalities
  // which can be shifted sideways to eliminate an equality.
  // e.g: A<ins>BA</ins>C -> <ins>AB</ins>AC
  let changes = false;
  pointer = 1;
  // Intentionally ignore the first and last element (don't need checking).
  while (pointer < diffs.length - 1) {
    if (
      diffs[pointer - 1].type === DIFF_EQUAL &&
      diffs[pointer + 1].type === DIFF_EQUAL
    ) {
      // This is a single edit surrounded by equalities.
      if (
        strArrayEqual(
          diffs[pointer].text.slice(
            diffs[pointer].text.length - diffs[pointer - 1].text.length
          ),
          diffs[pointer - 1].text
        )
      ) {
        // Shift the edit over the previous equality.
        diffs[pointer].text = diffs[pointer - 1].text.concat(
          diffs[pointer].text.slice(
            0,
            diffs[pointer].text.length - diffs[pointer - 1].text.length
          )
        );
        diffs[pointer + 1].text = diffs[pointer - 1].text.concat(
          diffs[pointer + 1].text
        );
        diffs.splice(pointer - 1, 1);
        changes = true;
      } else if (
        strArrayEqual(
          diffs[pointer].text.slice(0, diffs[pointer + 1].text.length),
          diffs[pointer + 1].text
        )
      ) {
        // Shift the edit over the next equality.
        diffs[pointer - 1].text = diffs[pointer - 1].text.concat(
          diffs[pointer + 1].text
        );
        diffs[pointer].text = diffs[pointer].text
          .slice(diffs[pointer + 1].text.length)
          .concat(diffs[pointer + 1].text);
        diffs.splice(pointer + 1, 1);
        changes = true;
      }
    }
    pointer++;
  }
  // If shifts were made, the diff needs reordering and another shift sweep.
  if (changes) {
    diff_cleanupMerge(diffs);
  }
}

function remove_empty_tuples(tuples: DiffObject[]): DiffObject[] {
  const ret: DiffObject[] = [];
  for (let i: i32 = 0; i < tuples.length; i++) {
    if (tuples[i].text.length > 0) {
      ret.push(tuples[i]);
    }
  }
  return ret;
}

function make_edit_splice(
  before: string[],
  oldMiddle: string[],
  newMiddle: string[],
  after: string[]
): DiffObject[] {
  // if (ends_with_pair_start(before) || starts_with_pair_end(after)) {
  //   return null;
  // }
  return remove_empty_tuples([
    { type: DIFF_EQUAL, text: before },
    { type: DIFF_DELETE, text: oldMiddle },
    { type: DIFF_INSERT, text: newMiddle },
    { type: DIFF_EQUAL, text: after },
  ]);
}

function find_cursor_edit_diff(
  oldText: string[],
  newText: string[],
  cursor_pos: i32 = -1,
  cursor_pos_obj: CursorPos | null = null
): DiffObject[] | null {
  if (cursor_pos < 0 && cursor_pos_obj === null)
    throw new Error("Cursor position is required!");
  // note: this runs after equality check has ruled out exact equality
  const oldRange: CursorPosRange | null =
    cursor_pos > -1
      ? { index: cursor_pos, length: 0 }
      : cursor_pos_obj !== null
      ? cursor_pos_obj.oldRange
      : null;
  const newRange: CursorPosRange | null =
    cursor_pos > -1
      ? null
      : cursor_pos_obj !== null
      ? cursor_pos_obj.newRange
      : null;

  if (oldRange === null || newRange === null)
    throw new Error("Programming error: oldRange or newRange is null!");

  // take into account the old and new selection to generate the best diff
  // possible for a text edit.  for example, a text change from "xxx" to "xx"
  // could be a delete or forwards-delete of any one of the x's, or the
  // result of selecting two of the x's and typing "x".
  const oldLength = oldText.length;
  const newLength = newText.length;
  if (oldRange.length === 0 && (newRange === null || newRange.length === 0)) {
    // see if we have an insert or delete before or after cursor
    const oldCursor = oldRange.index;
    const oldBefore = oldText.slice(0, oldCursor);
    const oldAfter = oldText.slice(oldCursor);
    const maybeNewCursor: i32 = newRange ? newRange.index : -1;
    while (true) {
      // is this an insert or delete right before oldCursor?
      const newCursor = oldCursor + newLength - oldLength;
      if (maybeNewCursor > -1 && maybeNewCursor !== newCursor) {
        break;
      }
      if (newCursor < 0 || newCursor > newLength) {
        break;
      }
      const newBefore = newText.slice(0, newCursor);
      const newAfter = newText.slice(newCursor);
      if (newAfter !== oldAfter) {
        break;
      }
      const prefixLength: i32 = Math.min(oldCursor, newCursor) as i32;
      const oldPrefix = oldBefore.slice(0, prefixLength);
      const newPrefix = newBefore.slice(0, prefixLength);
      if (oldPrefix !== newPrefix) {
        break;
      }
      const oldMiddle = oldBefore.slice(prefixLength);
      const newMiddle = newBefore.slice(prefixLength);
      return make_edit_splice(oldPrefix, oldMiddle, newMiddle, oldAfter);
    }
    while (true) {
      // is this an insert or delete right after oldCursor?
      if (maybeNewCursor > -1 && maybeNewCursor !== oldCursor) {
        break;
      }
      const cursor = oldCursor;
      const newBefore = newText.slice(0, cursor);
      const newAfter = newText.slice(cursor);
      if (newBefore !== oldBefore) {
        break;
      }
      const suffixLength: i32 = Math.min(
        oldLength - cursor,
        newLength - cursor
      ) as i32;
      const oldSuffix = oldAfter.slice(oldAfter.length - suffixLength);
      const newSuffix = newAfter.slice(newAfter.length - suffixLength);
      if (oldSuffix !== newSuffix) {
        break;
      }
      const oldMiddle = oldAfter.slice(0, oldAfter.length - suffixLength);
      const newMiddle = newAfter.slice(0, newAfter.length - suffixLength);
      return make_edit_splice(oldBefore, oldMiddle, newMiddle, oldSuffix);
    }
  }
  if (oldRange.length > 0 && newRange && newRange.length === 0) {
    while (true) {
      // see if diff could be a splice of the old selection range
      const oldPrefix = oldText.slice(0, oldRange.index);
      const oldSuffix = oldText.slice(oldRange.index + oldRange.length);
      const prefixLength = oldPrefix.length;
      const suffixLength = oldSuffix.length;
      if (newLength < prefixLength + suffixLength) {
        break;
      }
      const newPrefix = newText.slice(0, prefixLength);
      const newSuffix = newText.slice(newLength - suffixLength);
      if (oldPrefix !== newPrefix || oldSuffix !== newSuffix) {
        break;
      }
      const oldMiddle = oldText.slice(prefixLength, oldLength - suffixLength);
      const newMiddle = newText.slice(prefixLength, newLength - suffixLength);
      return make_edit_splice(oldPrefix, oldMiddle, newMiddle, oldSuffix);
    }
  }

  return null;
}

export function diff(text1: string[], text2: string[]): DiffObject[] {
  // only pass fix_unicode=true at the top level, not when diff_main is
  // recursively invoked
  return diff_main(text1, text2);
}

export function worddiff(text1: string, text2: string): Map<string, string>[] {
  // only pass fix_unicode=true at the top level, not when diff_main is
  // recursively invoked
  const diffArr = diff_main(text1.split(" "), text2.split(" "));

  const r: Map<string, string>[] = [];

  for (let index: i32 = 0; index < diffArr.length; index++) {
    const m = diffArr[index];
    const diffType = m.type;
    const result = m.text;
    const text = result.join(" ");
    const map = new Map<string, string>();
    switch (diffType) {
      case DIFF_EQUAL: {
        map.set("text", text);
        break;
      }
      case DIFF_DELETE: {
        map.set("remove", text);
        break;
      }
      case DIFF_INSERT: {
        map.set("add", text);
        break;
      }
      default:
        throw new Error("unknown diff type: " + diffType.toString());
    }
    r.push(map);
  }

  return r;
}
