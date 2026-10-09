# SkillHub 调研与当前产品决策

调研日期：2026-10-08。以下判断基于公开 README、API 文档与代码组织，没有对竞品做完整执行效果基准。

| 项目 | 借鉴 | 当前取舍 |
| --- | --- | --- |
| [Vercel Skills](https://github.com/vercel-labs/skills) | 通用 SKILL.md 与多 Agent 生态 | 保留标准格式。发布只接收 ZIP，不提供 GitHub 导入或 URL 发布。 |
| [ClawHub](https://github.com/openclaw/clawhub) | 注册表、不可变版本、文件与 API | 借鉴版本/API 模型，完整保存 ZIP 和资源，支持历史版本下载。 |
| [SkillHub Local](https://github.com/mjalalimanesh/skillhub-local) | 本机技能集中管理 | 保持极简 PC 工作台，专注发现、发布、下载与收藏。 |

按用户后续决定，取消原先的任务配方与规则推荐；不以创新作为当前目标。所有产品操作走同一 REST API，API 契约、错误格式和权限行为与 UI 一致。用户提供的 ZIP 只校验和存储，不执行其中的指令。

## 视觉

仅为 PC 设计，保持 Apple / Microsoft 式克制的黑白灰、蓝色强调、顶部导航和留白。使用用户提供的 Logo 原文件，保持比例完整显示。首页为 “Find what you need. Or just look around.”，只有搜索与分类，不显示 Agent 和排序筛选。

GSAP 使用 useGSAP 管理作用域与清理，保留轻微进场和弹窗动画，尊重 prefers-reduced-motion。依据 [GSAP React 文档](https://gsap.com/resources/React/)。

## 本机与登录

默认在本机开发。2026-10-09 按用户明确要求补齐独立 Docker 自托管与公开仓库；不依赖 Sites 发布。登录入口仅占位，具体认证等待用户指定；本机及管理员配置的服务器入口使用固定工作区，让发布、收藏和 API Key 管理正常使用。服务器版为可信内网共享模型，没有用户隔离；数据通过独立 PostgreSQL 数据卷持久化；PG 容器、库、账号和网络均与 SkillGo 隔离。
