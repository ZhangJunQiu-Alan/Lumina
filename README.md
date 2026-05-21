# Lumina

Lumina 是一套状态驱动的英语词汇学习系统。它不是只记录“答对 / 答错”，而是持续判断每个词目前处在什么记忆状态，并据此安排学习、复习、会话恢复和长期回顾。

当前产品已经支持官方词库、自定义导入、AI 词条增强、四段式学习、文章巩固、状态驱动复习、Daily Routine 首页、学习偏好设置和账号级进度同步。

## 当前使用路径

用户真实路径：

```text
登录 -> 首页 -> 今日到期复习 -> 继续未完成学习或开始新一组
     -> Round 1 -> Round 2 -> Round 3 -> 文章巩固 -> 长期复习
```

当前路由：

| 路由 | 用途 |
| --- | --- |
| `/` | Landing Page，产品介绍与进入入口 |
| `/auth` | 登录 / 注册 |
| `/privacy` | 隐私政策 |
| `/terms` | 服务条款 |
| `/app/*` | 登录后的正式学习区 |

账号体系基于 Supabase Auth。邮箱登录 / 注册始终可用；Google 登录由 `VITE_GOOGLE_AUTH_ENABLED` 控制，只有完成 Supabase Google Provider 配置后才建议开启。

## 核心能力

- **官方词库学习**：内置“雅思词汇真经”和“GRE镇考机经词 7.0”，支持顺序 / 乱序，每组默认 30 词，已学过词会自动跳过。
- **自定义导入**：支持粘贴单词，按换行或逗号切分，最多取前 30 个词，AI 生成预览后保存为个人词组。
- **AI 词条增强**：为单词生成英美音标、中文释义、义项、例句、构词拆解、派生词、近义词、反义词、易混词和记忆提示。
- **四段式学习**：Round 1 明示关联，Round 2 语境填空主动回忆，Round 3 快速识别确认，最后用文章巩固整组词。
- **状态驱动复习**：系统使用 5 个记忆状态安排复习，而不是二元正确率。
- **会话恢复**：学习中途离开后，下次可以从上次的轮次、位置和队列继续。
- **Daily Routine 首页**：展示连续学习、完美打卡、今日复习、新学数量和继续学习 CTA。
- **设置同步**：默认发音、自动播放、重复次数、播放间隔、错题停留时长、Round 3 / 文章巩固开关会跟随账号保存。
- **音频能力**：单词和例句音频优先复用缓存，缺失时按需生成，远端不可用时回退到浏览器发音。

## 官方词库

| ID | 名称 | 词数 | 每组 |
| --- | --- | ---: | ---: |
| `ielts-vocab` | 雅思词汇真经 | 3631 | 30 |
| `gre-zhenkao-v7` | GRE镇考机经词 7.0 | 1351 | 30 |

官方词库支持：

- 顺序学习
- 乱序学习
- 从未完成进度继续
- 自动跳过已经实际学过的词
- 主线学习组丢弃后，已学词保留进入复习计划，未学词回到官方词池

## 学习流程

### Round 1：明示关联

Round 1 展示完整词条信息，帮助用户先把词形、发音和含义对上。页面会展示：

- 单词与音标
- 中文释义
- 词性与例句
- 构词拆解
- 派生词、近义词、反义词
- 易混词与记忆提示

### Round 2：语境复现

Round 2 是当前长期记忆状态的首次正式判定入口。它优先使用例句填空：

- 页面展示挖空例句
- 用户输入正确词形
- 系统提供词形提示，例如原型、过去式、过去分词、复数等
- 如果没有合适例句，则回退到原本的拼写输入

### Round 3：快速确认

Round 3 关注“看到英文时能否快速对应含义”：

- 先展示英文单词与发音
- 中文释义默认收起
- 用户先做快速判断
- 再显示释义确认

### 文章巩固

学习阶段结束后，系统会生成一段 IELTS 风格短文，把本组词自然放回上下文。文章会直接出现在学习流里，并同时生成逐句中文翻译；英文与翻译只保存在浏览器本地单篇缓存中，不写入数据库。

## 记忆状态与复习规则

Lumina 的 SRS 逻辑以状态为核心：

| 状态 | 中文含义 | 当前间隔 |
| --- | --- | --- |
| `new` | 新词 | 暂不排入长期复习 |
| `fuzzy` | 模糊 | 约 1 天后再见 |
| `slow_recall` | 慢回忆 | 约 3 天后再见 |
| `stable_recall` | 稳回忆 | 约 7 天后再见 |
| `mastered` | 已掌握 / 毕业 | 不再进入日常到期队列 |

关键规则：

- 回忆耗时超过 `6000ms` 的正确答案会被视为 `slow_correct`。
- Round 2 会把 `new` 词首次落入 `fuzzy`、`slow_recall` 或 `stable_recall`。
- 日常复习会沿 `new -> fuzzy -> slow_recall -> stable_recall -> mastered` 推进。
- `stable_recall` 需要累计成功次数达到 3 才会进入 `mastered`。
- 日常复习答错时，该词不会立刻从当天队列消失。
- 首页的“已掌握单词数”当前按 `stable_recall` 数量统计，这是当前产品展示口径；`mastered` 仍表示真正毕业状态。

规则实现集中在：

- `server/review-domain.ts`
- `server/review.ts`
- `scripts/test-review-rules.ts`

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 6 |
| UI | Tailwind CSS v4, lucide-react, motion/react |
| Backend | Express, tsx |
| Auth / DB | Supabase Auth, Supabase Postgres |
| AI | Google Gemini via `@google/genai` |
| Audio | Google TTS + Supabase Storage + browser speech fallback |

## 前置条件

