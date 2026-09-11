import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { ZodType } from 'zod';
import * as schemas from './schemas';

test('real backend responses parse with the production Admin schemas', () => {
  const samples = JSON.parse(
    readFileSync(
      process.env.MOHALLA_CONTRACT_FIXTURES ??
        '../../packages/contracts/fixtures/http-responses.json',
      'utf8',
    ),
  ) as {
    method: string;
    path: string;
    body: unknown;
  }[];
  const routes: [string, RegExp, ZodType][] = [
    ['POST', /^\/admin\/login$/, schemas.adminLoginResultSchema],
    ['GET', /^\/admin\/dashboard$/, schemas.dashboardCountsSchema],
    ['GET', /^\/admin\/moderation\/queue$/, schemas.queuePageSchema],
    ['GET', /^\/admin\/moderation\/cases\/[^/]+$/, schemas.caseDetailSchema],
    ['GET', /^\/admin\/moderation\/cases\/[^/]+\/conversation$/, schemas.conversationExcerptSchema],
    ['POST', /^\/admin\/moderation\/cases\/[^/]+\/(restore|delete|no-action)$/, schemas.caseSchema],
    ['GET', /^\/admin\/users\/search$/, schemas.userSearchResultSchema],
    ['GET', /^\/admin\/users\/[^/]+\/sensitive$/, schemas.sensitiveUserViewSchema],
    ['GET', /^\/admin\/users\/[^/]+$/, schemas.adminUserViewSchema],
    ['POST', /^\/admin\/users\/[^/]+\/(suspend|ban|reinstate)$/, schemas.enforcementResultSchema],
    ['GET', /^\/admin\/announcements\/allowance$/, schemas.broadcastAllowanceSchema],
    ['POST', /^\/admin\/announcements$/, schemas.announcementPublishedSchema],
    ['GET', /^\/admin\/audit-log$/, schemas.auditLogPageSchema],
  ];
  const covered = new Set<ZodType>();
  const failures: string[] = [];
  for (const sample of samples) {
    const route = routes.find(
      ([method, path]) => method === sample.method && path.test(sample.path),
    );
    if (!route) continue;
    const parsed = route[2].safeParse(sample.body);
    if (parsed.success) covered.add(route[2]);
    else
      failures.push(
        `${route[0]} ${route[1]}: ${parsed.error.issues.map((i) => i.path.join('.')).join(',')}`,
      );
  }
  expect(failures).toEqual([]);
  expect(covered.size).toBe(routes.length);
});
