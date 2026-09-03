import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ProfileService } from './profile.service.js';
import { UsernameService } from './username.service.js';
import { InMemoryProfileRepository } from '../testing/in-memory-profile.repository.js';
import { NoBlocksYet, type BlockCheck } from '../ports/block-check.port.js';
import { FORBIDDEN_PROFILE_FIELDS, PUBLIC_PROFILE_FIELDS } from '../domain/public-profile.js';
import type { UserState } from '../../../platform/identity/domain/user-state.js';
import type { DatabaseService } from '../../../../database/database.service.js';
import type { StructuredLogger } from '../../../../common/logging/structured.logger.js';

function build(blocks: BlockCheck = new NoBlocksYet()) {
  const repo = new InMemoryProfileRepository();
  const logs: string[] = [];

  const db = {
    withTransaction: async <T>(fn: (c: never) => Promise<T>): Promise<T> => fn(undefined as never),
  } as unknown as DatabaseService;
  const logger = {
    log: (m: unknown) => logs.push(String(m)),
    warn: (m: unknown) => logs.push(String(m)),
    error: (m: unknown) => logs.push(String(m)),
  } as unknown as StructuredLogger;

  const service = new ProfileService(db, repo, blocks, logger);
  const usernames = new UsernameService(db, repo, logger);

  return {
    service,
    usernames,
    repo,
    logs,

    async seed(
      username = 'ayesha_k',
      state: UserState = 'ACTIVE',
      suspendedUntil: Date | null = null,
    ) {
      const userId = randomUUID();
      repo.setUser(userId, { state: state as never, suspendedUntil });

      const claimed = await service.claimUsername({ userId, username });
      if (claimed.status !== 'CLAIMED') throw new Error(`seed claim failed: ${claimed.status}`);

      const done = await service.completeProfile({ userId, displayName: 'Ayesha Khan' });
      if (done.status !== 'CREATED') throw new Error(`seed complete failed: ${done.status}`);
      return userId;
    },
  };
}

describe('ProfileService.claimUsername (PROFILE-FR-002)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('stores the username, so the handle is held the moment it succeeds', async () => {
    // The SRS says "username is stored and the user proceeds to profile
    // creation" - a write, not a reservation, which is what makes E4 ("network
    // failure -> no username reserved, retry is safe") true.
    const userId = randomUUID();
    const r = await ctx.service.claimUsername({ userId, username: 'ayesha_k' });

    expect(r.status).toBe('CLAIMED');
    expect(await ctx.usernames.check('ayesha_k')).toEqual({ status: 'UNAVAILABLE' });
  });

  it('uses the handle as a provisional display name, so the row is usable', async () => {
    const userId = randomUUID();
    const r = await ctx.service.claimUsername({ userId, username: 'ayesha_k' });
    if (r.status !== 'CLAIMED') throw new Error('expected a claim');

    // display_name is NOT NULL. A nullable one would push "is this profile
    // finished?" into every read path.
    expect(r.profile.displayName).toBe('ayesha_k');
  });

  it('REFUSES A TAKEN HANDLE, case-insensitively (EDGE-008)', async () => {
    await ctx.seed('ayesha_k');
    expect(await ctx.service.claimUsername({ userId: randomUUID(), username: 'ayesha_k' })).toEqual(
      { status: 'USERNAME_UNAVAILABLE' },
    );
    // The uppercase form is malformed as input, and the store treats the two
    // as one handle regardless.
    expect(await ctx.repo.isUsernameTaken('AYESHA_K')).toBe(true);
  });

  it('LOSES THE RACE GRACEFULLY (EDGE-007 / E3)', async () => {
    // Two people confirm the same handle at once. Both pass any prior check;
    // the UNIQUE index decides and the loser is asked to choose again.
    ctx.repo.loseUsernameRace = true;
    expect(await ctx.service.claimUsername({ userId: randomUUID(), username: 'ayesha_k' })).toEqual(
      { status: 'USERNAME_UNAVAILABLE' },
    );
  });

  it('reports a RESERVED handle exactly as it reports a taken one', async () => {
    const reserved = await ctx.service.claimUsername({
      userId: randomUUID(),
      username: 'shehersaaz',
    });
    await ctx.seed('ayesha_k');
    const taken = await ctx.service.claimUsername({ userId: randomUUID(), username: 'ayesha_k' });

    // A2: refused "without explaining why". Different answers would make the
    // reserved list enumerable.
    expect(JSON.stringify(reserved)).toBe(JSON.stringify(taken));
  });

  it('reports a malformed handle with its reason', async () => {
    expect(await ctx.service.claimUsername({ userId: randomUUID(), username: 'ab' })).toEqual({
      status: 'INVALID_INPUT',
      field: 'username',
      reason: 'TOO_SHORT',
    });
  });

  it('REFUSES A SECOND CLAIM, even for the same handle (BR-005)', async () => {
    const userId = await ctx.seed('ayesha_k');

    // Immutable means immutable: re-claiming would be the one way to change it.
    expect(await ctx.service.claimUsername({ userId, username: 'ayesha_k' })).toEqual({
      status: 'ALREADY_CLAIMED',
    });
    expect(await ctx.service.claimUsername({ userId, username: 'different_one' })).toEqual({
      status: 'ALREADY_CLAIMED',
    });
  });
});

