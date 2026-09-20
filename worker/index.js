/* ==========================================================================
   余量 MARGIN — 独立 Worker 入口（备用）
   --------------------------------------------------------------------------
   站点实际用的是 Pages Function（functions/api/[[path]].js），同源、不依赖 workers.dev。
   这个独立 Worker 留着做备用入口：比如此域名之外的调用、或者 Pages 出问题时的应急。
   逻辑全在 comments-core.js，两处共用同一份实现，不会走偏。

   部署：cd worker && wrangler deploy
     → https://margin-comments.<子域>.workers.dev
   注意 wrangler.toml 里必须显式写 workers_dev = true，
   否则一旦文件里出现 routes，这个入口会被静默关掉。
   ========================================================================== */

import { handle } from './comments-core.js';

export default {
  fetch: (request, env) => handle(request, env),
};
