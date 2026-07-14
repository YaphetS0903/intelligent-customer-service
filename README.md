# 企业智能客服与知识运营平台

面向企业内部员工的 AI 知识问答、资料治理、培训学习和运营保障平台。项目采用 Next.js 全栈架构，支持 MySQL 持久化、本地文本 RAG、OpenAI File Search、自定义 OpenAI-compatible 模型，以及可插拔 OCR、TTS、数字人、OIDC 和 LDAP 服务。

> 本仓库只包含源代码和脱敏配置模板，不包含生产环境变量、数据库数据、上传资料、音频视频、备份、监控快照或服务器密钥。

## 核心业务流程

```text
资料上传 -> 解析/OCR -> 分片与权限 -> 审核发布 -> 员工问答与引用
员工反馈 -> 人工工单/知识整改 -> 复测验证 -> 质量看板
PPT 上传 -> 讲稿生成 -> TTS/数字人 -> 课程发布 -> 学习与测验
代码变更 -> CI 验证 -> 发布预检 -> 原子部署 -> 健康检查/回滚
```

## 当前能力

- Next.js Web 应用。
- 管理端知识库创建与资料上传入口。
- 员工端智能客服对话页面。
- OpenAI File Search / Vector Store 托管 RAG 知识库接入。
- 本地文本 RAG 模式，可将可解析资料切块存入当前数据库 `document_chunks`，并用轻量混合检索召回后交给兼容模型回答。
- OpenAI Responses API 对话接入。
- OpenAI-compatible 自定义对话模型配置，支持填写 Base URL、API Key 和模型 ID。
- OpenAI TTS 语音播报接口。
- 自定义 MySQL 数据库接入，用于持久化知识库、文档分片、会话、反馈和培训任务。
- Supabase Auth / Postgres / Storage 保留为可选接入。
- Supabase Auth 登录、注册、退出和 cookie 会话保护保留为可选能力。
- 管理员/员工角色区分，管理端路由和管理 API 做权限保护。
- 知识库支持全员、指定部门、指定岗位、仅管理员可见范围，员工对话只检索自己有权限访问的知识库。
- 员工端可查看和选择本次检索范围，并显示每个可访问知识库的可检索资料数、检索状态、来源引用和无引用提示。
- 员工端支持回答复制、TTS 播放、点赞/点踩反馈，并在提交后显示反馈状态。
- 未配置服务端 TTS 时，员工端回答和培训讲稿会自动退回浏览器本地语音朗读。
- 管理员可编辑知识库信息与权限，可删除知识库和资料，并可配置资料密级、发布状态、部门/岗位/用户 ACL。
- 新上传资料默认草稿，管理员需执行“提交审核 -> 审核发布”，发布后才会进入员工端检索；已发布资料可撤回草稿或归档。
- 资料版本记录支持回滚操作，可将资料元数据、处理状态和本地 RAG 正文分片恢复到历史版本，并生成新的回滚审计记录。
- 管理员可维护用户姓名、部门、岗位和角色，部门与岗位信息会用于知识库和资料权限过滤。
- 管理员可查看会话审计、反馈记录、人工工单、安全告警和待补充知识线索，并处理反馈状态、备注和知识补充任务。
- 首页工作台数据看板，展示知识库、资料、问答、反馈和培训概览。
- OpenAI vector store 创建、绑定、文件上传和处理状态刷新。
- 知识管理页提供资料入库流程、资料状态统计、可检索状态提示和失败处理建议。
- 员工端聊天支持流式输出，回答完成后保存消息和引用来源。
- PPTX 自动解析、逐页讲稿生成和 TTS 语音播放。
- PPT 语音讲解提供生成流程、课程发布/下架、课程统计、讲稿页数、语音缓存状态和播放页错误提示。
- 培训课程支持可信学习进度、正式考试、完课证书、必修期限和学习提醒；未发布或归档课程不会出现在员工端培训列表。
- GitHub Actions 自动执行 typecheck、build 和 Playwright 回归测试。
- 提供 SSH 自动部署流水线、PM2 进程配置、服务器部署脚本和 MySQL 备份脚本。
- 未配置第三方 API 时支持演示模式。

## 技术栈

- Next.js + TypeScript
- Tailwind CSS
- MySQL / Supabase
- OpenAI API
- PM2 / GitHub Actions / SSH 部署

## 项目结构

| 目录 | 用途 |
| --- | --- |
| `app/` | Next.js 页面、管理后台与 Route Handlers |
| `components/` | 聊天、知识治理、培训、审批、运维等交互组件 |
| `lib/` | 数据访问、RAG、鉴权、第三方服务和运营规则 |
| `scripts/` | 部署、回滚、备份、恢复演练和运行监控脚本 |
| `supabase/` | 可选 Supabase schema 与增量迁移 |
| `tests/e2e/` | Playwright 端到端回归测试 |
| `.github/workflows/` | CI 与生产部署流水线 |