describe('ProfileService.completeProfile (PROFILE-FR-001)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  const claimed = async (username = 'ayesha_k') => {
    const userId = randomUUID();
    const r = await ctx.service.claimUsername({ userId, username });
    if (r.status !== 'CLAIMED') throw new Error('claim failed');
    return userId;
  };

  it('creates a profile from a display name alone', async () => {
    // PROFILE-FR-001 AC: "GIVEN only a display name supplied, WHEN saved, THEN
    // the profile is created and usable."
    const userId = await claimed();
    const r = await ctx.service.completeProfile({ userId, displayName: 'Ayesha' });

    expect(r.status).toBe('CREATED');
    if (r.status === 'CREATED') {
      expect(r.profile.username).toBe('ayesha_k');
      expect(r.profile.displayName).toBe('Ayesha');
      expect(r.profile.city).toBeNull();
      expect(r.profile.bio).toBeNull();
      expect(r.profile.photoMediaId).toBeNull(); // client renders a placeholder
      expect(r.profile.verifiedBadge).toBe(false);
      expect(r.profile.followerCount).toBe(0);
    }
  });

  it('accepts an Urdu display name, city and bio as first-class', async () => {
    const userId = await claimed();
    const r = await ctx.service.completeProfile({
      userId,
      displayName: 'عائشہ خان',
      city: 'کراچی',
      bio: 'محلے کی رہائشی',
    });
    expect(r.status).toBe('CREATED');
    if (r.status === 'CREATED') expect(r.profile.displayName).toBe('عائشہ خان');
  });

  it('REFUSES TO RUN BEFORE A USERNAME IS CLAIMED', async () => {
    // The username is permanent and the user confirms it "having been warned
    // the choice is permanent". Deriving one from a display name here would
    // hand someone an irreversible identifier they never chose.
    expect(
      await ctx.service.completeProfile({ userId: randomUUID(), displayName: 'Ayesha' }),
    ).toEqual({ status: 'USERNAME_REQUIRED' });
  });

  it('does not change the username (BR-005)', async () => {
    const userId = await claimed('ayesha_k');
    await ctx.service.completeProfile({ userId, displayName: 'Ayesha Khan' });

    const own = await ctx.service.getOwn(userId);
    expect(own?.username).toBe('ayesha_k');
  });

  it('rejects a blank display name', async () => {
    const userId = await claimed();
    expect(await ctx.service.completeProfile({ userId, displayName: '   ' })).toEqual({
      status: 'INVALID_INPUT',
      field: 'displayName',
      reason: 'BLANK',
    });
  });

  it('normalises empty optional text to null, so "" and absent are one state', async () => {
    const userId = await claimed();
    const r = await ctx.service.completeProfile({
      userId,
      displayName: 'Ayesha',
      city: '   ',
      bio: '',
    });
    if (r.status !== 'CREATED') throw new Error('expected creation');
    expect(r.profile.city).toBeNull();
    expect(r.profile.bio).toBeNull();
  });

  it('never logs the display name, city or bio', async () => {
    const userId = await claimed();
    await ctx.service.completeProfile({
      userId,
      displayName: 'Ayesha Khan',
      city: 'Karachi',
      bio: 'A private sentence about me',
    });
    for (const line of ctx.logs) {
      expect(line).not.toContain('Ayesha Khan');
      expect(line).not.toContain('Karachi');
      expect(line).not.toContain('A private sentence about me');
    }
  });
});