- Node.js 18+
- Supabase 项目，包含 Auth、Postgres 和 Storage
- Google Gemini API Key
- Google TTS API Key，音频接口需要

## 项目结构

| 路径 | 说明 |
| --- | --- |
| `src/RootApp.tsx` | 顶层路由、鉴权保护、公开页面 |
| `src/App.tsx` | 登录后 App 状态、首页 / 词库 / 导入 / 学习流切换 |
| `src/components/home/HomeView.tsx` | Daily Routine 首页与记忆疆域概览 |
| `src/components/import/ImportView.tsx` | 自定义单词导入与 AI 预览 |
| `src/components/library/LibraryView.tsx` | 词库、词组详情、记忆状态查看 |
| `src/components/library/OfficialLibraryPanel.tsx` | 官方词库入口、顺序 / 乱序发放 |
| `src/components/learning/LearningEngine.tsx` | Round 1 / 2 / 3 / 复习共用学习引擎 |
| `src/components/learning/Round2ClozePrompt.tsx` | Round 2 例句填空与词形提示 |
| `src/components/learning/ArticleView.tsx` | 文章巩固展示 |
| `src/components/review/ReviewResultsView.tsx` | 复习结果与状态变化总结 |
| `src/components/settings/SettingsView.tsx` | 学习偏好设置 |
| `src/lib/officialLibrary.ts` | 官方词库定义、批次计划、顺序 / 乱序逻辑 |
| `src/lib/learningSessionApi.ts` | 学习会话持久化、恢复 |
| `src/lib/articleCache.ts` | Round 4 英文与中文翻译的单篇本地缓存 |
| `src/lib/learningPreferences.ts` | 用户学习偏好读写与本地兜底 |
| `src/lib/cloze.ts` | Round 2 词形与挖空逻辑 |
| `server/index.ts` | Express API 入口 |
| `server/gemini.ts` | AI 词条增强与文章生成 |
| `server/review-domain.ts` | 纯复习状态规则 |
| `server/review.ts` | 复习状态写入、到期队列、事件记录 |
| `server/home.ts` | 首页概览、连续学习、Daily Routine 汇总 |
| `server/library.ts` | 学习组删除、官方主线丢弃 |
| `server/audio.ts` | 单词音频生成与缓存 |
| `server/exampleAudio.ts` | 例句音频生成与缓存 |
| `supabase/schema.sql` | 当前完整数据库结构 |

## API 概览

| Method | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/vocab/enrich` | AI 生成词条结构化数据 |
| `POST` | `/api/vocab/article` | 为一组词生成文章句子和逐句中文翻译 |
| `POST` | `/api/review/attempt` | 写入单次复习 / Round 2 判定 |
| `POST` | `/api/review/batch-attempt` | 批量写入判定 |
| `GET` | `/api/review/due` | 获取当前用户到期复习队列 |
| `GET` | `/api/home/overview` | 获取首页统计、星轨、Routine 卡片 |
| `POST` | `/api/library/official/:libraryId/discard-active` | 丢弃官方词库当前未完成主线组 |
| `DELETE` | `/api/library/groups/:groupId` | 删除用户词组 |
| `GET` | `/api/audio/:word` | 获取或生成单词音频 |
| `POST` | `/api/audio/batch` | 批量预热单词音频 |
| `POST` | `/api/example-audio` | 获取或生成例句音频 |
| `GET` | `/api/health` | 健康检查 |

需要用户身份的接口通过 Supabase access token 鉴权，前端统一由 `src/lib/api.ts` 附带 `Authorization: Bearer <token>`。

## 数据库

运行 `supabase/schema.sql` 会创建当前完整结构。主要表包括：

- `vocabulary_items`
- `vocabulary_senses`
- `vocabulary_morphology_parts`
- `vocabulary_relations`
- `confused_words`
- `learning_groups`
- `learning_group_words`
- `review_states`
- `review_events`
- `generated_articles`（保留表；当前 Round 4 不再写入）
- `example_audio_cache`
- `streak_protection_events`
- `daily_routine_progress`
- `user_settings`

当前 schema 已包含 RLS。词条基础数据仍开放读写策略，用户进度、复习、文章、设置等表按 `auth.uid()` 绑定用户。

## 环境变量

在项目根目录创建 `.env`：

```env
# Frontend
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-key>
VITE_API_BASE_URL=https://<your-project>.supabase.co/functions/v1/api
VITE_GOOGLE_AUTH_ENABLED=false

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

访问：

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
| `npm run lint` | TypeScript 类型检查 |
| `npm run test:review` | 复习状态规则测试 |
| `npm run test:cloze` | Round 2 挖空与词形逻辑测试 |
| `npm run test:enrichment` | AI 词条归一化测试 |
| `npm run test:session` | 学习会话测试 |
| `npm run test:word-batch` | 单词批次校验测试 |
| `npm run fetch:ielts-vocab` | 更新 IELTS 词库数据 |
| `npm run seed:official-vocab` | 预加载官方词库 AI 词条 |
| `npm run seed:official-audio` | 预热官方词库音频 |

## 验证

提交前建议至少运行：

```bash
npm run lint
npm run build
npm run test:review
npm run test:cloze
npm run test:word-batch
```

如果修改了 AI 词条、学习会话或官方词库相关逻辑，再补充：

```bash
npm run test:enrichment
npm run test:session
npx tsx scripts/test-official-library.ts
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

Lumina 当前是一套“先登录、再学习、能从上次继续、会按真实记忆状态安排复习”的英语词汇系统。它已经支持官方词库与自定义导入、四段式学习、文章巩固、状态驱动复习、会话恢复、学习偏好同步和音频增强，适合围绕考试词汇做持续记忆、复习和回顾。
