-- 余量 MARGIN — 留言板表结构
-- 执行：wrangler d1 execute margin_comments --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL,              -- 属于哪篇文章
  parent_id   INTEGER,                       -- 回复的目标；NULL 表示顶层
  nick        TEXT    NOT NULL DEFAULT '',   -- 可留空，前端显示为「匿名」
  body        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,              -- Unix 毫秒
  is_owner    INTEGER NOT NULL DEFAULT 0,    -- 站长发言，前端加徽章
  ip_hash     TEXT    NOT NULL DEFAULT '',   -- 只存哈希，用于频率限制，不存原始 IP
  status      INTEGER NOT NULL DEFAULT 1     -- 1 正常 / 0 已删除（保留行以便追溯）
);

CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments (slug, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_ip   ON comments (ip_hash, created_at);