运行时数据默认位于 `.data/`、`.ops/`、`uploads/` 和 `backups/`，均已被 Git 忽略。

## 环境要求

- Node.js 22（CI 使用版本）
- npm 10 或兼容版本
- MySQL 8.0（生产推荐）
- Chromium（仅运行 Playwright 时需要）
- PM2（生产进程守护，由部署脚本按需安装）

## 本地启动

1. 安装依赖：

```bash
npm install
```

2. 复制脱敏环境变量模板：

```bash
cp .env.example .env.local
```

3. 填写 `.env.local`。下面是 MySQL + 本地文本 RAG 的最小示例，其他 OCR、TTS、数字人、SSO 和运维字段见 `.env.example`：

```env
DATABASE_PROVIDER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=enterprise_support
MYSQL_USER=enterprise_support
MYSQL_PASSWORD=请使用强密码
MYSQL_AUTO_MIGRATE=true

AUTH_SECRET=请使用至少32字节的随机值
APP_BASE_URL=http://localhost:3000

RAG_PROVIDER=local_text
AI_CHAT_PROVIDER=custom
AI_CHAT_BASE_URL=https://api.example.com/v1
AI_CHAT_API_KEY=请填写服务端密钥
AI_CHAT_MODEL=your-model-id
```

可用 `openssl rand -base64 48` 生成 `AUTH_SECRET`。真实密钥只应保存在 `.env.local`、服务器密钥管理服务或 GitHub Actions Secrets 中。

4. 启动开发服务：

```bash
npm run dev
```

打开 `http://localhost:3000`。

## 本地校验

建议按顺序执行，避免 `next build` 重建 `.next/types` 时和 `tsc` 并发读取产生竞态：

```bash
npm run build
npm run typecheck
npm run test:e2e
```

## 部署与备份

服务器首次部署可先填写生产 `.env.local`，再执行：

```bash
npm run deploy:local
```

正式升级建议先制作不包含 `node_modules`、`.next`、`.env.local`、`.data`、`uploads`、`backups`、`.ops` 的发布包，然后在服务器执行：

```bash
npm run deploy:preflight
npm run deploy:package -- /absolute/path/to/release.tar.gz
```

`deploy:package` 会在独立 staging 目录执行 `npm ci`、`typecheck`、`build` 和生产预检；全部通过后才保存当前版本并切换，只重载 `tianrui-ai-support`。切换或健康检查失败时会自动恢复原版本。手工回滚最近一次版本：

```bash
npm run deploy:rollback
```

发布和回滚始终保护生产 `.env.local`、`.data`、`uploads`、`backups`、`.ops`，不会操作其他 PM2 服务。

MySQL 备份可执行：

```bash
npm run backup:mysql
npm run verify:restore:mysql
```

