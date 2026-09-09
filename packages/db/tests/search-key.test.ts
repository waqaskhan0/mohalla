import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';

/**
 * The cross-script transliteration, tested against real word pairs in real
 * PostgreSQL.
 *
 * These live here rather than in the API suite because `search_key()` IS the
 * implementation — it is a database function feeding a generated column, and
 * testing a TypeScript reimplementation of it would test the wrong thing.
 *
 * SEARCH-FR-003's acceptance criterion is concrete: a post written in Urdu
 * script containing the word for "water" must be found by searching "pani".
 * Every pair below is a claim of that shape, and the three bugs that shaped
 * this function were all found by running exactly this table:
 *
 *   1. a letter-table misalignment turned ج into a space
 *   2. Urdu aspirates (کھ = "kh") were unhandled
 *   3. the trailing-letter rule anchored on the whole string, not each word
 *
 * BR-042 says transliteration is "best-effort, not exhaustive", so the known
 * misses are asserted as misses rather than quietly omitted — a documented
 * limitation stays visible, while a deleted test case does not.
 */

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const describeIfDb = url === undefined ? describe.skip : describe;

let client: Client;

describeIfDb('search_key() — cross-script normalisation (SEARCH-FR-003)', () => {
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  const key = async (text: string): Promise<string> => {
    const r = await client.query<{ k: string }>('SELECT search_key($1) AS k', [text]);
    return r.rows[0]?.k ?? '';
  };

  const meet = async (a: string, b: string): Promise<boolean> => (await key(a)) === (await key(b));

  describe('the stated acceptance criterion', () => {
    it('an Urdu word for water and its Roman spellings agree', async () => {
      expect(await meet('پانی', 'pani')).toBe(true);
      expect(await meet('پانی', 'paani')).toBe(true);
    });

    it('is symmetric — either script finds the other', async () => {
      // The requirement lists both directions as separate criteria, so both
      // are asserted rather than assumed from one.
      expect(await key('پانی')).toBe(await key('pani'));
      expect(await key('pani')).toBe(await key('پانی'));
    });
  });

  describe('everyday civic vocabulary', () => {
    it.each([
      ['بجلی', 'bijli'],
      ['بجلی', 'bijlee'],
      ['سڑک', 'sarak'],
      ['مسجد', 'masjid'],
      ['اسکول', 'iskool'],
      ['سکول', 'skool'],
      ['صفائی', 'safai'],
      ['صفائی', 'safaai'],
      ['کچرا', 'kachra'],
      ['گلی', 'gali'],
      ['بارش', 'barish'],
      ['ہسپتال', 'hospital'],
      ['تعلیم', 'taleem'],
      ['صحت', 'sehat'],
      ['نالی', 'nali'],
      ['دروازہ', 'darwaza'],
      ['موسم', 'mausam'],
      ['حکومت', 'hukumat'],
      ['نکاسی', 'nikasi'],
    ])('%s matches %s', async (urdu, roman) => {
      expect(await meet(urdu, roman)).toBe(true);
    });
  });

  describe('aspirates — consonant + ھ', () => {
    // Urdu writes aspiration as a base consonant followed by ھ. An earlier
    // version handled only ٹھ, so کھانا and "khana" could never meet.
    it.each([
      ['کھانا', 'khana'],
      ['گھر', 'ghar'],
      ['کھڑکی', 'khirki'],
      ['چھت', 'chhat'],
      ['بھائی', 'bhai'],
      ['پھل', 'phal'],
    ])('%s matches %s', async (urdu, roman) => {
      expect(await meet(urdu, roman)).toBe(true);
    });
  });

  describe('names — what people search for most (SEARCH-FR-001)', () => {
    it.each([
      ['عائشہ', 'ayesha'],
      ['خان', 'khan'],
      ['فاطمہ', 'fatima'],
      ['محمد', 'muhammad'],
      ['زینب', 'zainab'],
      ['حسن', 'hassan'],
      ['سعدیہ', 'sadia'],
      ['عمران', 'imran'],
      ['نادیہ', 'nadia'],
      ['ثمینہ', 'samina'],
    ])('%s matches %s', async (urdu, roman) => {
      expect(await meet(urdu, roman)).toBe(true);
    });

    it('MATCHES A FULL NAME, not only single words', async () => {
      // The bug that made this necessary: the trailing-letter rule anchored on
      // the end of the whole string, so it fired for a single word and did
      // nothing inside a phrase. Every real display name is a phrase.
      expect(await meet('عائشہ خان', 'ayesha khan')).toBe(true);
      expect(await meet('شکریہ بھائی', 'shukriya bhai')).toBe(true);
    });
  });

  describe('phrases', () => {
    it('normalises each word independently', async () => {
      expect(await key('شکریہ بھائی')).toBe(await key('shukriya bhai'));
    });

    it('handles a whole sentence in either script', async () => {
      const urdu = await key('محلے میں پانی کی سپلائی بند ہے');
      const roman = await key('mohalle mein pani ki supply band hai');
      // Not identical - "supply" and سپلائی diverge - but both must contain
      // the same key for the word that matters.
      expect(urdu).toContain('pn');
      expect(roman).toContain('pn');
    });
  });

  describe('known limits (BR-042: best-effort, not exhaustive)', () => {
    it('does not match the retroflex ڑ against a "d" romanisation', async () => {
      // کوڑا is written "kooda" as often as "koora". ڑ can only map to one
      // letter, so one of the two spellings is always missed. Asserted as a
      // MISS so the limitation stays visible rather than being forgotten.
      expect(await meet('کوڑا', 'kooda')).toBe(false);
      expect(await meet('کوڑا', 'koora')).toBe(true);
    });

    it('does not match English loanwords against their Urdu spelling', async () => {
      // سیوریج transliterates to its Urdu letters, not to English "sewerage".
      expect(await meet('سیوریج', 'sewerage')).toBe(false);
    });

    it('does not bridge English spelling to its Urdu borrowing', async () => {
      // کمیٹی is "kameti"; English writes "committee" with a c. Mapping c to k
      // would fix this pair and is tempting, but the requirement is about Urdu
      // and ROMAN URDU, not about English orthography - and the raw-text match
      // in the search query already finds English words directly.
      expect(await meet('کمیٹی', 'kameti')).toBe(true);
      expect(await meet('کمیٹی', 'committee')).toBe(false);
    });

    it('produces very short keys for short words', async () => {
      // علی and "ali" both reduce to a single character. That LOOKS like it
      // should match everything, and an earlier version of the service refused
      // such keys on that assumption. Measured, the opposite is true:
      // word_similarity compares word-length extents, so "l" matched 0 of 54
      // profiles. See SEARCH_KEY_MIN_LENGTH for why the guard is now empty-only.
      expect(await key('علی')).toBe(await key('ali'));
      expect((await key('ali')).length).toBeLessThan(2);
    });
  });

  describe('properties that must hold whatever the input', () => {
    it('is deterministic', async () => {
      expect(await key('پانی')).toBe(await key('پانی'));
    });

    it('is case-insensitive', async () => {
      expect(await key('PANI')).toBe(await key('pani'));
      expect(await key('Ayesha Khan')).toBe(await key('ayesha khan'));
    });

    it('handles an empty string and punctuation without failing', async () => {
      expect(await key('')).toBe('');
      // Punctuation is not letters, so it survives - the key is for matching,
      // not for display, and stripping it is not worth the risk of merging
      // words that were separate.
      await expect(key('!!!')).resolves.toBeDefined();
    });

    it('never throws on unexpected input', async () => {
      for (const odd of ['🇵🇰', '123', 'a'.repeat(500), '\n\t ', 'ÀÉÎÕÜ']) {
        await expect(key(odd)).resolves.toBeDefined();
      }
    });
  });
});
