import { describe, it, expect } from 'vitest';
import { resolveDryRun } from './account-erasure.job.js';

/**
 * The safety catch on the only irreversible job in the system.
 *
 * Small enough to look obvious, which is why it is worth a test of its own: the
 * whole guarantee is a boolean's default, and a boolean's default is exactly
 * the kind of thing a later refactor flips without noticing.
 */
describe('the erasure job defaults to doing nothing', () => {
  it('A PAYLOAD THAT SAYS NOTHING IS A DRY RUN', () => {
    // An omitted flag on a destructive job must mean "rehearse". Anything else
    // makes a mistyped or empty payload — from a retry, a manual enqueue, a
    // future caller — into a real erasure.
    expect(resolveDryRun({}, {})).toBe(true);
  });

  it('erases only when the payload states it', () => {
    // The scheduled sweep in main.ts passes this explicitly. It is one line,
    // in one place, that somebody can read and question.
    expect(resolveDryRun({ dryRun: false }, {})).toBe(false);
  });

  it('treats an explicit dry run as a dry run', () => {
    expect(resolveDryRun({ dryRun: true }, {})).toBe(true);
  });
});

describe('the environment catch runs ONE WAY (ADR-019 — dry-run in staging first)', () => {
  it('FORCES A REHEARSAL OVER A PAYLOAD THAT ASKED TO ERASE', () => {
    // Staging usually points at a restored copy of production data. The
    // guarantee worth having is that one environment variable makes the box
    // harmless no matter what any payload, retry or operator asks for.
    expect(resolveDryRun({ dryRun: false }, { ACCOUNT_ERASURE_DRY_RUN: true })).toBe(true);
  });

  it('CANNOT MAKE A TICK DESTRUCTIVE ON ITS OWN', () => {
    // Unsetting the catch is not permission. The payload still has to say so,
    // so no environment change alone can turn a quiet worker into an erasing
    // one — which is the failure mode a deploy misconfiguration would cause.
    expect(resolveDryRun({}, { ACCOUNT_ERASURE_DRY_RUN: false })).toBe(true);
    expect(resolveDryRun({}, {})).toBe(true);
  });

  it('is the only combination that erases: catch off AND payload explicit', () => {
    expect(resolveDryRun({ dryRun: false }, { ACCOUNT_ERASURE_DRY_RUN: false })).toBe(false);
  });
});
