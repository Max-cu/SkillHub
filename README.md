# SkillHub

Find what you need. Or just look around.

极简 PC 技能库：搜索、收藏、标准 ZIP 发布、不可变版本、原包下载、API Key，以及带胶带便签的留言白板。React + GSAP；UI 与外部程序调用同一套 REST API。发布只接收 ZIP，永不支持 GitHub 导入、URL 或直接 Markdown 发布。

## API 快速开始

接口前缀 `/api/v1`。以下示例使用 Bash/curl；Windows 请用 `curl.exe`，或使用下方 PowerShell 示例。`BASE` 替换为自己的 SkillHub 地址。

```bash
export BASE="http://127.0.0.1:3356"

# 健康检查、工作区信息和 OpenAPI 契约
curl -fsS "$BASE/api/v1/health"
curl -fsS "$BASE/api/v1/meta"
curl -fsS "$BASE/api/v1/openapi.json" -o openapi.json

# 搜索、分类、分页
curl -fsS --get "$BASE/api/v1/skills" \
  --data-urlencode "q=react" --data-urlencode "category=development" \
  --data-urlencode "offset=0" --data-urlencode "limit=12"

# 发布标准 ZIP
curl -fsS "$BASE/api/v1/skills" \
  -F "file=@my-skill.zip" -F "version=1.0.0" \
  -F "category=development" -F "license=MIT" \
  -F 'agents=["codex","claude-code"]' -F 'tags=["example"]'

# 用发布响应的 data.id 替换 my-skill
curl -fsS "$BASE/api/v1/skills/my-skill"
curl -fsS "$BASE/api/v1/skills/my-skill/versions"
curl -fsS "$BASE/api/v1/skills/my-skill/package?version=1.0.0"
curl -fsS "$BASE/api/v1/skills/my-skill/file?version=1.0.0" -o SKILL.md
curl -fsS "$BASE/api/v1/skills/my-skill/download?version=1.0.0" -o my-skill-1.0.0.zip

# 收藏与取消收藏，幂等
curl -fsS -X PUT "$BASE/api/v1/skills/my-skill/favorite"
curl -fsS "$BASE/api/v1/skills?favorites=true"
curl -fsS -X DELETE "$BASE/api/v1/skills/my-skill/favorite"

# 发布更高版本，不覆盖已发布版本
curl -fsS "$BASE/api/v1/skills" \
  -F "file=@my-skill-new.zip" -F "id=my-skill" \
  -F "version=1.1.0" -F "changelog=Add reference files"
```

版本使用数字 `x.y.z` 比较，`1.10.0` 高于 `1.9.0`。同一 ID 必须属于当前工作区。原始 ZIP、脚本和资源逐字节保存，计算 SHA-256，历史版本可下载。

### 响应与错误

JSON 成功响应为 `{ "data": ... }`；列表的 data 包含 `items / total / offset / limit / nextOffset`。最后一页 `nextOffset=null`。错误形如：

```json
{"error":{"code":"version_conflict","message":"新版本必须高于当前版本；已发布版本不可覆盖"}}
```

原文、ZIP 和 OpenAPI 直接返回文本、文件或契约，不使用 data 包装。`/file` 返回 `X-Skill-Digest`，`/download` 返回 `X-Package-Digest`，均有 ETag。摘要格式为 `sha256:<hex>`。

| HTTP | 含义 |
| --- | --- |
| 400 | 参数、ZIP 结构、内容或分页无效 |
| 401 | 未启用工作区或 Key 无效/已撤销 |
| 403 | 只读 Key 写入、非所有者、跨站写入或 Key 管理权限不符 |
| 404 | 技能、版本、留言、Key 或接口不存在 |
| 409 | 版本冲突或 Key 数量达到上限 |
| 413 | 请求或 ZIP 过大 |
| 415 | 发布不是 multipart ZIP，或 JSON 接口媒体类型错误 |
| 500 / 503 | 服务错误或数据库不可用 |

### 接口目录

所有路径相对 `/api/v1`。完整契约 `GET /api/v1/openapi.json` 可导入 Postman 等工具。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 数据库健康检查 |
| GET | `/meta` | 分类、计数、workspace、loginConfigured 和当前身份 |
| GET | `/openapi.json` | OpenAPI 3.1 |
| GET / POST | `/skills` | 搜索、过滤、分页 / ZIP 发布与新版本 |
| GET | `/skills/{id}` | 最新版本详情及 SKILL.md |
| GET | `/skills/{id}/versions` | 不可变版本记录 |
| GET | `/skills/{id}/file?version=` | 指定版本 SKILL.md |
| GET | `/skills/{id}/package?version=` | 包大小、文件清单、摘要及 kind |
| GET | `/skills/{id}/download?version=` | 指定版本完整原包 |
| PUT / DELETE | `/skills/{id}/favorite` | 收藏 / 取消收藏 |
| GET | `/package-template` | 可发布的标准示例 ZIP |
| GET / POST | `/keys` | 查看 Key 元数据 / 创建 Key |
| DELETE | `/keys/{id}` | 撤销 Key |
| GET / POST | `/messages` | 留言列表 / 发布便签 |
| GET | `/messages/{id}` | 全文、署名和白板位置 |

