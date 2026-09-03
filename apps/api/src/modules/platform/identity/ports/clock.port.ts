import { Injectable } from '@nestjs/common';

/**
 * The current time, as an injected dependency.
 *
 * Every rule in this module is a statement about time — a code expires in ten
 * minutes, a lockout lasts fifteen, a session idles out after sixty days. A
 * service that calls `new Date()` directly cannot have those rules tested
 * except by actually waiting, so in practice they go untested, which is how a
 * lockout that never lifts or an expiry that never fires reaches production.
 *
 * One small interface makes "fifteen minutes later" an assertion instead of a
 * sleep.
 */
export const CLOCK = Symbol.for('mohalla.identity.clock');

export interface Clock {
  now(): Date;
}

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test double. Starts fixed and moves only when a test says so. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(at: Date): void {
    this.current = at;
  }
}
