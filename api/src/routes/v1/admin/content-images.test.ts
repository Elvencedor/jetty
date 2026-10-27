import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Server } from '@hapi/hapi';
import { createLogger } from '../../../lib/logger.js';
import { createServer } from '../../../server.js';
import { adminTestEnv, signInAdmin } from '../../../testing/admin.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../../../testing/database.js';
import { FakeStorage } from '../../../testing/fake-storage.js';

type Json = Record<string, any>;

describe('pictures on content (hero cards, story circles, tiles)', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  let api: Server;
  let bare: Server;
  const storage = new FakeStorage();
  let editor: Awaited<ReturnType<typeof signInAdmin>>;
  let support: Awaited<ReturnType<typeof signInAdmin>>;

  const call = async (method: string, url: string, payload?: Json, who = editor, server = api) => {
    const res = await server.inject({ method: method as 'GET', url: `/api/v1${url}`, ...(payload ? { payload } : {}), headers: who.headers });
    return { status: res.statusCode, body: res.result as Json };
  };

  before(async () => {
    t = await createTestDatabase();
    api = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t, storage });
    await api.initialize();
    bare = await createServer({ env: adminTestEnv(), logger: createLogger('error'), database: t });
    await bare.initialize();
    editor = await signInAdmin(t.db, api, 'content_editor');
    support = await signInAdmin(t.db, api, 'support');
  });
  after(async () => {
    await api?.stop();
    await bare?.stop();
    await t?.destroy();
  });

  it('gives content editors a signed upload under the content prefix, and nobody else', async () => {
    assert.equal((await call('POST', '/admin/media/content-upload-intents', { contentType: 'image/webp', sizeBytes: 5000 }, support)).status, 403);
    const ok = await call('POST', '/admin/media/content-upload-intents', { contentType: 'image/webp', sizeBytes: 5000 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.objectKey, /^content\/[0-9a-f-]{36}\.webp$/);
    assert.equal(ok.body.upload.method, 'PUT');
    assert.equal((await call('POST', '/admin/media/content-upload-intents', { contentType: 'application/pdf', sizeBytes: 5000 })).status, 422);
    assert.equal((await call('POST', '/admin/media/content-upload-intents', { contentType: 'image/png', sizeBytes: 50 * 1024 * 1024 })).status, 422);
    assert.equal((await call('POST', '/admin/media/content-upload-intents', { contentType: 'image/png', sizeBytes: 100 }, editor, bare)).status, 503, 'without storage configured');
  });

  it('only accepts a picture that was uploaded for content and has arrived, and returns a URL to show it', async () => {
    const intent = (await call('POST', '/admin/media/content-upload-intents', { contentType: 'image/jpeg', sizeBytes: 1000 })).body;
    const body = (key: string) => ({ contentType: 'banner', title: 'Hero', body: { headline: 'Hello', imageObjectKey: key, imageAlt: 'A wig' } });
    const notThere = await call('POST', '/admin/content', body(intent.objectKey));
    assert.deepEqual([notThere.status, notThere.body.error.code], [422, 'UPLOAD_NOT_FOUND']);
    storage.put('products/someone-elses/x.jpg');
    assert.equal((await call('POST', '/admin/content', body('products/someone-elses/x.jpg'))).status, 422, 'another prefix is refused');
    assert.equal((await call('POST', '/admin/content', body('content/../products/x.jpg'))).status, 422, 'no path tricks');

    storage.put(intent.objectKey);
    const created = await call('POST', '/admin/content', body(intent.objectKey));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.image.objectKey, intent.objectKey);
    assert.match(created.body.image.url, /^https:\/\/storage\.test\/content\//);

    const listed = (await call('GET', '/admin/content?type=banner')).body.data.find((e: Json) => e.id === created.body.id);
    assert.equal(listed.image.url, created.body.image.url, 'the list carries the URL too');
    const plain = await call('POST', '/admin/content', { contentType: 'announcement', title: 'a', body: { text: 'x' } });
    assert.equal(plain.body.image, null, 'entries without a picture say so');

    // Changing the picture is checked the same way; leaving it out of a later edit keeps what was saved only if the body repeats it.
    const swapped = await call('PATCH', `/admin/content/${created.body.id}`, { body: { headline: 'Hello', imageObjectKey: 'content/not-uploaded.jpg' } });
    assert.equal(swapped.status, 422);
  });
});
