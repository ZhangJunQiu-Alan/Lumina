# Lumina

Lumina 是一款面向中文英语学习者的词汇记忆与雅思真题训练产品。它把考试词库、AI 词条整理、分轮学习、状态驱动复习、生词沉淀和 Cambridge IELTS 阅读 / 听力训练放在同一个账号体系里，让用户每天打开后知道应该先复习什么、继续学哪一组、哪些词还需要加固。

它不是一个只记录“背过 / 没背过”的单词表，而是一套围绕真实记忆状态运行的学习系统：每个词都会被记录为 `new`、`fuzzy`、`slow_recall`、`stable_recall` 或 `mastered`，系统再根据状态安排复习、首页任务、词库展示和长期回顾。

## Android 客户端

原生 Android 客户端位于 [`android/`](./android/README.md)，使用 Kotlin、Jetpack Compose 和现有 Supabase 账号体系。目前已完成账号、原生首页和词库模块：每日指标、7 天学习轨迹、官方词库进度、学习组列表与单词记忆详情均使用真实服务端数据。后续模块会按学习、复习和 IELTS 的顺序逐步迁移。

## 产品定位

Lumina 适合三类场景：

- **考试词汇长期学习**：雅思、GRE、四六级、考研、高考、专四、专八等官方词库按批次推进，学过的词自动跳过。
- **个人生词管理**：用户可以导入外部词表，也可以在阅读材料里点词查询并加入词库，再从生词池组成新的学习组。
- **雅思真题训练**：阅读按 3 篇文章、40 题、60 分钟组织；听力按 4 个 Section、40 题、30 分钟组织，提交后保存分数和错题记录。

## 用户会看到什么

| 区域 | 作用 |
| --- | --- |
| 首页 | 今日复习、新学任务、连续学习、完美打卡、记忆轨迹和继续学习入口 |
| 词库 | 官方词库、个人词库、已学词组、词条详情、学习进度和词组管理 |
| 雅思 | Cambridge IELTS 阅读和听力训练入口、套题列表、最近记录 |
| 生词 | 学过但还没稳定掌握的词，按下次复习时间排序 |
| 账号 | 学习统计、年度活动、近期学习表现 |
| 设置 | 发音、自动播放、反馈停留时间、学习轮次、记忆提示等偏好 |

登录后的主流程通常是：

```text
登录 -> 首页 -> 今日到期复习
     -> 继续未完成学习 / 开始官方词库新一组
     -> Round 1 -> Round 2 -> Round 3 -> 文章巩固
     -> 后续按记忆状态进入日常复习
```

## 核心功能

### 1. Daily Routine 首页

首页把“今天该做什么”放在最前面：

- 展示今日到期复习词数、新学词数、连续学习天数、完美打卡天数和已稳定记忆词数。
- 用 7 天轨迹和年度活动数据展示最近学习节奏。
- 根据当前状态给出 CTA：开始复习、继续复习、开始新学、继续学习或打开词库。
- 支持选择官方词库和顺序 / 乱序模式，直接从首页开始当天主线学习。

### 2. 官方考试词库

官方词库支持顺序学习和乱序学习。每次默认取 40 个词；已学过或已稳定掌握的词会自动跳过。

| ID | 名称 | 词数 | 每组 |
| --- | --- | ---: | ---: |
| `ielts-vocab` | 雅思词汇真经 | 3631 | 40 |
| `gre-zhenkao-v7` | GRE镇考机经词 7.0 | 1351 | 40 |
| `cet4-vocab` | 四级大纲核心词汇 | 4530 | 40 |
| `cet6-vocab` | 六级大纲核心词汇 | 2215 | 40 |
| `npee-vocab` | 考研英语大纲词汇 | 5390 | 40 |
| `gaokao-vocab` | 高考英语核心词汇 | 3449 | 40 |
| `tem4-vocab` | 英语专业四级(TEM4) | 8585 | 40 |
| `tem8-vocab` | 英语专业八级(TEM8) | 3983 | 40 |

官方词库支持：

- 按原词表顺序推进。
- 按乱序模式发放新批次。
- 继续未完成的主线学习组。
- 丢弃当前未完成主线组，同时保留已实际学过词的复习状态。
- 在词库详情页查看总词数、已解锁词数、已稳定记忆词数和当前进度。

### 3. 自定义导入与 AI 词条整理

