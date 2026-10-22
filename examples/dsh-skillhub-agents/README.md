# SkillHub Agent 客户端（ChemBuddy / DeepSeek Harness）

这个目录是可装进 ChemBuddy 的 `dsh.bundle`。ChemBuddy 基于 deepseek-harness（插件即一切 / Cordis）。插件用 SkillHub HTTP API 和 Bearer `sg_` Key **拉取**当前账号的 Agent，再注册成桌面里的 agent preset。

方向只有一条：ChemBuddy 调用 SkillHub。SkillHub 不回调 ChemBuddy。本轮不接 MCP，也不调用 `POST /api/v1/agents/{id}/invoke`。人设和技能在本机运行。

## 依赖

- 已安装的 ChemBuddy，或公开的 `dsh` CLI（Node.js ≥ 22.13）
- Profile 里已经启用 agent preset 注册表（服务名 `agentPresets`）。公开 harness 里这是 `@deepseek-ai/dsh-agent-preset-registry`
- 能访问 SkillHub，默认 `http://10.2.14.138:3356`

## 安装

在 SkillHub 仓库里执行（把 `<name>` 换成 ChemBuddy 正在使用的 profile；公开 harness 文档里的桌面示例常用 `web`）：

```sh
dsh plugin --profile <name> add /path/to/SkillHub/examples/dsh-skillhub-agents
```

`package.json` 声明了 `dsh.bundle.patch`，所以这条命令会把 `dsh-skillhub-agents` 加进该 profile 的 bundle 列表，并应用 `cordis.patch.yml` 里的插件行。装完后重启 ChemBuddy / `dsh --profile <name>`。

确认层已经叠上：

```sh
dsh --profile <name> --dump-config
```

输出里应能看到 `dsh-skillhub-agents`，以及行 id `skillhub-agents`。

## API Key

1. 浏览器登录 SkillHub（`http://10.2.14.138:3356/`）。
2. 打开「开发者 API」，创建 Key。读取自己的 Agent 和技能原文，**只读 Key 就够**。写权限只在调用 `invoke` 时需要，本插件不调用它。
3. Key 只显示一次，形如 `sg_…`。不要写进仓库，也不要发到聊天记录。

## 配置

Cordis 按行替换整个 `config`，不会把字段合并进已有行。在 profile 的 `cordis.patch.yml`（`$DSH_HOME/profiles/<name>/cordis.patch.yml`，ChemBuddy 若把 home 放在别处，以该安装为准）写上完整一行：

```yaml
- id: skillhub-agents
  name: dsh-skillhub-agents
  config:
    baseUrl: http://10.2.14.138:3356
    apiKey: sg_替换成你的密钥
    refreshIntervalMs: 0
```

| 字段 | 含义 |
| --- | --- |
| `baseUrl` | SkillHub 根地址，不含 `/api/v1`。默认 `http://10.2.14.138:3356` |
| `apiKey` | 以 `sg_` 开头的 Key。留空时插件只告警，不发请求 |
| `refreshIntervalMs` | 重新拉取的间隔（毫秒）。`0` 表示只在启动时拉一次 |
| `personaPackage` | 可选。人设插件包名，默认见下表 |
| `skillFilesystemPackage` | 可选。技能目录插件包名，默认见下表 |

改完配置后重启 profile。本包不另做设置页；ChemBuddy 若把 schemastery 配置画进设置，也会出现这几项。

## 启动后做什么

1. `GET {baseUrl}/api/v1/agents?scope=mine`，按 `nextOffset` 翻页。
2. 对每个 Agent `GET {baseUrl}/api/v1/agents/{id}`。
3. 对 `config.skills[]` 里每个技能 `GET {baseUrl}/api/v1/skills/{skillId}/file`，带了 `version` 才加 `?version=`。某个技能失败就跳过它，不丢掉整个 Agent。
4. 调用 `ctx.agentPresets.register`。preset id 为 `skillhub:` 加 Agent id。`plugins` 里：
   - `persona`：`config.prefix` 是 Agent 的 `config.persona`，选中该 preset 后这段文字进入系统提示。
   - 有技能原文时再挂 `skill-filesystem`：原文写到 `os.tmpdir()/dsh-skillhub-agents/<agentId>/<skillId>[-version]/SKILL.md`，`customSkillDirs` 指向该 Agent 目录。已有 YAML frontmatter 的原文原样保存；没有 frontmatter 时补上 harness 能扫描的 `name` 和 `description`。
5. 插件 dispose 时调用 register 返回的 unregister，并删掉上述临时目录。

列表接口失败时保留已经注册的 preset。不读取、不请求 Agent 的 `upstreamUrl`。

技能要被 `@deepseek-ai/dsh-skill-filesystem` 收进目录，frontmatter 的 `name` 须是 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`），并且有 `description`。显示名不是这种格式时，harness 会忽略该文件；把 SKILL.md 的 `name` 改成 slug 后再上传即可。

## 包名映射

插件字符串和 peerDependencies 使用公开 harness 的包名。ChemBuddy 如果换了包名，用配置里的两个字段改 preset 行上的 `name`，并在本机让同名服务 `agentPresets` 仍然可用。不要改 SkillHub 服务端来迁就桌面的包名。

| 作用 | 公开包名 |
| --- | --- |
| 插件运行时 | `@deepseek-ai/cordis` |
| 配置 schema | `@deepseek-ai/schemastery` |
| `ctx.agentPresets.register` | `@deepseek-ai/dsh-agent-preset-registry` |
| 人设行，`config.prefix` | `@deepseek-ai/dsh-persona` |
| 技能目录，`customSkillDirs` | `@deepseek-ai/dsh-skill-filesystem` |

`inject` 必须是数组 `['agentPresets']`。写成 `{ required, optional }` 时，loader 会把键当成服务名，整个 profile 起不来。

## 验收

1. `dsh plugin --profile <name> add` 成功，`--dump-config` 里有 `skillhub-agents`，`baseUrl` 指向 SkillHub。
2. 在 SkillHub 网页用同一账号建一个 Agent，写好人设，并引用一个自己能读的技能。
3. 重启 ChemBuddy。Agent 列表里出现该 Agent（preset id `skillhub:<agent id>`，名称与 SkillHub 一致）。
4. 选中它之后，系统提示里有 `config.persona` 的原文。
5. 临时目录里有对应的 `SKILL.md`。技能接口返回 404 时，Agent 仍在，只是没有那一项技能。
6. 抓包或看日志：只有 `GET /api/v1/agents`、`GET /api/v1/agents/{id}`、`GET /api/v1/skills/{id}/file`。没有 `POST /api/v1/agents/{id}/invoke`。
7. 退出或卸下插件后，这些 preset 从列表消失。

## 测试

不访问 `10.2.14.138`。在仓库根目录：

```sh
node --test examples/dsh-skillhub-agents/test/*.test.js
```

覆盖列表分页、Bearer 头、技能失败隔离、preset 形状、临时 `SKILL.md`、dispose 注销，以及刷新失败时保留已注册 preset。
