/**
 * Pakistani mobile number normalization.
 *
 * OD-021 Option C makes a verified Pakistani mobile the mandatory V1 identity,
 * so this is the gate every account passes through. It must be TOTAL and
 * DETERMINISTIC: the same human number typed five different ways has to reduce
 * to exactly one stored value, or the uniqueness constraint and the ban list
 * both leak duplicates.
 *
 * Accepted input forms (all reduce to +92 3XXXXXXXXX):
 *   03001234567        national, leading zero
 *   3001234567         national, no leading zero
 *   +923001234567      E.164
 *   0092 300 1234567   international prefix, spaces
 *   +92-300-1234567    separators
 *
 * Rejected: any non-Pakistani country code, landlines, short codes, and any
 * mobile prefix outside 30x-34x (the ranges Pakistani operators actually use).
 */

/** Pakistani mobile network codes in use: 30x-34x after the leading 3. */
const MOBILE_PREFIX = /^3[0-4]\d$/;

export class PhoneNumberError extends Error {
  constructor(readonly reason: 'FORMAT' | 'NOT_PAKISTANI' | 'NOT_MOBILE') {
    // Deliberately generic. The caller maps this to a neutral response so the
    // failure never distinguishes "bad shape" from "not one of ours".
    super('invalid phone number');
    this.name = 'PhoneNumberError';
  }
}

/**
 * Reduce any accepted form to canonical E.164: `+923001234567`.
 * @throws PhoneNumberError - never returns a partially-normalized value.
 */
export function normalizePakistaniMobile(input: string): string {
  if (typeof input !== 'string') throw new PhoneNumberError('FORMAT');

  // Strip everything a human might type as a separator.
  let digits = input.replace(/[\s()\-.]/g, '');

  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);

  if (!/^\d+$/.test(digits)) throw new PhoneNumberError('FORMAT');

  // Reduce to the 10-digit national significant number (3XXXXXXXXX).
  let nsn: string;
  if (digits.startsWith('92')) {
    nsn = digits.slice(2);
    // 0092 300... - a national trunk zero after the country code.
    if (nsn.startsWith('0')) nsn = nsn.slice(1);
  } else if (digits.startsWith('0')) {
    nsn = digits.slice(1);
  } else if (digits.length === 10 && digits.startsWith('3')) {
    nsn = digits;
  } else {
    // Any other country code, or something too short/long to be Pakistani.
    throw new PhoneNumberError('NOT_PAKISTANI');
  }

  if (nsn.length !== 10) throw new PhoneNumberError('FORMAT');
  if (!MOBILE_PREFIX.test(nsn.slice(0, 3))) throw new PhoneNumberError('NOT_MOBILE');

  return `+92${nsn}`;
}

/** Non-throwing variant for call sites that branch instead of catching. */
export function tryNormalizePakistaniMobile(input: string): string | null {
  try {
    return normalizePakistaniMobile(input);
  } catch {
    return null;
  }
}

/**
 * Display form for the OWNER of the number only - never for a public DTO.
 * Masks all but the last two digits: `+92 3** *** **67`.
 */
export function maskForOwner(e164: string): string {
  const last2 = e164.slice(-2);
  return `+92 3** *** **${last2}`;
}