`GET /skills` 支持 `q`、`category`、`favorites=true`、`offset`（默认 0）、`limit`（默认 24，1–100）、`agent`、`sort`。category 为 `development / design / productivity / testing / documentation`；agent 为 `claude-code / codex / cursor / gemini-cli`；sort 为 `featured / newest / name / compact`。Agent / 排序仅为 API 参数，不显示 UI 筛选。`version` 不传时读取最新版。

### ZIP 上传字段与格式

| 字段 | 规则 / 默认值 |
| --- | --- |
| `file` | 必填，一个标准 `.zip` |
| `id` | 默认为 frontmatter.name；更新时指定已有 ID |
| `version` | `x.y.z`，默认 `0.1.0` |
| `category` | 上述五种分类，默认 `development` |
| `license` | 发布者声明，默认 `Unspecified` |
| `agents` | JSON 数组字符串，默认四种 Agent 标签 |
| `tags` | JSON 字符串数组，默认 `[]` |
| `description` | 可选，覆盖 frontmatter.description |
| `changelog` | 可选版本说明 |

包根目录或单一顶层文件夹中必须恰好有一个 `SKILL.md`；可附带脚本、参考和资源：

```text
my-skill/
  SKILL.md
  scripts/example.py
  references/guide.md
  assets/example.json
```

SKILL.md 使用 UTF-8 和 YAML frontmatter：

```markdown
---
name: my-skill
description: Explain what this skill does and when to use it.
---

# My Skill

Complete the task and verify the result.
```

name 使用小写字母、数字和短横线；description 为 5–2000 字符。ZIP 最大 5 MiB、最多 200 条目、展开合计最大 20 MiB、单文件最大 5 MiB、SKILL.md 最大 150 KB。支持 Store / Deflate；拒绝加密、ZIP64、分卷、符号链接、路径穿越、重复路径、Windows 不安全名称及大小/CRC 不匹配。校验不执行包内脚本。

### 留言白板 API

```bash
curl -fsS "$BASE/api/v1/messages?offset=0&limit=12"
curl -fsS "$BASE/api/v1/messages" -H 'Content-Type: application/json' \
  --data '{"content":"A thought worth keeping.","author":"Alex","color":"yellow","position":{"x":0.35,"y":0.6}}'
curl -fsS "$BASE/api/v1/messages/MESSAGE_ID"
```

`content` 必填，1–2000 字符；`author` 可选，最多 24 字符，空署名显示“匿名访客”，只是显示名称，不是登录身份。`color` 可选 `yellow / blue / pink / green`，默认 yellow。`position` 可选，x/y 均为 0–1，响应保留位置；省略时 position 为 null，由 UI 自动排布。列表按时间倒序，默认 12 条、最多 100 条。

点击白板空白处编辑，铅笔笔尖为点击点；点击便签查看全文。聚焦白板后按 Enter / 空格也可创建便签。内容以纯文本显示，刷新或重启后保留。

### API Key 与身份模型

登录目前为占位，`loginConfigured=false`。loopback 默认使用固定 `local-workspace` 身份；服务器仅在管理员显式配置的 `SKILLHUB_WORKSPACE_ORIGINS` 地址启用同一共享工作区。**共享部署的访问者无需登录即可发布、留言、修改共享收藏和管理 Key，没有用户隔离。请用于可信内网；API Key 不是整个站点的登录或访问控制。**

```bash
# 创建：data.token 只在此时返回，保存后不要提交到 Git
curl -fsS "$BASE/api/v1/keys" -H 'Content-Type: application/json' \
  --data '{"name":"my-integration","scope":"write"}'
export SKILLHUB_API_KEY="sg_REPLACE_WITH_RETURNED_TOKEN"

curl -fsS "$BASE/api/v1/skills" -H "Authorization: Bearer $SKILLHUB_API_KEY"
curl -fsS "$BASE/api/v1/messages" \
  -H "Authorization: Bearer $SKILLHUB_API_KEY" -H 'Content-Type: application/json' \
  --data '{"content":"Posted through the API","color":"blue"}'

# 管理 Key 从工作区入口调用，不携带另一个 Bearer Key
curl -fsS "$BASE/api/v1/keys"
curl -fsS -X DELETE "$BASE/api/v1/keys/KEY_ID"
```

scope 为 `read`（默认）或 `write`（含读取）；每个工作区最多 20 个 Key。数据库只保存单向摘要；列表不返回 token；撤销立即失效。携带 Authorization 时始终验证 Key，不回退到免登录身份。Bearer Key 不可管理其他 Key。