describe('ProfileService — the public projection (PRIV-003/004)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('RETURNS EXACTLY THE APPROVED FIELD SET, and nothing more', async () => {
    const owner = await ctx.seed('ayesha_k');
    const viewer = await ctx.seed('bilal_99');

    const r = await ctx.service.viewByUserId(viewer, owner);
    if (r.status !== 'FOUND') throw new Error('expected the profile');

    // §162: display name, username, photo, city, bio, badge and counts - "and
    // nothing else". Pinned, so widening the projection requires a human to
    // decide the new field is genuinely public.
    expect(Object.keys(r.profile).sort()).toEqual([...PUBLIC_PROFILE_FIELDS]);
  });

  it('CONTAINS NO IDENTIFIER, under any field name', async () => {
    const owner = await ctx.seed('ayesha_k');
    const viewer = await ctx.seed('bilal_99');
    const r = await ctx.service.viewByUserId(viewer, owner);
    if (r.status !== 'FOUND') throw new Error('expected the profile');

    for (const field of FORBIDDEN_PROFILE_FIELDS) {
      expect(r.profile, `public profile must not carry "${field}"`).not.toHaveProperty(field);
    }
  });

  it('does not carry a date of birth even in the OWNER view', async () => {
    const userId = await ctx.seed('ayesha_k');
    const own = await ctx.service.getOwn(userId);
    expect(own).not.toBeNull();
    for (const field of FORBIDDEN_PROFILE_FIELDS) {
      expect(own, `own profile must not carry "${field}"`).not.toHaveProperty(field);
    }
  });

  it('gives the owner more than the public view, but only what they are owed', async () => {
    const userId = await ctx.seed('ayesha_k');
    const own = await ctx.service.getOwn(userId);
    if (own === null) throw new Error('expected the profile');

    // A superset: everything public, plus state and interests.
    for (const field of PUBLIC_PROFILE_FIELDS) {
      expect(own).toHaveProperty(field);
    }
    expect(own.state).toBe('ACTIVE');
    expect(own.interests).toEqual([]);
  });

  it('an ORGANIZATION account type does not imply a badge (PROFILE-FR-006)', async () => {
    const userId = randomUUID();
    ctx.repo.setUser(userId, { accountType: 'ORGANIZATION' });
    await ctx.service.claimUsername({ userId, username: 'ngo_karachi' });
    await ctx.service.completeProfile({ userId, displayName: 'An NGO' });

    const own = await ctx.service.getOwn(userId);
    expect(own?.accountType).toBe('ORGANIZATION');
    expect(own?.verifiedBadge).toBe(false);
  });
});