用户可以粘贴一批外部单词，系统会按换行或逗号切分，单次最多处理前 30 个词。导入流程会先做词形归一和已有词条复用，再对缺失词条补充 AI 结构化信息。

AI 词条包含：

- 英式 / 美式音标。
- 中文核心释义和分义项释义。
- 例句与中文翻译。
- 构词拆解、词根词缀说明。
- 派生词、近义词、反义词。
- 易混词对比和记忆提示。

导入完成后，这批词会保存为个人词组，可以直接进入 Lumina 的分轮学习和长期复习系统。

### 4. 分轮学习系统

Lumina 的学习流目前包含四个阶段：

| 阶段 | 目标 | 用户体验 |
| --- | --- | --- |
| Round 1 | 建立词形、发音、含义和例句关联 | 查看完整词条、释义、构词、例句、关系词和记忆提示 |
| Round 2 | 主动回忆并首次判定记忆状态 | 根据例句填空，支持词形提示；缺少例句时回退为拼写输入 |
| Round 3 | 快速识别英文到中文含义 | 先看英文和发音，快速判断后再展开释义确认 |
| 文章巩固 | 把整组词放回上下文 | 生成 IELTS 风格短文和逐句中文翻译，用上下文复盘 |

学习过程中会保存会话进度。用户中途离开后，可以从上次的轮次、位置、队列和已确认词继续。

### 5. 状态驱动复习

Lumina 的复习不是简单的正确率统计，而是基于记忆状态推进：

| 状态 | 中文含义 | 当前间隔 |
| --- | --- | --- |
| `new` | 新词 | 暂不排入长期复习 |
| `fuzzy` | 模糊 | 约 1 天后再见 |
| `slow_recall` | 慢回忆 | 约 3 天后再见 |
| `stable_recall` | 稳回忆 | 约 7 天后再见 |
| `mastered` | 已掌握 / 毕业 | 不再进入日常到期队列 |

关键规则：

- Round 2 是新词进入长期记忆状态的首次判定入口。
- 回忆耗时超过 `6000ms` 的正确答案会被视为 `slow_correct`。
- 日常复习会沿 `new -> fuzzy -> slow_recall -> stable_recall -> mastered` 推进。
- `stable_recall` 需要累计成功次数达到 3 才会进入 `mastered`。
- 日常复习答错时，该词不会立刻从当天队列消失。
- 用户也可以把词手动标记为已掌握。

### 6. 生词本与点词查询

生词本记录学过但还没稳定掌握的词，按下次复习时间排序。每个词可以查看发音、释义、例句、构词、关系词、易混提示、记忆状态和最近一次复习结果。

阅读相关页面支持点词查询。查询结果会显示词条信息、用户是否已加入词库、当前记忆状态，并允许把词加入或移出个人词库。

### 7. 雅思阅读训练

雅思阅读模块按真实考试节奏组织：

- 每套 3 篇文章、40 题、60 分钟。
- 支持 True / False / Not Given、Yes / No / Not Given、选择题、匹配题、标题匹配、摘要填空、表格填空、流程图填空、句子填空、简答题、图表标注等题型。
- 支持文章高亮、笔记、题目定位、字体大小调整和答题草稿本地保存。
- 提交后保存分数、用时、每题答案、正确答案和错题 / 未答题回看。
- 阅读文章内可以点词查询，并复用词库系统。

### 8. 雅思听力训练

雅思听力模块支持 Cambridge IELTS 4-10：

- 每套 4 个 Section、40 题、30 分钟。
- 音频、题目和答题区在同一页完成。
- 支持题号旗标、Section 切换、答题草稿本地保存。
- 支持听力原题图片叠加和题目热点定位。
- 提交后保存分数、用时、每题答案、正确答案和错题 / 未答题回看。

### 9. 账号同步与学习偏好

账号体系基于 Supabase Auth。邮箱登录 / 注册始终可用；Google 登录由 `VITE_GOOGLE_AUTH_ENABLED` 控制，只有完成 Supabase Google Provider 配置后才建议开启。

随账号同步的数据包括：

- 学习组、学习会话和复习状态。
- Daily Routine 进度、连续学习和活动记录。
- 用户保存的生词。
- 雅思阅读 / 听力提交记录。
- 学习偏好：默认发音、播放速度、自动播放、重复次数、播放间隔、答对 / 答错反馈停留、Round 3 / 文章巩固开关、点词自动播放、Round 2 例句自动播放、记忆提示显示开关。

