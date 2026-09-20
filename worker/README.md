# 留言板部署（Cloudflare Workers + D1）

完全匿名：访客不需要登录，昵称可留空。数据存在你自己的 D1 数据库里，
不引入任何第三方脚本，也不设置 Cookie——所以站点页脚那句「无追踪」不用改。

## 一、部署后端

```bash
cd worker

# 0. 安装 wrangler（只需一次）
npm install -g wrangler
wrangler login
```

**1. 建数据库**

```bash
wrangler d1 create margin_comments
```

输出里会有一行 `database_id = "xxxxxxxx-xxxx-..."`，把它填进 `wrangler.toml`。

**2. 建表**

```bash
wrangler d1 execute margin_comments --remote --file=./schema.sql
```

**3. 设置站主密钥**

```bash
wrangler secret put OWNER_KEY
```

输入一串你自己定的随机字符（越长越好）。这个密钥用来**删除留言**和**以站长身份发言**，
不要写进任何文件、也不要去进仓库。

**4. 部署**

```bash
wrangler deploy
```

成功后得到形如 `https://margin-comments.<你的子域>.workers.dev` 的地址。

## 二、接上站点

在项目根目录的 `tools/posts.json` 里填地址：

```json
"site": {
  "commentsApi": "https://margin-comments.你的子域.workers.dev"
}
```

然后重新构建并推送：

```bash
node tools/build.mjs
git add . && git commit -m "feat: 留言板" && git push
```

地址留空时，文章页的留言区会显示一行「功能还没接上后端」的提示，不会报错。

## 三、站长怎么用

1. 打开任意文章页，在地址后面加 `?ownerKey=你的密钥`，回车。
   （例如 `https://你的域名/posts/boot-log.html?ownerKey=abc123...`）
2. 密钥会记进浏览器 localStorage，地址栏自动清理干净。**只需要做一次。**
3. 之后你会多出两种能力：
   - 发言时带「站长」徽章；
   - 每条留言右侧出现「删除」按钮（会连它的回复一起标记删除）。

想退出站长模式：清掉浏览器的 localStorage（或换一个浏览器）。

## 四、防垃圾是怎么做的

匿名评论必须防机器人，这里叠了四层：

| 层 | 做法 | 效果 |
|---|---|---|
| 蜜罐字段 | 表单里有个隐藏的 `website` 输入框，机器人会填 | 直接丢弃，且假装成功（让它以为得手了） |
| 停留时长 | 表单渲染到提交不足 3 秒 | 拦掉脚本化提交 |
| 频率限制 | 按 IP 哈希：1 分钟 1 条、10 分钟 5 条 | 拦掉刷屏 |
| 长度与链接 | 正文 2–2000 字，链接不超过 2 个 | 拦掉广告长文 |

被拦下的请求一律返回明确的错误原因，前端会显示出来（比如「发得太快了，等一分钟再来」）。

**注意**：这些都是概率性防护。如果哪天真的被灌了，最快的处理方式是
`wrangler d1 execute margin_comments --remote --command "UPDATE comments SET status=0 WHERE ..."`，
或者在 Cloudflare 后台给 Worker 加一条 WAF 规则。

## 五、数据结构与隐私

```sql
comments (
  id, slug, parent_id, nick, body,
  created_at, is_owner, ip_hash, status
)
```

- **IP 只存哈希**：`SHA-256(盐 + IP)` 取前 32 位，只用于频率限制，无法反查。
- 盐取 `IP_SALT`，没设的话退化为 `OWNER_KEY`。
- 删除是**软删除**（`status = 0`），行还在，便于事后追溯；真要清理可以手动 `DELETE`。
- 不写日志、不设 Cookie、不引入第三方脚本。

## 六、接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/?slug=<slug>` | 列出某篇文章的留言（按时间正序） |
| `POST` | `/` | 新增留言 |
| `DELETE` | `/?id=<id>` | 删除（需 `x-owner-key` 头） |

POST 请求体：

```json
{ "slug": "boot-log", "parentId": null, "nick": "", "body": "内容", "website": "", "elapsed": 12 }
```

## 七、本地开发

```bash
wrangler dev --local          # 本地起一个带 D1 模拟的实例
```

本地模式记得也建一次表：

```bash
wrangler d1 execute margin_comments --local --file=./schema.sql
```