自动部署流水线位于 `.github/workflows/deploy.yml`。配置 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_PORT`、`DEPLOY_APP_DIR` 后，可在 GitHub Actions 手动触发部署，或推送 `v*` tag 自动部署。

## 推荐 MySQL 初始化

当前推荐你使用自己的数据库服务器，搭配 `local_text` RAG 和 OpenAI-compatible 国产模型：

```env
DATABASE_PROVIDER=mysql
MYSQL_HOST=你的数据库地址
MYSQL_PORT=3306
MYSQL_DATABASE=customerservice
MYSQL_USER=customerservice
MYSQL_PASSWORD=
RAG_PROVIDER=local_text
AI_CHAT_PROVIDER=custom
AI_CHAT_BASE_URL=https://api.example.com/v1
AI_CHAT_API_KEY=
AI_CHAT_MODEL=your-model-id
```

启动或构建时，系统会自动检查并创建核心表：

- `users`
- `knowledge_bases`
- `documents`
- `document_chunks`
- `conversations`
- `messages`
- `feedback`
- `knowledge_tasks`
- `training_jobs`
- `training_video_jobs`
- `service_tickets`
- `security_events`

这种模式不需要 Supabase，也不需要 OpenAI Vector Store。上传 TXT、Markdown、DOCX、PPTX 时，系统会解析文字并写入 MySQL，员工提问时从 MySQL 召回片段，再调用你配置的兼容对话模型生成回答。

## 首次管理员与登录

MySQL 模式支持系统账号密码，也可接入 LDAP 或 OIDC。首次初始化全新数据库时，在 `.env.local` 临时配置：

```env
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=请使用独立强密码
INITIAL_ADMIN_NAME=系统管理员
```

系统只在该邮箱不存在时创建管理员，密码以加盐 `scrypt` 哈希保存。创建成功后应从生产 `.env.local` 删除 `INITIAL_ADMIN_PASSWORD`，再通过 `/admin/users` 创建和维护正式账号。

生产环境必须设置独立 `AUTH_SECRET`，用于登录会话 Cookie 签名，不要与数据库或第三方 API 密钥复用。

## Supabase 初始化（可选）

1. 在 Supabase 创建项目。
2. 在 Authentication 中启用 Email 登录。
3. 在 SQL Editor 中执行 `supabase/schema.sql`。
4. 在 Storage 中创建 `documents` bucket。
5. 将 Supabase URL、anon key、service role key 填入 `.env.local`。
6. 将你的管理员邮箱填入 `SUPABASE_ADMIN_EMAILS`，多个邮箱用英文逗号分隔。

示例：

```env
SUPABASE_ADMIN_EMAILS=admin@company.com,hr@company.com
```

用户首次登录或注册后，系统会自动在 `public.users` 表创建 profile。邮箱命中 `SUPABASE_ADMIN_EMAILS` 的用户会自动成为管理员，其他用户默认为员工。

如果你已经执行过旧版 schema，再执行：

```sql
-- supabase/migrations/20260704_training_jobs.sql
-- supabase/migrations/20260704_training_audio_cache.sql
-- supabase/migrations/20260704_training_slide_notes.sql
-- supabase/migrations/20260705_position_acl.sql
-- supabase/migrations/20260705_training_publish_status.sql
-- supabase/migrations/20260712_training_learning_loop.sql
-- supabase/migrations/20260712_training_phase2_closeout.sql
```

用于升级 `training_jobs` 表结构、语音缓存字段、旧课程的备注字段、课程发布状态、岗位权限、单文档 ACL，以及课程资料、部门可见范围、可信学习进度和培训审计字段。

使用 MySQL 的已有环境需要执行：

```bash
MYSQL_PWD="$MYSQL_PASSWORD" mysql \
  --host="$MYSQL_HOST" \
  --port="${MYSQL_PORT:-3306}" \
  --user="$MYSQL_USER" \
  "$MYSQL_DATABASE" < scripts/migrations/20260712_training_learning_loop.mysql.sql