## 路由概览

| 路由 | 用途 |
| --- | --- |
| `/` | Landing Page，产品介绍与进入入口 |
| `/auth` | 登录 / 注册 / 密码恢复 |
| `/privacy` | 隐私政策 |
| `/terms` | 服务条款 |
| `/app/home` | 登录后的 Daily Routine 首页 |
| `/app/library` | 官方词库、个人词库和已学词组 |
| `/app/library/official/:libraryId?` | 官方词库详情 |
| `/app/library/group/:groupId` | 词组详情 |
| `/app/import` | 自定义词汇导入 |
| `/app/session` | 学习 / 复习会话 |
| `/app/review-results` | 复习结果 |
| `/app/ielts` | 雅思训练入口 |
| `/app/ielts-reading` | 雅思阅读套题列表 |
| `/app/ielts-reading/test/:testId` | 雅思阅读答题页 |
| `/app/ielts-listening` | 雅思听力套题列表 |
| `/app/ielts-listening/test/:testId` | 雅思听力答题页 |
| `/app/notebook` | 生词本 |
| `/app/profile` | 账号与学习统计 |
| `/app/settings` | 学习偏好设置 |

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 6 |
| UI | Tailwind CSS v4, lucide-react, motion/react, animal-island-ui |
| Backend | Express, tsx |
| Auth / DB | Supabase Auth, Supabase Postgres |
| Storage | Supabase Storage |
| AI | Google Gemini via `@google/genai` |
| Audio | Google TTS + Supabase Storage + browser speech fallback |

## 项目结构

| 路径 | 说明 |
| --- | --- |
| `src/RootApp.tsx` | 顶层路由、鉴权保护、公开页面 |
| `src/App.tsx` | 登录后 App 状态、学习 / 复习流、主要路由 |
| `src/components/home/HomeView.tsx` | Daily Routine 首页 |
| `src/components/library/LibraryView.tsx` | 词库、词组详情、官方词库详情 |
| `src/components/library/OfficialLibraryPanel.tsx` | 官方词库入口与顺序 / 乱序学习 |
| `src/components/library/SavedWordsPanel.tsx` | 生词池、选词组学习、已掌握清理 |
| `src/components/import/ImportView.tsx` | 自定义单词导入与 AI 预览 |
| `src/components/learning/LearningEngine.tsx` | Round 1 / 2 / 3 / 复习共用学习引擎 |
| `src/components/learning/Round2ClozePrompt.tsx` | Round 2 例句填空与词形提示 |
| `src/components/learning/ArticleView.tsx` | 文章巩固展示 |
| `src/components/ielts/IeltsReadingView.tsx` | 雅思阅读列表、答题、回看 |
| `src/components/ielts/IeltsListeningView.tsx` | 雅思听力列表、答题、回看 |
| `src/components/notebook/NotebookView.tsx` | 生词本 |
| `src/components/shared/WordPopover.tsx` | 点词查询与加入词库 |
| `src/components/settings/SettingsView.tsx` | 学习偏好设置 |
| `src/lib/officialLibrary.ts` | 官方词库定义、批次计划、顺序 / 乱序逻辑 |
| `src/lib/learningSessionApi.ts` | 学习会话持久化与恢复 |
| `src/lib/reviewApi.ts` | 复习接口 |
| `src/lib/ieltsReadingApi.ts` | 雅思阅读接口 |
| `src/lib/ieltsListeningApi.ts` | 雅思听力接口 |
| `shared/server/review-domain.ts` | 纯复习状态规则 |
| `shared/server/review.ts` | 复习状态写入、到期队列、事件记录 |
| `shared/server/gemini.ts` | AI 词条增强与文章生成 |
| `shared/server/home.ts` | 首页概览、连续学习、Daily Routine 汇总 |
| `shared/server/library.ts` | 词库、官方主线丢弃、生词保存 |
| `shared/server/audio.ts` | 单词音频生成与缓存 |
| `shared/server/exampleAudio.ts` | 例句音频生成与缓存 |
| `shared/server/ieltsAttempts.ts` | 雅思阅读 / 听力提交记录 |
| `server/index.ts` | 本地 Express API 入口 |
| `supabase/functions/api/index.ts` | Supabase Edge Function 入口 |
| `supabase/schema.sql` | 当前完整数据库结构 |