describe('ProfileService — one neutral not-available state (PROFILE-FR-005)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('shows a SUSPENDED profile, because a suspension is temporary', async () => {
    const owner = await ctx.seed('ayesha_k', 'SUSPENDED', new Date('2026-04-01T00:00:00Z'));
    const viewer = await ctx.seed('bilal_99');

    // Hiding it would break existing conversations for a temporary state.
    const r = await ctx.service.viewByUserId(viewer, owner);
    expect(r.status).toBe('FOUND');
  });

  it('HIDES BANNED AND DELETED, and looks identical to never existing', async () => {
    const viewer = await ctx.seed('viewer_one');
    const answers: unknown[] = [];

    for (const state of ['BANNED', 'DELETED'] as const) {
      const c = build();
      const v = await c.seed('viewer_two');
      const target = await c.seed('target_user', state);
      answers.push(await c.service.viewByUserId(v, target));
    }

    // ...and a user that never existed.
    answers.push(await ctx.service.viewByUserId(viewer, randomUUID()));

    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 'NOT_AVAILABLE' });
  });

  it('A BLOCK HIDES THE PROFILE IN BOTH DIRECTIONS (BR-025)', async () => {
    // The block check is a port because blocks belong to EPIC-05. This proves
    // the read path CONSULTS it, so supplying the real adapter cannot be a
    // no-op.
    const seen: [string, string][] = [];
    const blocking: BlockCheck = {
      async isBlockedEitherWay(a, b) {
        seen.push([a, b]);
        return true;
      },
    };

    const c = build(blocking);
    const owner = await c.seed('ayesha_k');
    const viewer = await c.seed('bilal_99');

    expect(await c.service.viewByUserId(viewer, owner)).toEqual({ status: 'NOT_AVAILABLE' });
    // And the reverse direction, from the same single block.
    expect(await c.service.viewByUserId(owner, viewer)).toEqual({ status: 'NOT_AVAILABLE' });
    expect(seen).toHaveLength(2);
  });

  it('a blocked profile is indistinguishable from a missing one', async () => {
    const blocking: BlockCheck = {
      async isBlockedEitherWay() {
        return true;
      },
    };
    const c = build(blocking);
    const owner = await c.seed('ayesha_k');
    const viewer = await c.seed('bilal_99');

    const blocked = await c.service.viewByUserId(viewer, owner);
    const missing = await c.service.viewByUserId(viewer, randomUUID());

    // "This account has blocked you" turns a private safety decision into a
    // notification, so the two must be the same answer.
    expect(JSON.stringify(blocked)).toBe(JSON.stringify(missing));
  });

  it('does not ask about a block when viewing your own profile', async () => {
    let asked = 0;
    const counting: BlockCheck = {
      async isBlockedEitherWay() {
        asked += 1;
        return true;
      },
    };
    const c = build(counting);
    const userId = await c.seed('ayesha_k');

    const r = await c.service.viewByUserId(userId, userId);
    expect(r.status).toBe('FOUND');
    expect(asked).toBe(0);
  });

  it('resolves by username with the same rules', async () => {
    const viewer = await ctx.seed('bilal_99');
    await ctx.seed('ayesha_k');

    const found = await ctx.service.viewByUsername(viewer, 'ayesha_k');
    expect(found.status).toBe('FOUND');

    // Case-insensitive lookup - but 'AYESHA_K' is malformed as input, and a
    // malformed handle must give the same neutral miss, never a hint about
    // what a valid handle looks like.
    expect(await ctx.service.viewByUsername(viewer, 'AYESHA_K')).toEqual({
      status: 'NOT_AVAILABLE',
    });
    expect(await ctx.service.viewByUsername(viewer, 'no_such_user')).toEqual({
      status: 'NOT_AVAILABLE',
    });
  });
});

