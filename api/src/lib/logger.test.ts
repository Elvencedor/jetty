import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createLogger } from './logger.js';

let out: string[];
let err: string[];
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);

beforeEach(() => {
  out = [];
  err = [];
  process.stdout.write = ((chunk: string) => (out.push(String(chunk)), true)) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => (err.push(String(chunk)), true)) as typeof process.stderr.write;
});
afterEach(() => {
  process.stdout.write = realOut;
  process.stderr.write = realErr;
});

describe('logger', () => {
  it('writes one JSON line with level, time, message and fields', () => {
    createLogger('info').info('hello', { a: 1 });
    assert.equal(out.length, 1);
    assert.ok(out[0]!.endsWith('\n'));
    const line = JSON.parse(out[0]!);
    assert.equal(line.level, 'info');
    assert.equal(line.msg, 'hello');
    assert.equal(line.a, 1);
    assert.ok(!Number.isNaN(Date.parse(line.time)));
  });

  it('sends warn and error to stderr, the rest to stdout', () => {
    const log = createLogger('debug');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    assert.equal(out.length, 2);
    assert.equal(err.length, 2);
  });

  it('suppresses messages below the threshold', () => {
    const log = createLogger('warn');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    assert.equal(out.length, 0);
    assert.equal(err.length, 2);
  });

  it('child loggers merge bindings, and call fields override them', () => {
    const log = createLogger('info', { service: 'api' }).child({ requestId: 'r1' });
    log.info('x', { requestId: 'r2', extra: true });
    const line = JSON.parse(out[0]!);
    assert.equal(line.service, 'api');
    assert.equal(line.requestId, 'r2');
    assert.equal(line.extra, true);
  });

  it('does not leak a child binding into its parent', () => {
    const parent = createLogger('info');
    parent.child({ only: 'child' });
    parent.info('p');
    assert.equal('only' in JSON.parse(out[0]!), false);
  });
});
