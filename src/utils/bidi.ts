export interface BidiSegment {
  type: 'text' | 'pair';
  text?: string;
  first?: string;
  sep?: string;
  second?: string;
}

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/**
 * Convert ASCII digits 0-9 to Persian digits ۰-۹.
 */
export function toPersianDigits(input: string): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/**
 * Normalize conceptual exercise suffixes like "1-18C" to "۱-۱۸ (مفهومی)" and ensure Persian digits.
 */
export function normalizeExerciseNumber(input: string): string {
  const trimmed = String(input).trim();
  const conceptual = /^([\d\u06f0-\u06f9]+[\-–][\d\u06f0-\u06f9]+)\s*[Cc]$/.exec(trimmed);
  if (conceptual) {
    return `${toPersianDigits(conceptual[1])} (مفهومی)`;
  }
  return toPersianDigits(trimmed);
}

/**
 * Split a Persian text string into plain text and chapter/range number pairs (e.g. ۷-۸, ۷-۸۰, ج-۱, ۱–۲)
 * so each pair renders consistently right-to-left (first segment on right, second on left).
 */
export function splitPersianPairs(input: string): BidiSegment[] {
  if (!input) return [];
  const rx = /(?<![0-9\u06f0-\u06f9A-Za-z_])((?:[\u06f0-\u06f9]+|(?<![\u0621-\u06cc])ج)([\-–])([\u06f0-\u06f9]+))(?![0-9\u06f0-\u06f9A-Za-z_\-–])/g;
  const out: BidiSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = rx.exec(input)) !== null) {
    if (match.index > last) {
      out.push({ type: 'text', text: input.slice(last, match.index) });
    }
    const full = match[1];
    const sep = match[2];
    const sepIdx = full.indexOf(sep);
    out.push({
      type: 'pair',
      first: full.slice(0, sepIdx),
      sep,
      second: full.slice(sepIdx + sep.length),
    });
    last = rx.lastIndex;
  }

  if (last < input.length) {
    out.push({ type: 'text', text: input.slice(last) });
  }
  return out;
}
