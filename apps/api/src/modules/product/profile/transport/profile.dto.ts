import { z } from 'zod';

/**
 * Wire schemas for the profile endpoints.
 *
 * Shape only. Whether a username is well-formed, a bio is within its grapheme
 * limit or a city is too long is decided by the domain — those rules are needed
 * by anything that writes a profile, not only by HTTP.
 *
 * `.strict()` throughout, so an unexpected field is rejected rather than
 * ignored. That matters more here than usual: a client sending `username` to
 * the EDIT endpoint must be told it cannot do that (BR-005), not have it
 * silently dropped and be left believing the handle changed.
 */

/** Generous bounds. The domain enforces the real §12 limits. */
const freeText = (max: number) => z.string().max(max * 4);

export const usernameQuery = z
  .object({
    // Named `u` by the frozen contract: GET /username/available?u=
    u: z.string().min(1).max(64),
  })
  .strict();
export type UsernameQuery = z.infer<typeof usernameQuery>;

export const claimUsernameBody = z.object({ username: z.string().min(1).max(64) }).strict();
export type ClaimUsernameBody = z.infer<typeof claimUsernameBody>;

export const createProfileBody = z
  .object({
    displayName: freeText(50),
    city: freeText(60).nullish(),
    bio: freeText(200).nullish(),
    photoMediaId: z.string().uuid().nullish(),
  })
  .strict();
export type CreateProfileBody = z.infer<typeof createProfileBody>;

/**
 * Edit. Every field optional, and `null` is meaningful.
 *
 * `.nullish()` rather than `.optional()` on the clearable fields, because
 * "clear my bio" and "leave my bio alone" are different requests and the API
 * must be able to express both. Absent means leave; null means clear.
 */
export const updateProfileBody = z
  .object({
    displayName: freeText(50).optional(),
    city: freeText(60).nullish(),
    bio: freeText(200).nullish(),
    photoMediaId: z.string().uuid().nullish(),
  })
  .strict();
export type UpdateProfileBody = z.infer<typeof updateProfileBody>;

export const setInterestsBody = z
  .object({
    // An empty array is VALID: interests are optional (PROFILE-FR-011), so
    // "none" must be expressible. Capped at the size of the fixed taxonomy.
    slugs: z.array(z.string().min(1).max(64)).max(20),
  })
  .strict();
export type SetInterestsBody = z.infer<typeof setInterestsBody>;

export const userIdParam = z.object({ id: z.string().uuid() }).strict();
export type UserIdParam = z.infer<typeof userIdParam>;