```

本次培训闭环迁移同时提供 MySQL 和 Supabase 回滚文件。回滚会删除新增的课程资料、学习计时和培训审计字段，执行前必须先备份数据库：

```text
scripts/migrations/20260712_training_learning_loop.mysql.rollback.sql
scripts/migrations/20260712_training_learning_loop.supabase.rollback.sql
scripts/migrations/20260712_training_phase2_closeout.mysql.rollback.sql
scripts/migrations/20260712_training_phase2_closeout.supabase.rollback.sql
```

## OpenAI 初始化

1. 创建 OpenAI API key。
2. 填入 `.env.local` 的 `OPENAI_API_KEY`。
3. 在管理端创建知识库时，系统会创建对应的 OpenAI vector store。
4. 如果知识库是在未配置 OpenAI 时创建的，可以在管理端点击“创建 Vector Store”补建。
5. 上传资料时，系统会把文件加入 vector store。
6. 上传后点击“刷新状态”，直到文件状态变为“可用”。
7. 员工提问时，系统会通过 File Search 检索知识库并生成回答。

## 自定义对话模型

系统支持将普通对话模型切换为 OpenAI-compatible 接口，用于接入 DeepSeek、智谱、讯飞、阿里等兼容服务。管理员可在 `/admin/settings` 填写：

```env
AI_CHAT_PROVIDER=custom
AI_CHAT_BASE_URL=https://api.example.com/v1
AI_CHAT_API_KEY=
AI_CHAT_MODEL=your-model-id
```

注意能力边界：

- `AI_CHAT_*` 可用于员工端普通对话，也可配合 `local_text` RAG 生成企业知识问答。
- OpenAI Vector Store 和 File Search 仍依赖 `OPENAI_API_KEY`；如果使用 `local_text`，资料入库、引用来源和问答可脱离 OpenAI。
- 语音可使用 OpenAI TTS，也可以通过 `TTS_PROVIDER=custom` 接入第三方 TTS。
- 很多国产模型只兼容 chat completions，不兼容 OpenAI File Search / Vector Store；这类场景建议使用 `local_text`。
- 如果希望 RAG 完全脱离 OpenAI，可先使用 `local_text` 模式；如果需要更强语义检索，后续再升级为 MySQL 向量扩展、pgvector 或第三方 RAG 服务。

## 自定义 TTS 语音

员工端答案朗读和 PPT 语音讲解都通过同一套 TTS 配置生成语音。默认使用 OpenAI：

```env
TTS_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=coral
```

也可以接入第三方 TTS：

```env
TTS_PROVIDER=custom
TTS_API_URL=https://api.example.com/tts
TTS_STATUS_URL=https://api.example.com/tts/{task_id}
TTS_API_KEY=
TTS_AUTH_HEADER=Authorization
TTS_HEADERS=
TTS_PAYLOAD_TEMPLATE=
TTS_MODEL=your-tts-model
TTS_VOICE=your-voice-id
```

自定义 TTS 会以 JSON POST 调用接口。默认携带 `Authorization: Bearer <TTS_API_KEY>`；如服务商要求 `X-API-Key`、`api-key` 或不需要认证头，可通过 `TTS_AUTH_HEADER` 配置为对应头名或 `none`。`TTS_HEADERS` 支持 JSON 形式的额外请求头，值中可使用 `{{api_key}}` 占位。请求体包含 `text`、`input`、`model`、`voice`、`format`。返回可以是：

- 直接返回 `audio/*` 音频流。
- JSON 返回 `audio_base64`、`audioBase64`、`audio`、`audioData`、`data`、`result`、`mp3`、`wav` 或嵌套 `output/data/result` 中的 base64 音频。
- JSON 返回 `url`、`audio_url`、`audioUrl`、`file_url`、`download_url`，系统会再下载音频。
- 异步接口返回 `task_id`、`taskId`、`job_id`、`jobId` 时，可配置 `TTS_STATUS_URL` 轮询获取最终音频。

如果服务商要求不同请求体，可配置 `TTS_PAYLOAD_TEMPLATE`，支持 `{{text}}`、`{{input}}`、`{{model}}`、`{{voice}}`、`{{format}}` 变量：

```env
TTS_PAYLOAD_TEMPLATE={"text":"{{text}}","voice":"{{voice}}","model":"{{model}}","format":"mp3"}
```

管理员可在 `/admin/settings` 的“TTS 语音试听”输入测试文本并直接播放返回音频，用于验证配置是否真实可用。

如果暂时没有配置服务端 TTS，员工端仍可点击“播放语音”。系统会优先尝试 `/api/tts`，失败后自动使用浏览器内置 `speechSynthesis` 朗读回答或 PPT 讲稿；这种兜底不消耗第三方 API，但音色、稳定性和可缓存性取决于员工浏览器。

## 数字人视频

PPT 课程支持在讲稿生成后继续调用第三方数字人服务生成讲解视频。系统不自研数字人模型，只做通用 API 接入和任务状态管理。

```env
DIGITAL_HUMAN_PROVIDER=custom
DIGITAL_HUMAN_API_URL=https://api.example.com/avatar/videos
DIGITAL_HUMAN_STATUS_URL=https://api.example.com/avatar/videos/{job_id}
DIGITAL_HUMAN_API_KEY=
DIGITAL_HUMAN_AUTH_HEADER=Authorization
DIGITAL_HUMAN_HEADERS=
DIGITAL_HUMAN_PAYLOAD_TEMPLATE=
DIGITAL_HUMAN_MODEL=your-model-id
DIGITAL_HUMAN_AVATAR_ID=your-avatar-id
DIGITAL_HUMAN_VOICE_ID=your-voice-id
```

管理员在 `/admin/training` 上传 PPTX 生成课程后，可以点击视频按钮提交数字人任务。员工在 `/training/[id]` 可查看视频生成状态；视频完成后会直接显示播放器。未配置数字人服务时，课程仍可使用逐页讲稿和 TTS 语音。

自定义数字人接口使用 JSON POST。默认携带 `Authorization: Bearer <DIGITAL_HUMAN_API_KEY>`；如服务商要求 `X-API-Key`、`api-key` 或不需要认证头，可通过 `DIGITAL_HUMAN_AUTH_HEADER` 配置为对应头名或 `none`。`DIGITAL_HUMAN_HEADERS` 支持 JSON 形式的额外请求头，状态查询也会复用这些 Header。请求体包含 `title`、`script`、`slides`、`model`、`avatar_id`、`voice_id`。返回支持：

- 同步返回 `video_url`、`videoUrl`、`url`、`output_url`。
- 异步返回 `job_id`、`jobId`、`task_id`、`taskId`，系统会使用 `DIGITAL_HUMAN_STATUS_URL` 或返回中的 `status_url` 查询状态。
- 状态字段支持 `queued`、`pending`、`processing`、`completed`、`success`、`failed` 等常见写法。

如果服务商要求不同请求体，可配置 `DIGITAL_HUMAN_PAYLOAD_TEMPLATE`，支持 `{{title}}`、`{{script}}`、`{{model}}`、`{{avatar_id}}`、`{{voice_id}}`、`{{slides_json}}` 变量：

```env
DIGITAL_HUMAN_PAYLOAD_TEMPLATE={"title":"{{title}}","text":"{{script}}","avatar_id":"{{avatar_id}}","voice_id":"{{voice_id}}"}
```

管理员也可以在 `/admin/settings` 的“数字人接口测试”直接提交一段短测试讲稿，验证接口是否返回任务编号或视频地址。该测试不写入课程任务表，但第三方平台可能会创建一个短测试任务。

## 企业统一登录

系统支持两种企业身份接入方式：

- OIDC：适合企业微信、钉钉、飞书、IAM、LDAP 网关或统一身份平台。
- LDAP / AD：适合直接连接企业目录服务。系统内账号密码校验失败后，会尝试 LDAP 绑定校验，并把邮箱、姓名、部门、岗位同步到 `users` 表。管理员在系统内禁用的账号不会被 LDAP 或 OIDC 自动重新启用。

```env
SSO_PROVIDER=oidc
SSO_AUTHORIZE_URL=https://idp.example.com/oauth2/authorize
SSO_TOKEN_URL=https://idp.example.com/oauth2/token
SSO_USERINFO_URL=https://idp.example.com/oauth2/userinfo
SSO_CLIENT_ID=
SSO_CLIENT_SECRET=
SSO_SCOPES=openid profile email
SSO_DEFAULT_DEPARTMENT=综合管理部
APP_BASE_URL=http://localhost:3000
```

身份平台回调地址配置为：

```text
{APP_BASE_URL}/api/auth/sso/callback
```

登录页会在配置完整后显示“企业统一登录”。首次通过 SSO 登录的员工会自动写入 `users` 表，默认角色为员工；如果邮箱已存在，会绑定外部身份并保留原有角色和权限。

LDAP / AD 直连配置示例：

```env
LDAP_PROVIDER=custom
LDAP_URL=ldaps://ad.example.com:636
LDAP_BIND_DN=cn=readonly,ou=system,dc=example,dc=com
LDAP_BIND_PASSWORD=
LDAP_SEARCH_BASE=ou=users,dc=example,dc=com
LDAP_SEARCH_FILTER=(|(mail={{login}})(uid={{login}})(sAMAccountName={{login}}))
LDAP_EMAIL_ATTRIBUTE=mail
LDAP_NAME_ATTRIBUTE=displayName
LDAP_DEPARTMENT_ATTRIBUTE=department
LDAP_POSITION_ATTRIBUTE=title
LDAP_DEFAULT_DOMAIN=example.com
```

如果企业目录不允许服务账号搜索，也可以使用用户 DN 模板直连绑定：

```env
LDAP_PROVIDER=custom
LDAP_URL=ldaps://ad.example.com:636
LDAP_USER_DN_TEMPLATE=uid={{login}},ou=users,dc=example,dc=com
LDAP_DEFAULT_DOMAIN=example.com
```

## RAG 检索模式

系统支持两种知识库检索模式：

```env
RAG_PROVIDER=openai_file_search
```

使用 OpenAI Vector Store / File Search。优点是托管检索效果更完整；限制是资料入库、检索和引用依赖 `OPENAI_API_KEY`。

```env
RAG_PROVIDER=local_text
```

使用本地文本 RAG。上传 TXT、Markdown、DOCX、PPTX、PDF、XLSX 时，系统会解析文字并写入当前数据库 `document_chunks`，员工提问时先做轻量混合召回，再把片段交给 OpenAI 或自定义 OpenAI-compatible 对话模型生成答案。旧版 XLS 需要先另存为 XLSX。召回会综合关键词、别名扩展、标题/章节/表格元数据、字符 n-gram 相似度、命中词距离和资料新鲜度，并在引用中显示相关度和命中原因。这个模式不需要 OpenAI Vector Store，适合先接 DeepSeek、智谱、讯飞、阿里等国产兼容模型做演示。

当前 `local_text` 模式的限制：

- PDF 文本型文件会按页解析；扫描件 PDF 和图片资料需要在配置页填写 `OCR_PROVIDER=custom`、`OCR_API_URL`、`OCR_API_KEY` 后走通用 OCR 接口。`local_text` 模式下，管理员可在“上传资料”直接上传图片，识别结果会进入知识库分片和版本记录。
- Excel 会按工作表和行范围解析；复杂合并单元格、图片型表格和公式语义仍建议人工校验。
- 检索是轻量混合召回，不依赖向量库；相比纯关键词更稳，但仍不是 embedding 级语义检索。
- 后续如资料规模明显扩大，可升级为 MySQL 向量扩展、pgvector、Elasticsearch/OpenSearch 或第三方 RAG API。

## OCR 扫描件测试

管理员在 `/admin/settings` 填写 OCR 配置后，可以在“页面配置”中的“OCR 实际测试”上传图片或扫描件 PDF。系统会调用同一套 OCR 适配逻辑并返回识别段落数、字符数和文本预览。确认测试通过后，可到 `/admin/documents` 将扫描件 PDF 或图片资料正式上传入库。

配置页提供“服务商预设模板”，可一键套用常见的 Bearer JSON、X-API-Key、OCR Multipart、OCR JSON Base64、数字人异步任务等通用配置。预设只填认证头、请求格式和请求体模板，不会填写真实 API URL 或 API Key。

```env
OCR_PROVIDER=custom
OCR_API_URL=https://api.example.com/ocr
OCR_API_KEY=
OCR_AUTH_HEADER=Authorization
OCR_HEADERS=
OCR_REQUEST_FORMAT=multipart
OCR_FILE_FIELD=file
OCR_MODEL_FIELD=model
OCR_PROVIDER_FIELD=provider
OCR_PAYLOAD_TEMPLATE=
OCR_MODEL=your-ocr-model
```

OCR 接口使用 `multipart/form-data` POST，字段包含 `file`、`provider`、可选 `model`。默认携带 `Authorization: Bearer <OCR_API_KEY>`；如服务商要求 `X-API-Key`、`api-key` 或不需要认证头，可通过 `OCR_AUTH_HEADER` 配置为对应头名或 `none`。`OCR_HEADERS` 支持 JSON 形式的额外请求头。返回 JSON 需要包含 `text`，或 `pages` / `results` 这类分段结构。

如果服务商的 multipart 字段名不同，可配置 `OCR_FILE_FIELD`、`OCR_MODEL_FIELD`、`OCR_PROVIDER_FIELD`。如果服务商要求 JSON + base64 图片，可设置：

```env
OCR_REQUEST_FORMAT=json_base64
OCR_PAYLOAD_TEMPLATE={"image":"{{file_base64}}","filename":"{{file_name}}","mime_type":"{{mime_type}}","model":"{{model}}"}
```

额外请求头示例：

```env
OCR_AUTH_HEADER=X-API-Key
OCR_HEADERS={"X-Client":"tianrui","X-Request-Source":"training"}
```

## 配置向导

管理员可以进入 `/admin/settings` 执行上线前检查。页面会只读检查：

- 数据库模式、MySQL 连接和核心表结构。
- Supabase client/admin 环境变量和 `documents` Storage bucket（仅使用 Supabase 时需要）。
- OpenAI API key、对话模型、TTS 供应商和语音配置。
- OCR 扫描件识别接口配置。
- 数字人视频接口配置。
- OIDC 统一登录和 LDAP / AD 直连登录配置。
- 当前登录用户是否具备管理员权限。
- 知识库、本地文本 RAG 或 Vector Store、可检索资料、员工问答和 PPT 语音课程的上线验证状态。

页面也支持直接填写配置并保存到本地 `.env.local`，对应接口为 `/api/system/settings`。保存后建议重启开发服务，再进入 `/admin/settings` 重新检查。健康检查接口为 `/api/system/health`，不会创建表、bucket、vector store，也不会发起 OpenAI 生成调用。

配置页提供对话模型、TTS、OCR 和数字人接口的独立测试入口。对话模型、TTS 和 OCR 用于验证真实返回内容；数字人测试用于确认第三方生成接口已连通并能返回 `job_id` 或 `video_url`。

真实 API 配置完成后，建议按 `/admin/settings` 右侧“业务流程”检查项逐项验收：

1. 创建至少一个知识库。
2. 如果使用 `local_text`，确认资料会写入 `document_chunks`；如果使用 OpenAI File Search，再为知识库创建 Vector Store。
3. 上传一份测试资料，并确认状态变为“可用”。
4. 用员工端 `/chat` 提问，确认回答内容和来源引用。
5. 上传一个 PPTX 生成讲稿与 TTS 语音课程。
6. 如启用数字人，在 `/admin/training` 提交视频任务，并在 `/training/[id]` 验证视频播放。

## 企业培训闭环

### 课程管理

1. 管理员进入 `/admin/training` 上传 `.pptx`，系统解析每页文本和演讲者备注并生成逐页讲稿。
2. 为课程维护标题、简介、讲师、封面 URL 和可见部门；可见部门留空时对全部员工可见，管理员始终可访问。
3. 新课程默认为未发布。标题、简介、讲师或讲稿不完整时不能发布；发布后授权员工可在 `/training` 查看，下架后立即停止员工访问。
4. 管理端支持批量预生成课程语音，显示总页数、成功数、失败数、当前页和错误信息；失败后可重新生成，单页也可试听并按需生成。
5. 课程资料修改、发布、下架、归档和语音重新生成会写入培训审计时间线。

### 语音缓存

- 第一次播放某页时调用当前 TTS 服务并写入缓存；配置 Supabase Storage 时保存到 `documents/training-audio/`，其他部署保存到 `public/generated/training-audio/`。
- 缓存路径写入课程 `audio_paths`，后续播放优先读取缓存，不重复调用 MeloTTS；响应头 `X-Audio-Cache` 会标记 `hit` 或 `miss`。
- 未配置或调用失败时，员工页面会退回浏览器内置语音朗读，但浏览器朗读不会写入服务端音频缓存。

### 员工学习与可信进度

- 员工可以逐页播放、自动连播，并选择 `0.75x`、`1x`、`1.25x`、`1.5x` 或 `2x` 倍速。
- 系统保存当前页、播放位置、各页有效收听时长、累计真实学习时长和最后学习时间；刷新页面或重新登录后可断点续播。
- 播放期间每 5 秒发送学习心跳。服务端限制心跳频率和单次增量，并分别计算音频消费进度和真实学习时长。
- 每页有效收听达到该页估算音频时长约 80% 后才计为完成；仅翻页或拖动到结尾不会直接完成课程。全部页面完成后记录完课时间。

### 管理统计与权限

- 管理员可按课程、部门和员工关键词查询学习状态、进度、真实学习时长、最后学习时间和完课时间，并导出 CSV。
- 课程完课率以该课程实际可见员工为分母；部门受限课程不会把无权访问的员工计入应学人数。
- 员工课程列表、详情、音频、课件图片、测验、视频状态、视频文件和学习进度接口统一检查课程可见范围，越权请求返回 `403`。

### 正式考试、证书与提醒

- 管理员可以为课程维护单选题、多选题和判断题，也可以根据讲稿生成题目初稿，审核答案与解析后发布正式考试。
- 每门课程可配置合格分数、考试次数、考试时限、是否必修、完成期限和是否签发证书。启用考试但没有正式题目时，课程不能发布。
- 员工完成全部课程学习后才能开考；考试会话、倒计时、次数限制、判分和正确答案全部由服务端控制，浏览器不会收到正确答案。
- 正式完课要求“学习进度 100% 且考试通过”；未启用考试的课程仍以学习进度 100% 为完课条件。
- 考试通过后自动签发唯一编号的中文 PDF 证书。管理员可在学习跟踪中查看和作废证书，作废后下载接口立即拒绝访问。
- 课程发布时向授权员工发送站内通知；管理员可提醒未完课员工，逾期提醒显示更高告警级别，并按课程、员工和日期去重。
- 证书 PDF 默认查找 Linux Noto CJK、文泉驿或 macOS 中文字体，也可以通过 `CERTIFICATE_FONT_PATH` 和 `CERTIFICATE_FONT_FACE` 指定字体。

如果已配置数字人 API，管理员仍可在课程列表中生成数字人视频，员工进入课程详情页后可直接播放。系统负责通用数字人 API、任务状态、失败重试和播放；真实视频生成质量与可用性取决于接入的第三方或自部署数字人服务。

当前 PPT 能力聚焦文字型 PPT，并会尝试解析 `ppt/notesSlides` 中的演讲者备注。复杂图表、图片中的文字和动画暂不解析。后续可以继续接入 OCR 和页面截图增强视觉理解。

## 工作台看板

首页 `/` 会展示：

- 知识库数量、资料数量、可用资料比例。
- 会话数量、消息数量。
- 反馈数量和满意度。
- 最近资料、最近培训、最近会话、最近反馈。

未配置持久化数据库时，看板使用演示内存数据；配置 MySQL 或 Supabase 后会从数据库聚合。

## 反馈处理闭环

管理员进入 `/admin/insights` 后可以完成从员工反馈到知识库更新的处理流程：

1. 在“会话审计”中查看员工问题、AI 回答和引用来源。
2. 在“反馈记录”中处理点赞/点踩反馈，维护状态、处理备注，以及是否需要补充知识库资料。
3. 在“人工工单”中处理员工转人工请求，维护优先级、状态和处理备注。
4. 在“安全审计”中处理敏感信息、提示词注入和异常访问事件；高危或严重待处理事件会在页面顶部显示“安全告警”。
5. 在“待补充知识”中查看点踩反馈和无引用回答沉淀出的知识缺口。
6. 对确认为知识缺口的问题创建补充任务，维护任务状态和备注。
7. 点击“上传资料”进入知识库资料管理，补充制度、FAQ、PPT 或培训材料。
8. 资料处理完成后，员工侧对话会按权限检索更新后的知识库。

反馈和任务状态支持：待处理、处理中、已处理、忽略。未配置持久化数据库时这些数据保存在本地演示内存中，重启开发服务后会恢复初始演示数据；接入 MySQL 或 Supabase 后会持久化到数据库。已有 Supabase 项目需要执行 `supabase/migrations/20260704_feedback_workflow.sql` 升级表结构。

## 安全审计与异常告警

员工提问和模型输出会经过安全审计：

- 识别并脱敏手机号、身份证号、银行卡号、邮箱、API Key 等敏感信息。
- 识别“忽略系统规则”“索要系统提示词”“索要密钥或环境变量”等提示词注入或越权探测。
- 员工尝试选择无权限知识库时会记录异常访问事件并阻止检索。
- 同一员工在 15 分钟内连续触发 3 次风险事件时，系统会自动生成“短时间内连续触发安全事件”高危或严重告警，并在 `/admin/insights` 的“安全审计”和顶部高危告警中展示。

## 站内通知中心

员工和管理员可从侧栏进入 `/notifications`，集中查看审批、工单、安全告警和 QA 异常通知。通知支持全部/未读/业务类型筛选、单条已读/未读、全部已读和业务页面跳转。

- 资料提交审核后，通知有审核权限的人员；审核通过后通知发布人员和提交人；驳回、发布、归档结果通知提交人。
- 新建工单通知管理员，分派结果通知处理人，公开回复和处理结果通知员工。
- 高危或严重安全事件通知管理员；普通脱敏审计仍保留在安全审计页，不占用通知列表。
- QA 策略异常巡检发现风险或运行失败时通知管理员。
- 通知使用业务事件去重键，接口重试不会重复创建同一条站内通知。

外部发送暂不要求启用，代码已预留三个可选 Webhook：

```bash
NOTIFICATION_WEBHOOK_URL=https://通用通知网关
NOTIFICATION_EMAIL_WEBHOOK_URL=https://邮件发送网关
NOTIFICATION_WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...
```

未配置这些地址时只发送站内通知，不影响审批、工单和安全审计主流程。

## 资料审批发布

管理员上传资料后，系统会先解析文件并生成知识分片，但新资料默认保持“草稿”状态。管理员可在 `/admin/documents` 的资料列表中打开“权限治理”，完成以下流程：

1. 配置资料密级、可见部门、可见岗位或指定用户。
2. 点击“提交审核”，资料进入“待审核”。
3. 管理员点击“审核发布”，资料才会进入员工端 RAG 检索范围。
4. 已发布资料可“撤回草稿”重新调整，也可“归档资料”停止检索。

## 资料版本回滚

每次上传资料、解析成功/失败或执行版本回滚时，系统都会写入 `document_versions`。对于 `local_text` RAG 成功解析出的资料，系统还会把当时的可检索正文片段写入 `document_version_chunks`。管理员可在知识管理页的“资料版本记录”中点击“回滚”，将当前资料的标题、文件名、文件类型、处理状态和本地 RAG 正文分片恢复到指定历史版本，并自动生成一条新的回滚版本记录。

如果历史版本来自旧数据且没有正文快照，系统会保留当前 `document_chunks`，并在新版本记录中标明该历史版本无正文快照。OpenAI File Search 模式下，远端 Vector Store 文件不做自动回滚，建议重新上传对应历史文件并同步到向量知识库。

## 当前状态与后续路线

核心问答、知识治理、权限审批、工单反馈、培训学习、质量回归、通知中心、备份恢复、运行监控和安全发布链路已经完成，并经过本地与生产环境回归验证。下一阶段重点是：

1. 组织跨部门员工灰度试运行，持续收集真实问题和满意度。
2. 根据无引用回答、点踩反馈和 QA 失败项优化资料与分片。
3. 轮换已在调试过程使用过的 API、TTS 和管理员凭证。
4. 配置域名与 HTTPS，再按企业条件接入 OIDC/LDAP。
5. 按需启用企业微信/邮件外部通知和第三方数字人服务。

## 相关文档

- `智能客服方案规划.md`
- `项目开发实施计划.md`
- `部署与运维手册.md`
- `上线验收清单.md`
- `目标验收矩阵.md`