## API 概览

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/vocab/enrich` | 批量 AI 生成完整词条 |
| `POST` | `/api/vocab/lite-enrich` | 单词轻量词条增强 |
| `POST` | `/api/vocab/lemmatize` | 单词词形归一 |
| `POST` | `/api/vocab/lemmatize-batch` | 批量词形归一 |
| `POST` | `/api/vocab/lookup` | 点词查询 |
| `POST` | `/api/vocab/report` | 提交词条问题反馈 |
| `POST` | `/api/vocab/full-enrich` | 为已有词条排队补齐完整信息 |
| `POST` | `/api/vocab/persist` | 保存结构化词条 |
| `POST` | `/api/vocab/article` | 为一组词生成文章句子和逐句中文翻译 |
| `POST` | `/api/review/attempt` | 写入单次复习 / Round 2 判定 |
| `POST` | `/api/review/batch-attempt` | 批量写入判定 |
| `POST` | `/api/review/unknown` | 标记不认识 |
| `POST` | `/api/review/mastered` | 手动标记已掌握 |
| `GET` | `/api/review/due` | 获取当前用户到期复习队列 |
| `GET` | `/api/home/overview` | 获取首页统计、轨迹、Routine 卡片 |
| `POST` | `/api/ielts/reading/attempts` | 提交雅思阅读记录 |
| `POST` | `/api/ielts/listening/attempts` | 提交雅思听力记录 |
| `POST` | `/api/library/official/:libraryId/discard-active` | 丢弃官方词库当前未完成主线组 |
| `POST` | `/api/library/saved-words` | 保存生词 |
| `POST` | `/api/library/saved-words/cleanup` | 清理生词池历史结构 |
| `DELETE` | `/api/library/saved-words/:vocabularyItemId` | 从生词池移除一个词 |
| `DELETE` | `/api/library/groups/:groupId` | 删除用户词组 |
| `GET` | `/api/audio/:word` | 获取或生成单词音频 |
| `POST` | `/api/audio/batch` | 批量预热单词音频 |
| `POST` | `/api/example-audio` | 获取或生成例句音频 |
| `GET` | `/api/health` | 健康检查 |

需要用户身份的接口通过 Supabase access token 鉴权，前端统一由 `src/lib/api.ts` 附带 `Authorization: Bearer <token>`。

## 数据库

运行 `supabase/schema.sql` 会创建当前完整结构。主要数据域包括：

- 词条基础数据：`vocabulary_items`、`vocabulary_senses`、`vocabulary_morphology_parts`、`vocabulary_relations`、`confused_words`、`vocabulary_item_forms`。
- 学习组：`learning_groups`、`learning_group_words`，以及 `learning_groups` 上的会话恢复字段。
- 复习系统：`review_states`、`review_events`。
- 首页与日常进度：`daily_routine_progress`、`streak_protection_events`。
- 个人生词：`user_saved_words`。
- 音频缓存：`example_audio_cache`，以及词条上的英 / 美音频 URL。
- 雅思阅读：`ielts_reading_books`、`ielts_reading_tests`、`ielts_reading_passages`、`ielts_reading_questions`、`ielts_reading_attempts`、`ielts_reading_responses` 等。
- 雅思听力：`ielts_listening_books`、`ielts_listening_tests`、`ielts_listening_sections`、`ielts_listening_questions`、`ielts_listening_attempts`、`ielts_listening_responses` 等。
- 用户设置：`user_settings`。

当前 schema 已包含 RLS。词条基础数据仍开放必要读写策略；用户进度、复习、生词、雅思提交记录和设置等表按 `auth.uid()` 绑定用户。

## 环境变量

在项目根目录创建 `.env`：

```env
# Frontend
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-key>
VITE_API_BASE_URL=https://<your-project>.supabase.co/functions/v1/api
VITE_GOOGLE_AUTH_ENABLED=false
VITE_AI_CONTENT_FEATURES_ENABLED=true
VITE_PERSONAL_VOCAB_IMPORT_ENABLED=true

# Backend
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
LUMINA_SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
GEMINI_API_KEY=<your-gemini-api-key>
GOOGLE_TTS_API_KEY=<your-google-tts-api-key>
LUMINA_APP_ORIGINS=http://localhost:3000,https://lumina-1oi.pages.dev,https://lumina.college
PORT=4000

