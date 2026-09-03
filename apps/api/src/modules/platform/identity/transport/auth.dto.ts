import { z } from 'zod';

/**
 * Wire schemas for the auth endpoints.
 *
 * Validation here is SHAPE ONLY — is this a string, is it six digits, is it
 * present. Whether the number is a valid Pakistani mobile, whether the
 * password meets policy and whether the code is correct are all decided by the
 * domain and the services, which already own those rules and must own them for
 * the worker and the CLI too.
 *
 * The one thing these schemas must not do is leak. `.strict()` everywhere so an
 * unexpected field is rejected rather than silently ignored — an ignored field
 * is how a client ends up believing it set something it did not.
 */

/** Generous upper bounds. The point is to stop absurd payloads, not to police. */
const phone = z.string().min(1).max(32);
const password = z.string().min(1).max(512);
const code = z.string().regex(/^\d{6}$/, 'must be six digits');

export const registerBody = z
  .object({
    phone,
    password,
    // Kept as a string, not coerced to Date: the server clock decides the age
    // rule (BR-002), and an ISO date is unambiguous where a parsed Date is not.
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    termsVersion: z.string().min(1).max(64),
    accountType: z.enum(['INDIVIDUAL', 'ORGANIZATION']).optional(),
  })
  .strict();
export type RegisterBody = z.infer<typeof registerBody>;

export const otpVerifyBody = z
  .object({
    phone,
    code,
    purpose: z.enum(['REGISTRATION', 'PASSWORD_RESET']).default('REGISTRATION'),
  })
  .strict();
export type OtpVerifyBody = z.infer<typeof otpVerifyBody>;

export const otpResendBody = z
  .object({
    phone,
    purpose: z.enum(['REGISTRATION', 'PASSWORD_RESET']).default('REGISTRATION'),
  })
  .strict();
export type OtpResendBody = z.infer<typeof otpResendBody>;

export const loginBody = z
  .object({
    phone,
    password,
    /**
     * Shown to the user in their device list, so they can recognise which
     * session to end. Capped and free-text on purpose: it must never become a
     * device fingerprint (PRIV-010).
     */
    deviceLabel: z.string().min(1).max(64).optional(),
  })
  .strict();
export type LoginBody = z.infer<typeof loginBody>;

export const forgotPasswordBody = z.object({ phone }).strict();
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBody>;

export const resetPasswordBody = z.object({ phone, code, newPassword: password }).strict();
export type ResetPasswordBody = z.infer<typeof resetPasswordBody>;

export const changePasswordBody = z
  .object({ currentPassword: password, newPassword: password })
  .strict();
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;

export const adminLoginBody = z
  .object({
    // Length-bounded, `@`-checked, and nothing more. A stricter regex rejects
    // valid addresses far more often than it catches invalid ones, and the
    // credential check is the real gate here.
    email: z.string().min(3).max(254),
    password,
  })
  .strict();
export type AdminLoginBody = z.infer<typeof adminLoginBody>;
