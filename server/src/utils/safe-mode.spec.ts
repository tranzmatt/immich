import type { Request } from 'express';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { ClsServiceManager } from 'nestjs-cls';
import { DB } from 'src/schema/index.js';
import { isSafeMode, notNsfw, setSafeMode } from 'src/utils/safe-mode.js';

const db = new Kysely<DB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

const query = () =>
  db
    .selectFrom('asset')
    .select('asset.id')
    .$if(isSafeMode(), (qb) => qb.where(notNsfw))
    .compile().sql;

const inRequest = <T>(cookie: string | undefined, fn: () => T) => {
  const cls = ClsServiceManager.getClsService();
  return cls.run(() => {
    setSafeMode(cls, { headers: { cookie } } as Request);
    return fn();
  });
};

describe('safe mode', () => {
  it('is off outside a request (background jobs)', () => {
    expect(isSafeMode()).toBe(false);
    expect(query()).not.toContain('tag_asset');
  });

  it('is off without the cookie', () => {
    expect(inRequest(undefined, query)).not.toContain('tag_asset');
    expect(inRequest('immich_access_token=abc', query)).not.toContain('tag_asset');
  });

  it('is off when the cookie is 0', () => {
    expect(inRequest('immich_safe_mode=0', query)).not.toContain('tag_asset');
  });

  it('excludes NSFW-tagged assets when the cookie is 1', () => {
    const sql = inRequest('immich_access_token=abc; immich_safe_mode=1', query);
    expect(sql).toContain('not exists');
    expect(sql).toContain('"tag_asset"."assetId" = "asset"."id"');
    expect(sql).toMatch(/"tag"\."value" = \$1 or "tag"\."value" like \$2/);
  });
});
