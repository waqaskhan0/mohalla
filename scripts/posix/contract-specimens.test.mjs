import assert from 'node:assert/strict';
import test from 'node:test';
import { makeContractSpecimens, sanitizeSpecimen } from './contract-specimens.mjs';

test('published specimens retain types but cannot retain free text or credentials', () => {
  const privateValue = 'synthetic-sensitive-value-never-publish';
  const value = sanitizeSpecimen({
    token: privateValue,
    body: privateValue,
    displayName: privateValue,
    email: privateValue,
    phone: privateValue,
    dateOfBirth: '1990-02-03T00:00:00.000Z',
    metadata: { [privateValue]: privateValue },
    action: privateValue,
    state: 'ACTIVE',
    status: 'AUTHENTICATED',
    id: '29a2684c-d692-4ad9-9f07-3f0e6fffd468',
    enabled: true,
    count: 12,
    absent: null,
  });
  assert.equal(JSON.stringify(value).includes(privateValue), false);
  assert.equal(value.status, 'AUTHENTICATED');
  assert.equal(value.state, 'ACTIVE');
  assert.equal(value.dateOfBirth, '2030-01-01T00:00:00.000Z');
  assert.equal(value.enabled, true);
  assert.equal(value.absent, null);
  assert.equal(typeof value.count, 'number');
});

test('route normalization removes identifiers and never invents unknown operations', () => {
  const sample = {
    method: 'GET',
    path: '/users/synthetic-private-identifier',
    status: 200,
    body: { userId: 'synthetic-private-identifier', displayName: 'synthetic-private-name' },
  };
  const spec = { paths: { '/users/{id}': { get: {} } } };
  const result = makeContractSpecimens([sample, sample, { ...sample, method: 'POST' }], spec);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, '/users/{id}');
  assert.equal(JSON.stringify(result).includes('synthetic-private'), false);
});
