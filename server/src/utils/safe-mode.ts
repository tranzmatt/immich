import { parse } from 'cookie';
import { ExpressionBuilder } from 'kysely';
import { ClsService, ClsServiceManager } from 'nestjs-cls';
import type { Request } from 'express';
import { DB } from 'src/schema/index.js';

// Local-only "safe mode": while the web client's cookie is on, assets tagged NSFW (or NSFW/...)
// are left out of every asset listing - timeline, albums, search, map, memories, folders.
// Scoped to the request through CLS, so background jobs and direct asset/thumbnail fetches are
// unaffected. The tag itself is applied by docker-compose/scripts/nsfw-scan.py or by hand.
export const SAFE_MODE_COOKIE = 'immich_safe_mode';
export const SAFE_MODE_TAG = 'NSFW';
const CLS_KEY = 'safeMode';

/** CLS middleware setup hook: remember whether this request asked for safe mode. */
export const setSafeMode = (cls: ClsService, req: Request) => {
  cls.set(CLS_KEY, parse(req.headers.cookie || '')[SAFE_MODE_COOKIE] === '1');
};

export const isSafeMode = () => {
  const cls = ClsServiceManager.getClsService();
  return cls.isActive() && cls.get(CLS_KEY) === true;
};

/** Use as `.$if(isSafeMode(), (qb) => qb.where(notNsfw))` on any query selecting from asset. */
export const notNsfw = (eb: ExpressionBuilder<DB, 'asset'>) =>
  eb.not(
    eb.exists(
      eb
        .selectFrom('tag_asset')
        .innerJoin('tag', 'tag.id', 'tag_asset.tagId')
        .whereRef('tag_asset.assetId', '=', 'asset.id')
        .where((eb) => eb.or([eb('tag.value', '=', SAFE_MODE_TAG), eb('tag.value', 'like', `${SAFE_MODE_TAG}/%`)])),
    ),
  );
