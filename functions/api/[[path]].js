/* ==========================================================================
   余量 MARGIN — 留言板 API（Pages Function，站点主入口）
   --------------------------------------------------------------------------
   为什么用 Pages Function 而不是独立 Worker：
     1) **同源**：地址就是 /api/*，和站点同一个域名，不需要 CORS、没有预检往返；
     2) **不依赖 workers.dev**：workers.dev 在部分网络会被拦截，前端会报
        "Failed to fetch"（这正是当初换过来的原因）；
     3) **不需要额外权限**：随站点一起部署，不用 zone 级的 Workers Routes / DNS 权限。

   路径：functions/api/[[path]].js 里的 [[path]] 是可选的全捕获，
   所以 /api/ 和 /api/anything 都会进到这里。核心逻辑不依赖路径，只看方法。

   逻辑与独立 Worker 共用 worker/comments-core.js，单一实现。
   D1 绑定 DB 需要在 Pages 项目的 Production（以及 Preview）环境里配置。
   ========================================================================== */

import { handle } from '../../worker/comments-core.js';

export const onRequest = ({ request, env }) => handle(request, env);
