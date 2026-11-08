import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apiError, badRequest, codeForStatus, conflict, forbidden, fromJoi, notFound, unauthenticated, unprocessable } from './errors.js';

const data = (e: ReturnType<typeof apiError>) => e.data as { code: string; details?: unknown[] };

describe('domain errors', () => {
  it('apiError carries the status, message and stable code', () => {
    const e = apiError(418, 'TEAPOT', 'short and stout', [{ a: 1 }]);
    assert.equal(e.output.statusCode, 418);
    assert.equal(e.output.payload.message, 'short and stout');
    assert.deepEqual(data(e), { code: 'TEAPOT', details: [{ a: 1 }] });
  });

  it('has a helper per contract status with the documented code', () => {
    const cases: [ReturnType<typeof apiError>, number, string][] = [
      [badRequest('x'), 400, 'BAD_REQUEST'],
      [unauthenticated(), 401, 'UNAUTHENTICATED'],
      [forbidden(), 403, 'FORBIDDEN'],
      [notFound(), 404, 'NOT_FOUND'],
      [conflict('STOCK', 'x'), 409, 'STOCK'],
      [unprocessable('NOPE', 'x'), 422, 'NOPE'],
    ];
    for (const [err, status, code] of cases) {
      assert.equal(err.output.statusCode, status);
      assert.equal(data(err).code, code);
    }
  });

  it('uses friendly default messages', () => {
    assert.match(unauthenticated().message, /Authentication/);
    assert.match(forbidden().message, /access/);
    assert.match(notFound().message, /does not exist/);
    assert.equal(notFound('Gone.').message, 'Gone.');
  });

  it('fromJoi maps validation details to a 422 with dotted paths', () => {
    const e = fromJoi({ details: [{ path: ['items', 0, 'quantity'], type: 'number.min', message: 'too small' }] });
    assert.equal(e.output.statusCode, 422);
    assert.equal(data(e).code, 'VALIDATION_FAILED');
    assert.deepEqual(data(e).details, [{ path: 'items.0.quantity', code: 'number.min', message: 'too small' }]);
  });

  it('fromJoi accepts a custom message', () => {
    assert.equal(fromJoi({ details: [] }, 'Bad settings.').message, 'Bad settings.');
  });
});

describe('codeForStatus', () => {
  it('maps known statuses', () => {
    assert.equal(codeForStatus(400), 'BAD_REQUEST');
    assert.equal(codeForStatus(401), 'UNAUTHENTICATED');
    assert.equal(codeForStatus(405), 'METHOD_NOT_ALLOWED');
    assert.equal(codeForStatus(413), 'PAYLOAD_TOO_LARGE');
    assert.equal(codeForStatus(415), 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(codeForStatus(429), 'RATE_LIMITED');
  });
  it('falls back to INTERNAL_ERROR for 5xx and REQUEST_FAILED otherwise', () => {
    assert.equal(codeForStatus(500), 'INTERNAL_ERROR');
    assert.equal(codeForStatus(503), 'INTERNAL_ERROR');
    assert.equal(codeForStatus(418), 'REQUEST_FAILED');
  });
});