浏览器免登录写操作校验同源 Origin，并拒绝 `Sec-Fetch-Site: cross-site`；CLI 无需 Cookie 或 Origin。服务不信任 `oai-authenticated-user-*` 身份头，不提供跨源 CORS。GitHub 导入、recipes 和 recommendations 接口不存在。

### PowerShell 示例

```powershell
$base = 'http://127.0.0.1:3356'
Invoke-RestMethod "$base/api/v1/skills?q=react&limit=12"
curl.exe -fS "$base/api/v1/skills" -F "file=@C:/skills/my-skill.zip" -F "version=1.0.0"
Invoke-RestMethod -Method Put "$base/api/v1/skills/my-skill/favorite"
$note = @{content='一个想法';author='小林';color='green';position=@{x=0.4;y=0.5}} | ConvertTo-Json
Invoke-RestMethod -Method Post "$base/api/v1/messages" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($note))
```

## 本机开发

需要 Node.js >= **22.13**，建议 Node 22 LTS。无需 Sites、Cloudflare 账号或云端数据库。全新克隆：

```bash
git clone https://github.com/Max-cu/SkillHub.git
cd SkillHub
npm ci
npm run build
npm run db:migrate
npm run dev -- --hostname 127.0.0.1
```

开发地址 `http://127.0.0.1:5173/`；`npm start` 启动编译版，默认 `http://127.0.0.1:3356/`。开发和默认编译版共享 `.wrangler/state/`。迁移命令记录已执行 SQL，重跑只应用未执行的迁移。

旧开发工作区曾手工执行 SQL 的数据库没有自动迁移记录，勿重新应用全部迁移；先备份并核对 schema。全新克隆和 Docker 部署使用自动迁移记录。

## Docker 自托管

需要 Docker 和 Docker Compose。默认端口 3356，使用独立容器和数据卷：

```bash
cp deploy.env.example .env
# 编辑 .env：填写实际服务器 origin，必须匹配协议、主机和端口，无尾部斜杠。
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 skillhub
```

`SKILLHUB_WORKSPACE_ORIGINS` 可用逗号分隔多个明确的地址，不接受通配符。这个配置只是共享工作区入口，没有登录保护。`.env` 不提交到 Git。

容器使用非 root 用户，提供编译后的页面，没有 Vite HMR；启动自动应用未执行迁移。`skillhub-data` 数据卷保存数据库、上传包、版本、收藏、留言和 Key。容器自动重启，有健康检查和日志限制。

```bash
# 更新不删除数据
git pull --ff-only
docker compose up -d --build

# 备份：短暂停服务，复制完整数据卷
mkdir -p backups
docker compose stop skillhub
docker compose run --rm --no-deps --user root \
  -v "$PWD/backups:/backup" skillhub \
  tar -czf /backup/skillhub-data.tar.gz -C /data .
docker compose start skillhub
```

不要运行 `docker compose down -v`，它会删除数据。恢复时停止服务，把备份解压回同一数据卷，再启动。数据库 ID 和持久化路径不能在常规更新中任意更换。

网络受限时可在 `.env` 设置 `NODE_IMAGE / NPM_REGISTRY` 镜像源，仍保留包锁完整性和 TLS 校验。原生启动支持 `SKILLHUB_PORT / SKILLHUB_HOST / SKILLHUB_DATA_DIR / SKILLHUB_WORKSPACE_ORIGINS`。

自托管使用 Miniflare/Workerd 的本地 Worker + D1 兼容运行模式（Wrangler 仅负责迁移），数据是服务器上的 SQLite 文件，不使用云端 D1。这不是官方生产托管方案；当前面向内网共享服务，Vinext 仍为 beta。以后接入公网或正式认证时，应选择对应运行时和认证方案。

## 验证与许可

```bash
npm run typecheck
npm test
npm run build
# 在 loopback 开发服务上执行 API 回归，会生成测试技能/留言
node tests/api-integration.mjs
node tests/board-integration.mjs
```

测试覆盖 ZIP 资源与完整性、路径与大小、版本、便签、来源白名单，以及原包下载、并发发布、收藏、Key 权限、跨站限制、留言持久化和分页。API 回归仅允许 loopback，清理文件写入忽略的 `outputs/`。

7 个静态公开 SKILL.md 快照用于演示，不联网同步，也不是完整上游包；其 ZIP 只含 SKILL.md，`package.kind=catalog-markdown`，用户上传包为 `uploaded`。适用 Agent 和许可证由发布者声明；网页不执行技能、不安装到本机 Agent 目录。

应用代码采用 [MIT](LICENSE)。上游快照与第三方代码保留原许可，见 [上游许可](docs/UPSTREAM-LICENSES.md)、[调研记录](docs/RESEARCH.md) 和 `build/sites-vite-plugin.LICENSE`。天辰公司和 SkillGo 的 Logo/商标不属于 MIT 软件授权，权利归各自所有者。仓库不包含用户数据库、API Key、SSH 凭据、私有 Sites 标识或本机测试产物。
