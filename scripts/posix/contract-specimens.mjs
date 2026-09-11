import { writeFileSync } from 'node:fs';

// Preserve transport discriminants, never free text or credentials. Everything
// else is replaced, even on the synthetic smoke database, before publication.
const DISCRIMINANTS = new Set([
  'status',
  'state',
  'accountType',
  'capability',
  'eventType',
  'requestState',
  'targetType',
  'maxSeverity',
  'kind',
  'type',
  'outcome',
  'actorType',
  'entityType',
  'action',
  'language',
  'locale',
  'response',
  'key',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeSpecimen(value, key = '') {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 0 ? 0 : 1;
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return '2030-01-01T00:00:00.000Z';
    if (/token|secret|password|otp/i.test(key)) return 'synthetic-contract-credential-not-valid';
    if (
      /token|secret|password|otp|phone|email|birth|name|body|reason|title|description/i.test(key)
    ) {
      return /email/i.test(key) ? 'synthetic@example.invalid' : 'synthetic';
    }
    if (UUID.test(value)) return '00000000-0000-4000-8000-000000000001';
    if (DISCRIMINANTS.has(key) && /^(?:[A-Z_]{1,24}|en|ur|ok|accepted)$/.test(value)) return value;
    return value === '' ? '' : 'synthetic';
  }
  if (Array.isArray(value)) {
    return [
      ...new Map(
        value.map((item) => {
          const sanitized = sanitizeSpecimen(item, key);
          return [JSON.stringify(sanitized), sanitized];
        }),
      ).values(),
    ];
  }
  return Object.fromEntries(
    Object.entries(value).map(([field, item]) => [
      /^[A-Za-z][A-Za-z0-9_]*$/.test(field) ? field : 'synthetic',
      sanitizeSpecimen(item, field),
    ]),
  );
}

/** Runtime examples, not a second hand-maintained API schema. */
export function makeContractSpecimens(samples, openapi) {
  const paths = Object.keys(openapi.paths).sort(
    (a, b) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0),
  );
  const unique = new Map();
  for (const sample of samples) {
    const path = paths.find((path) => {
      if (!openapi.paths[path][sample.method.toLowerCase()]) return false;
      const pattern = path
        .split(/(\{[^}]+\})/)
        .map((part) =>
          part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        )
        .join('');
      return new RegExp(`^${pattern}$`).test(sample.path);
    });
    if (!path) continue;
    const specimen = {
      method: sample.method,
      path,
      status: sample.status,
      body: sanitizeSpecimen(sample.body),
    };
    unique.set(JSON.stringify(specimen), specimen);
  }
  return [...unique.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function writeContractSpecimens(path, samples, openapi) {
  const specimens = makeContractSpecimens(samples, openapi);
  writeFileSync(path, JSON.stringify(specimens, null, 2) + '\n');
  return specimens.length;
}

export function captureContractResponses(fetchImpl, samples) {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const url = new URL(typeof input === 'string' ? input : input.url);
      samples.push({
        method: init?.method ?? 'GET',
        path: url.pathname,
        status: response.status,
        body: await response.clone().json(),
      });
    }
    return response;
  };
}
