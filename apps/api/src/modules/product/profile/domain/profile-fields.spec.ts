import { describe, it, expect } from 'vitest';
import {
  BIO_MAX_LENGTH,
  CITY_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  checkBio,
  checkCity,
  checkDisplayName,
  countGraphemes,
  normalizeOptionalText,
} from './profile-fields.js';

/**
 * The counting rule is the substance of these tests. §12 specifies GRAPHEME
 * CLUSTERS, and on a bilingual platform that is not pedantry: counting code
 * points charges Urdu writers for diacritics they did not spend, and would let
 * a 200-character bio hold as few as 18 emoji.
 */

describe('countGraphemes', () => {
  it('counts plain Latin text the obvious way', () => {
    expect(countGraphemes('Ayesha')).toBe(6);
  });

  it('COUNTS URDU AS A READER WOULD', () => {
    // کتاب - four letters a reader sees, and four graphemes.
    expect(countGraphemes('کتاب')).toBe(4);

    // With a kasra diacritic it is still four letters to a reader, though it is
    // five code points. Counting code points would charge for the mark.
    const withDiacritic = 'کِتاب';
    expect([...withDiacritic].length).toBe(5);
    expect(countGraphemes(withDiacritic)).toBe(4);
  });

  it('counts an emoji as one character, not two or four', () => {
    expect('😀'.length).toBe(2); // UTF-16 units
    expect(countGraphemes('😀')).toBe(1);
  });

  it('counts a flag as one, though it is two code points', () => {
    const flag = '🇵🇰';
    expect([...flag].length).toBe(2);
    expect(countGraphemes(flag)).toBe(1);
  });

  it('counts a ZWJ family emoji as one, though it is many code points', () => {
    const family = '👨‍👩‍👧‍👦';
    expect([...family].length).toBeGreaterThan(4);
    expect(countGraphemes(family)).toBe(1);
  });

  it('handles the empty string', () => {
    expect(countGraphemes('')).toBe(0);
  });
});

describe('checkDisplayName (2–50, any script, not blank)', () => {
  it('accepts an ordinary name', () => {
    expect(checkDisplayName('Ayesha Khan')).toBeNull();
  });

  it('accepts an Urdu name as first-class', () => {
    expect(checkDisplayName('عائشہ خان')).toBeNull();
  });

  it('enforces both bounds exactly, counted by grapheme', () => {
    expect(checkDisplayName('A')).toBe('TOO_SHORT');
    expect(checkDisplayName('Ab')).toBeNull();
    expect(checkDisplayName('a'.repeat(DISPLAY_NAME_MAX_LENGTH))).toBeNull();
    expect(checkDisplayName('a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toBe('TOO_LONG');
  });

  it('allows 50 emoji, because 50 characters means 50 characters', () => {
    // .length would call this 100 and reject it.
    expect(checkDisplayName('😀'.repeat(DISPLAY_NAME_MAX_LENGTH))).toBeNull();
    expect(checkDisplayName('😀'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toBe('TOO_LONG');
  });

  it('rejects a blank or whitespace-only name', () => {
    for (const bad of ['', '   ', '\t', '\n']) {
      expect(checkDisplayName(bad)).toBe('BLANK');
    }
  });

  it('REJECTS SURROUNDING WHITESPACE RATHER THAN TRIMMING IT', () => {
    // Trimming silently would let two neighbours hold names that look
    // identical but differ by an invisible character, and the person who typed
    // the space would never learn why their name renders oddly.
    expect(checkDisplayName(' Ayesha')).toBe('BLANK');
    expect(checkDisplayName('Ayesha ')).toBe('BLANK');
  });

  it('allows internal whitespace, since names have spaces in them', () => {
    expect(checkDisplayName('Ayesha Noor Khan')).toBeNull();
  });

  it('rejects non-string input', () => {
    for (const bad of [undefined, null, 42, {}]) {
      expect(checkDisplayName(bad)).toBe('NOT_A_STRING');
    }
  });

  it('exposes the documented bounds', () => {
    expect(DISPLAY_NAME_MIN_LENGTH).toBe(2);
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(50);
  });
});

describe('checkBio (0–200, optional)', () => {
  it('treats absent, null and empty as equally fine', () => {
    expect(checkBio(undefined)).toBeNull();
    expect(checkBio(null)).toBeNull();
    expect(checkBio('')).toBeNull();
  });

  it('enforces the bound exactly, by grapheme', () => {
    expect(checkBio('x'.repeat(BIO_MAX_LENGTH))).toBeNull();
    expect(checkBio('x'.repeat(BIO_MAX_LENGTH + 1))).toBe('TOO_LONG');
  });

  it('DOES NOT PENALISE AN URDU BIO for its diacritics', () => {
    // 200 graphemes of Urdu with marks is more than 200 code points, and must
    // still be accepted.
    const urdu = 'کِ'.repeat(BIO_MAX_LENGTH / 2);
    expect(countGraphemes(urdu)).toBe(BIO_MAX_LENGTH / 2);
    expect([...urdu].length).toBeGreaterThan(BIO_MAX_LENGTH / 2);
    expect(checkBio(urdu)).toBeNull();
  });

  it('lets a bio be 200 emoji', () => {
    expect(checkBio('🇵🇰'.repeat(BIO_MAX_LENGTH))).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(checkBio(42)).toBe('NOT_A_STRING');
  });
});

describe('checkCity (0–60, free text, never device-derived)', () => {
  it('accepts a city, in either script, or none at all', () => {
    expect(checkCity('Karachi')).toBeNull();
    expect(checkCity('کراچی')).toBeNull();
    expect(checkCity(null)).toBeNull();
  });

  it('enforces the bound exactly', () => {
    expect(checkCity('x'.repeat(CITY_MAX_LENGTH))).toBeNull();
    expect(checkCity('x'.repeat(CITY_MAX_LENGTH + 1))).toBe('TOO_LONG');
  });

  it('does not constrain the value to a list', () => {
    // V1 has no fixed city list, so an unusual place name must be accepted -
    // a hardcoded list would exclude exactly the smaller towns this platform
    // is meant to serve.
    expect(checkCity('Mithi')).toBeNull();
    expect(checkCity('Gilgit')).toBeNull();
  });
});

describe('normalizeOptionalText', () => {
  it('collapses empty and whitespace-only to null, so "" and absent are one state', () => {
    expect(normalizeOptionalText('')).toBeNull();
    expect(normalizeOptionalText('   ')).toBeNull();
    expect(normalizeOptionalText(null)).toBeNull();
    expect(normalizeOptionalText(undefined)).toBeNull();
  });

  it('trims a real value', () => {
    expect(normalizeOptionalText('  Karachi  ')).toBe('Karachi');
  });
});