describe('ProfileService.update (PROFILE-FR-003, BR-005)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('updates the fields the owner may change', async () => {
    const userId = await ctx.seed('ayesha_k');
    const r = await ctx.service.update({
      userId,
      displayName: 'Ayesha N. Khan',
      city: 'Lahore',
      bio: 'Neighbourhood volunteer',
    });

    expect(r.status).toBe('UPDATED');
    if (r.status === 'UPDATED') {
      expect(r.profile.displayName).toBe('Ayesha N. Khan');
      expect(r.profile.city).toBe('Lahore');
      expect(r.profile.bio).toBe('Neighbourhood volunteer');
    }
  });

  it('LEAVES THE USERNAME ALONE — it is not even expressible (BR-005)', async () => {
    const userId = await ctx.seed('ayesha_k');
    // `username` is absent from UpdateProfileCommand, so this is a type error
    // in real code; cast to prove the service ignores it even if one arrives.
    await ctx.service.update({ userId, username: 'new_handle' } as never);

    const own = await ctx.service.getOwn(userId);
    expect(own?.username).toBe('ayesha_k');
  });

  it('distinguishes "clear this field" from "leave it alone"', async () => {
    const userId = await ctx.seed('ayesha_k');
    await ctx.service.update({ userId, city: 'Karachi', bio: 'Something' });

    // Only city is mentioned, so the bio must survive.
    const partial = await ctx.service.update({ userId, city: null });
    if (partial.status !== 'UPDATED') throw new Error('expected an update');
    expect(partial.profile.city).toBeNull();
    expect(partial.profile.bio).toBe('Something');
  });

  it('an empty update is a no-op, not an error', async () => {
    const userId = await ctx.seed('ayesha_k');
    const r = await ctx.service.update({ userId });
    expect(r.status).toBe('UPDATED');
  });

  it('rejects an over-long bio without changing anything', async () => {
    const userId = await ctx.seed('ayesha_k');
    await ctx.service.update({ userId, bio: 'keep me' });

    const r = await ctx.service.update({ userId, bio: 'x'.repeat(201) });
    expect(r).toEqual({ status: 'INVALID_INPUT', field: 'bio', reason: 'TOO_LONG' });

    const own = await ctx.service.getOwn(userId);
    expect(own?.bio).toBe('keep me');
  });

  it('CANNOT BE ASKED TO EDIT SOMEONE ELSE (PROFILE-FR-003 AC)', async () => {
    const a = await ctx.seed('ayesha_k');
    const b = await ctx.seed('bilal_99');

    // There is no "whose profile" parameter: the id comes from the
    // authenticated principal, so a cross-user edit is not expressible rather
    // than being caught by a check.
    await ctx.service.update({ userId: a, displayName: 'Changed' });

    const other = await ctx.service.getOwn(b);
    expect(other?.displayName).toBe('Ayesha Khan');
  });

  it('reports NOT_FOUND for a user with no profile', async () => {
    const r = await ctx.service.update({ userId: randomUUID(), displayName: 'Nobody' });
    expect(r).toEqual({ status: 'NOT_FOUND' });
  });
});

describe('ProfileService — interests (PROFILE-FR-011)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('lists the fixed categories in order', async () => {
    const cats = await ctx.service.listCategories();
    expect(cats.map((c) => c.slug)).toEqual([
      'environment-climate',
      'education',
      'health',
      'general',
    ]);
    // Both languages are present, since the client renders either.
    expect(cats.every((c) => c.nameEn !== '' && c.nameUr !== '')).toBe(true);
  });

  it('stores a selection and reads it back', async () => {
    const userId = await ctx.seed('ayesha_k');
    const r = await ctx.service.setInterests(userId, ['health', 'education']);
    expect(r.status).toBe('UPDATED');

    const own = await ctx.service.getOwn(userId);
    expect(own?.interests).toEqual(['education', 'health']); // sorted by sort_order
  });

  it('treats an empty selection as valid, because interests are OPTIONAL', async () => {
    const userId = await ctx.seed('ayesha_k');
    await ctx.service.setInterests(userId, ['health']);

    // "Skipping degrades no other function", so deselecting everything is a
    // legitimate request rather than a malformed one.
    const r = await ctx.service.setInterests(userId, []);
    expect(r).toEqual({ status: 'UPDATED', interests: [] });
  });

  it('replaces rather than merges, so an interest can be removed', async () => {
    const userId = await ctx.seed('ayesha_k');
    await ctx.service.setInterests(userId, ['health', 'education']);
    const r = await ctx.service.setInterests(userId, ['health']);
    expect(r).toEqual({ status: 'UPDATED', interests: ['health'] });
  });

  it('REPORTS AN UNKNOWN SLUG INSTEAD OF SILENTLY DROPPING IT', async () => {
    const userId = await ctx.seed('ayesha_k');
    await ctx.service.setInterests(userId, ['health']);

    const r = await ctx.service.setInterests(userId, ['health', 'not-a-category']);
    expect(r).toEqual({ status: 'UNKNOWN_CATEGORY', unknownSlugs: ['not-a-category'] });

    // And the existing selection is intact - a typo must not wipe it.
    const own = await ctx.service.getOwn(userId);
    expect(own?.interests).toEqual(['health']);
  });

  it('de-duplicates a repeated slug', async () => {
    const userId = await ctx.seed('ayesha_k');
    const r = await ctx.service.setInterests(userId, ['health', 'health']);
    expect(r).toEqual({ status: 'UPDATED', interests: ['health'] });
  });
});

