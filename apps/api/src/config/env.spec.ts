import { describe, it, expect } from 'vitest';
import { DEVELOPMENT_OTP_HASH_KEY, loadEnv } from './env.js';

const base = { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db' };

describe('loadEnv', () => {
  it('refuses to start without DATABASE_URL', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL is required/);
  });

  it('never includes a configuration VALUE in the error message', () => {
    // A malformed but secret-looking value must not be echoed - startup errors
    // are logged, and logs are retained.
    try {
      loadEnv({ ...base, PORT: 'sup3r-s3cret-not-a-port' } as NodeJS.ProcessEnv);
      throw new Error('expected loadEnv to throw');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('PORT');
      expect(message).not.toContain('sup3r-s3cret-not-a-port');
    }
  });

  it('applies documented defaults', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SOCKET_IO_PATH).toBe('/realtime');
  });

  it('defaults CORS to an EMPTY allow-list, never a wildcard', () => {
    expect(loadEnv(base as NodeJS.ProcessEnv).CORS_ALLOWED_ORIGINS).toEqual([]);
  });

  it('parses and trims a comma-separated CORS list', () => {
    const env = loadEnv({
      ...base,
      CORS_ALLOWED_ORIGINS: 'https://admin.example.org , https://a.example.org',
    } as NodeJS.ProcessEnv);
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([
      'https://admin.example.org',
      'https://a.example.org',
    ]);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadEnv({ ...base, PORT: '99999' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('rejects an unknown NODE_ENV rather than guessing', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'prod' } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe('QA-005 · OTP_HASH_KEY fails closed in production', () => {
  const production = {
    ...base,
    NODE_ENV: 'production',
    // Production also needs a real identifier pepper, and QA-006 requires the
    // Terms list to be set explicitly. Both are supplied so the OTP key is the
    // only thing under test here.
    IDENTIFIER_HASH_PEPPER: 'production-identifier-pepper-0123456789',
    PUBLISHED_TERMS_VERSIONS: '',
  };
  const realKey = 'production-otp-key-abcdefghijklmnopqrstuv';

  it('K. production refuses to start on the development default', () => {
    expect(() =>
      loadEnv({ ...production, OTP_HASH_KEY: DEVELOPMENT_OTP_HASH_KEY } as NodeJS.ProcessEnv),
    ).toThrow(/OTP_HASH_KEY/);
  });

  it('K. production refuses to start when the key is simply absent', () => {
    // Absent means the schema default applies, which IS the development
    // default — so "not set" and "set to the dev value" must fail identically.
    expect(() => loadEnv(production as NodeJS.ProcessEnv)).toThrow(/OTP_HASH_KEY/);
  });

  it('K. and the refusal never prints the key', () => {
    try {
      loadEnv({ ...production, OTP_HASH_KEY: DEVELOPMENT_OTP_HASH_KEY } as NodeJS.ProcessEnv);
      throw new Error('expected loadEnv to throw');
    } catch (e) {
      expect((e as Error).message).not.toContain(DEVELOPMENT_OTP_HASH_KEY);
    }
  });

  it('K. production starts with a real key', () => {
    const env = loadEnv({ ...production, OTP_HASH_KEY: realKey } as NodeJS.ProcessEnv);
    expect(env.OTP_HASH_KEY).toBe(realKey);
  });

  it('a too-short key is refused in every environment', () => {
    expect(() => loadEnv({ ...base, OTP_HASH_KEY: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /at least 32 characters/,
    );
  });

  it('L. the development default is only ever reachable outside production', () => {
    // The fixture cannot become a production key by accident: development gets
    // it automatically, production is refused it explicitly, and the constant
    // is imported rather than retyped so the two cannot drift apart.
    expect(loadEnv(base as NodeJS.ProcessEnv).OTP_HASH_KEY).toBe(DEVELOPMENT_OTP_HASH_KEY);
    expect(DEVELOPMENT_OTP_HASH_KEY).toMatch(/not-for-production/);
  });

  it('L. and it is a different secret from the identifier pepper', () => {
    // Key separation is the requirement; sharing one secret between the ban
    // list and OTP verification would make one leak into two.
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.OTP_HASH_KEY).not.toBe(env.IDENTIFIER_HASH_PEPPER);
  });
});

describe('QA-006 · a Terms version must be one this deployment publishes', () => {
  const production = {
    ...base,
    NODE_ENV: 'production',
    IDENTIFIER_HASH_PEPPER: 'production-identifier-pepper-0123456789',
    OTP_HASH_KEY: 'production-otp-key-abcdefghijklmnopqrstuv',
  };

  it('development accepts the versions local tooling really submits', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.PUBLISHED_TERMS_VERSIONS).toContain('terms-2026-01');
    expect(env.PUBLISHED_TERMS_VERSIONS).toContain('unpublished-od-015');
  });

  it('production refuses to inherit the development list silently', () => {
    // The danger is not a wrong value, it is a value nobody chose. A
    // production deployment that quietly accepted `unpublished-od-015` would
    // be recording acceptance of a document whose name says it is unpublished.
    expect(() => loadEnv(production as NodeJS.ProcessEnv)).toThrow(/PUBLISHED_TERMS_VERSIONS/);
  });

  it('production may set it to empty, which means "refuse every registration"', () => {
    // This is the correct posture while OD-015 is unresolved, and it has to be
    // stated rather than defaulted into.
    const env = loadEnv({ ...production, PUBLISHED_TERMS_VERSIONS: '' } as NodeJS.ProcessEnv);
    expect(env.PUBLISHED_TERMS_VERSIONS).toEqual([]);
  });

  it('parses a real list, trimming and dropping blanks', () => {
    const env = loadEnv({
      ...production,
      PUBLISHED_TERMS_VERSIONS: ' terms-2027-03 , ,terms-2027-09 ',
    } as NodeJS.ProcessEnv);
    expect(env.PUBLISHED_TERMS_VERSIONS).toEqual(['terms-2027-03', 'terms-2027-09']);
  });
});