# Optional Gemini tuning
GEMINI_ENRICH_MODEL=gemini-2.5-flash
GEMINI_ARTICLE_MODEL=gemini-2.5-flash
GEMINI_ENRICH_BATCH_SIZE=10
GEMINI_ENRICH_MAX_CONCURRENCY=5
GEMINI_ENRICH_MAX_OUTPUT_TOKENS=8192

# Optional scripts
SUPABASE_ACCESS_TOKEN=<supabase-management-token>
SUPABASE_DB_PASSWORD=<database-password>
LOG_LEVEL=info
```

本地开发时，Vite 会把 `/api/*` 代理到 `http://localhost:4000`，因此 `VITE_API_BASE_URL` 可以临时留空。生产部署时，需要把它设置为 Supabase Edge Function 网关：`https://<project-ref>.supabase.co/functions/v1/api`。

## 本地启动

前置条件：

- Node.js 18+
- Supabase 项目，包含 Auth、Postgres 和 Storage
- Google Gemini API Key
- Google TTS API Key，音频接口需要

安装依赖：

```bash
npm install
```

初始化数据库：

- 方式 1：打开 Supabase Dashboard -> SQL Editor，运行 `supabase/schema.sql` 的全部内容。
- 方式 2：使用项目脚本，需配置 `SUPABASE_DB_PASSWORD`。

```bash
node scripts/run-migration.mjs
```

`scripts/run-migration.mjs` 会读取 `supabase/schema.sql` 并连接脚本内配置的 Supabase Postgres host。换项目或换 Supabase 实例时，需要先检查脚本里的数据库 host。

启动后端 API：

```bash
npm run server
```

启动前端：

```bash
npm run dev
```

默认访问：

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`
- Health check: `http://localhost:4000/api/health`

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 前端，端口 3000 |
| `npm run server` | 使用 `.env` 启动 Express API，端口默认 4000 |
| `npm run start` | 生产环境启动 API，不自动加载 `.env` |
| `npm run build` | 生产构建前端 |
| `npm run preview` | 预览构建结果 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run format:check` | Prettier 格式检查 |
| `npm run test:unit` | Vitest 单元测试 |
| `npm run test:core` | 核心学习 / 复习 / 词库脚本测试 |
| `npm run test:ielts` | 雅思阅读与听力脚本测试 |
| `npm run test:all` | 单元测试 + 核心脚本 + 雅思脚本 |
| `npm run fetch:ielts-vocab` | 更新 IELTS 词库数据 |
| `npm run seed:official-vocab` | 预加载官方词库 AI 词条 |
| `npm run seed:official-audio` | 预热官方词库音频 |
| `npm run import:ielts-reading` | 导入雅思阅读题库 |
| `npm run import:ielts-listening` | 导入雅思听力题库 |

## 验证

提交前建议至少运行：

```bash
npm run lint
npm run typecheck
npm run build
npm run test:core
```

如果修改了雅思相关逻辑，再补充：

```bash
npm run test:ielts
```

如果修改了 Supabase Edge Function：

```bash
npm run check:edge
```

## 部署说明

项目生产环境采用 Cloudflare Pages + Supabase：

- 前端：构建后产物在 `dist/`，可部署到 Cloudflare Pages、Vercel、Netlify 等静态站点平台。
- 后端：生产 API 部署到 Supabase Edge Functions，入口为 `supabase/functions/api/index.ts`。
- 数据库与鉴权：Supabase 项目需要配置 schema、Auth redirect URL、Storage bucket 和必要环境变量。

部署时需要注意：

- 前端平台设置 `VITE_API_BASE_URL` 指向 Supabase Function 网关。
- Supabase Function secrets 设置 `LUMINA_APP_ORIGINS` 为允许访问的前端域名，否则 CORS 会拒绝浏览器请求。
- Supabase Function 使用 `--no-verify-jwt` 部署，由函数内部按接口决定公开访问或 Bearer token 鉴权。
- Supabase Auth 的 Site URL 和 Redirect URLs 需要包含生产域名及 `/auth`。
- 如果开启 Google 登录，需要在 Supabase 和 Google Cloud 同时配置 OAuth client、callback URL 和发布状态。

## 当前项目定位

Lumina 当前是一套“先登录、再学习、能从上次继续、会按真实记忆状态安排复习”的英语学习产品。它已经覆盖官方考试词库、自定义导入、AI 词条增强、四段式学习、文章巩固、状态驱动复习、生词本、点词查询、账号级学习偏好同步，以及 Cambridge IELTS 阅读和听力真题训练。