describe('UsernameService (PROF-API-001)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('reports a free handle as available', async () => {
    expect(await ctx.usernames.check('ayesha_k')).toEqual({ status: 'AVAILABLE' });
  });

  it('reports a taken handle as unavailable', async () => {
    await ctx.seed('ayesha_k');
    expect(await ctx.usernames.check('ayesha_k')).toEqual({ status: 'UNAVAILABLE' });
  });

  it('is case-insensitive about what is taken (EDGE-008)', async () => {
    await ctx.seed('ayesha_k');
    // 'Ayesha_K' is malformed anyway, but the underlying store must also treat
    // the two as the same handle.
    expect(await ctx.repo.isUsernameTaken('AYESHA_K')).toBe(true);
  });

  it('gives ONE answer for taken and reserved', async () => {
    await ctx.seed('ayesha_k');
    const taken = await ctx.usernames.check('ayesha_k');
    const reserved = await ctx.usernames.check('admin');
    expect(JSON.stringify(taken)).toBe(JSON.stringify(reserved));
  });

  it('reports a malformed handle with its reason', async () => {
    expect(await ctx.usernames.check('ab')).toEqual({ status: 'MALFORMED', reason: 'TOO_SHORT' });
    expect(await ctx.usernames.check('Ayesha')).toEqual({
      status: 'MALFORMED',
      reason: 'MUST_START_WITH_LETTER',
    });
  });

  it('suggests alternatives that are actually free (PROFILE-FR-002 A1)', async () => {
    await ctx.seed('ayesha_k');
    const suggestions = await ctx.usernames.suggest('ayesha_k');

    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      // Offering a taken alternative would send the user straight back into
      // the same refusal.
      expect(await ctx.repo.isUsernameTaken(s)).toBe(false);
      expect(await ctx.usernames.check(s)).toEqual({ status: 'AVAILABLE' });
      expect(s.startsWith('ayesha_k')).toBe(true);
    }
  });

  it('keeps a suggestion within the 20-character limit', async () => {
    const long = 'a'.repeat(20);
    await ctx.seed(long);
    for (const s of await ctx.usernames.suggest(long)) {
      expect(s.length).toBeLessThanOrEqual(20);
      expect(await ctx.usernames.check(s)).toEqual({ status: 'AVAILABLE' });
    }
  });

  it('suggests nothing for a malformed handle', async () => {
    expect(await ctx.usernames.suggest('ab')).toEqual([]);
  });

  it('never suggests a reserved handle', async () => {
    // 'admin' is reserved, so 'admin1'.. must still be screened rather than
    // offered blindly.
    for (const s of await ctx.usernames.suggest('admin')) {
      expect(await ctx.usernames.check(s)).toEqual({ status: 'AVAILABLE' });
    }
  });
});
