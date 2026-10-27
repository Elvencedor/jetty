import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { getPage } from '../modules/content/content.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../testing/database.js';
import { seed } from './seed.js';
import { contentEntries } from './schema/index.js';
import { STARTER_PAGES } from './starter-pages.js';

describe('starter pages', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let t: TestDatabase;
  before(async () => {
    t = await createTestDatabase();
    await seed(t.db);
  });
  after(async () => {
    await t?.destroy();
  });

  it('publishes the factual info pages and keeps the legal ones as drafts', async () => {
    for (const page of STARTER_PAGES) {
      const live = await getPage(t.db, page.slug);
      if (page.status === 'published') assert.equal(live?.title, page.title, `${page.slug} is public`);
      else assert.equal(live, undefined, `${page.slug} stays unpublished until the owner approves it`);
    }
    assert.deepEqual(STARTER_PAGES.filter((p) => p.status === 'draft').map((p) => p.slug).sort(), ['privacy', 'terms']);
  });

  it('never overwrites a page the owner has edited, however often it runs', async () => {
    await t.db.update(contentEntries).set({ title: 'Our returns', body: { markdown: 'Ours.' } }).where(and(eq(contentEntries.contentType, 'page'), eq(contentEntries.slug, 'returns')));
    await seed(t.db);
    await seed(t.db);
    const page = await getPage(t.db, 'returns');
    assert.equal(page?.title, 'Our returns');
    assert.equal(page?.markdown, 'Ours.');
    assert.equal((await t.db.select().from(contentEntries).where(eq(contentEntries.slug, 'returns'))).length, 1);
  });
});
