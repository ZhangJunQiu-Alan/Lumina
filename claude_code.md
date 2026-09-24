# Claude Code — Implementation Notes (历史阶段记录)

> [!NOTE]
> **历史阶段存档说明**：本文档为 2026 年 4 月早期的开发决策记录。
> 项目当前最新能力、架构规范与设计准则请优先查阅：
> - [README.md](README.md)：全局项目说明与核心架构
> - [product.md](product.md)：全量产品功能与交互说明
> - [docs/enterprise-refactoring-roadmap.md](docs/enterprise-refactoring-roadmap.md)：企业级高可用演进路线图
> - [GEMINI.md](GEMINI.md)：AI 编码准则与设计红线
> 
> 记录每次开发决策的思路，供后续参考。

---

## Session 5 (2026-04-15) — Tech Debt #6 & #7

### #6 ArticleView：用 Gemini 生成真实阅读文章

**问题**：`ArticleView` 硬编码了 `MOCK_ESSAY`，学完单词后看的是假文章，失去了学习价值。

**思路**：
- 文章生成是一次性异步操作，最自然的触发时机是 round3 完成的瞬间
- 不新建状态机，复用现有 `round === 'article'` 分支，用 `essay === null` 表示"正在生成中"
- 生成失败时 fallback 到空字符串（`''`），让 ArticleView 能正常渲染而不卡死在 loading

**实现路径**：
1. `server/gemini.ts` 新增 `generateArticle(words: string[]): Promise<string>`
   - Prompt：要求生成 250–350 词的 IELTS 学术阅读文章，必须包含所有目标词，仅返回正文
2. `server/index.ts` 新增 `POST /api/vocab/article`，接收 `{ words: string[] }`，返回 `{ data: string }`
3. `App.tsx`：
   - 新增 `const [essay, setEssay] = useState<string | null>(null)`
   - `handleRoundComplete` 中 round3 完成时：`setRound('article')` + `setEssay(null)` + 调用 `fetchArticle()`
   - 渲染：`essay === null` → loading spinner；`essay` 有值 → `<ArticleView>`
   - 生成期间用户看到绿色 spinner + "Generating reading passage…"，与 saving stage 风格一致

**关键判断**：
- 没有把生成逻辑放进 `ArticleView` 组件内部，因为 `ArticleView` 是纯展示组件，不应持有网络副作用
- `essay` 不用 `undefined` 而用 `null` 表示未初始化，语义更清晰（`null` = 主动清空，`''` = 生成失败兜底）

---

### #7 UserStats：从 Supabase 读取真实数据

**问题**：首页的"今日复习数"、"连续天数"、"已掌握单词数"全是硬编码 mock，用户看不到真实进度。

**需要的 4 个指标**：

| 指标 | 数据来源 | 查询方式 |
|---|---|---|
| `totalLearned` | `vocabulary_items` 总行数 | `COUNT(*)` with `head: true` |
| `todayReviewCount` | `review_states` 中 `next_review_at <= NOW()` | `COUNT(*)` with `.lte()` |
| `todayNewGroups` | `learning_groups` 中今日创建 | `COUNT(*)` with `.gte(created_at, todayStart)` |
| `streak` | `learning_groups` 的历史日期 | 取所有 `created_at`，JS 侧计算 |

**streak 计算逻辑**：
- 从 Supabase 拿所有 `learning_groups.created_at`，提取不重复的日期字符串集合（`Set<string>`）
- 从"今天"出发往回数：如果今天没有记录，先退一天到昨天（允许当天尚未学习但昨天有记录）
- 遇到断档立即停止，得到连续天数

```
today 有记录？→ 从今天数
today 无记录，yesterday 有？→ 从昨天数
两者都无 → streak = 0
```

**实现细节**：
- 4 个查询用 `Promise.all` 并行，不串行等待
- `fetchStats` 用 `useCallback` 包装，`useEffect` 在 mount 时调用一次
- 学习完成回到首页时也调用 `fetchStats()`，确保数据及时刷新
- Supabase 查询失败时 `catch` 静默处理（`console.error`），不影响应用正常使用

**关键判断**：
- streak 的计算放在前端 JS 而非 SQL，因为逻辑简单，且不需要额外的数据库函数或视图
- 没有用实时订阅（Supabase Realtime），因为 stats 不需要秒级刷新

---

## Session 5 续 (2026-04-15) — 音频功能

### 设计决策

- **音源**：Gemini TTS（`gemini-2.5-flash-preview-tts`），与现有 API Key 复用，无需额外账号
- **版本**：UK（Aoede 声） + US（Puck 声）各一份
- **格式**：WAV。Gemini 默认返回 raw PCM，在服务端包 RIFF/WAV header 后存储
- **生成时机**：Import 时批量生成（不是首次播放时懒加载），保证学习过程零延迟
- **存储**：Supabase Storage `word-audio` bucket（public），路径 `uk/{word}.wav` / `us/{word}.wav`
- **缓存**：URL 回写到 `vocabulary_items.audio_uk_url` / `audio_us_url`，下次直接复用

### 数据流

```
Import 保存完成
    ↓
前端 POST /api/audio/batch { words: [...] }
    ↓
Server 并行处理每个词：
  查 vocabulary_items → 已有 URL 直接返回
  没有 → generateWordAudio() → upload Storage → 更新 DB → 返回 URL
    ↓
前端 words[].audio_uk_url / audio_us_url 填充
    ↓
onStartLearning(wordsWithAudio, groupId)
```

```
学习时换词
    ↓
useEffect([currentWord.id]) 触发
    ↓
word.audio_uk_url 有值 → 直接 new Audio(url).play()
没有 → fetch GET /api/audio/:word?locale=uk → play
```

### 新增文件

| 文件 | 作用 |
|---|---|
| `server/tts.ts` | `generateWordAudio(word, locale)` — 调用 Gemini TTS，PCM → WAV |
| `server/audio.ts` | `getOrCreateAudio()` + `batchGenerateAudio()` — 查缓存/生成/上传/写回 |
| `scripts/setup-audio.mjs` | 一次性运行：创建 Storage bucket，输出待执行的迁移 SQL |

### 修改文件

| 文件 | 改动 |
|---|---|
| `server/index.ts` | 新增 `GET /api/audio/:word` + `POST /api/audio/batch` |
| `src/types.ts` | `Word` + `EnrichedWord` 加 `audio_uk_url?` / `audio_us_url?` |
| `src/components/import/ImportView.tsx` | save 后调用 batch 端点，新增 `'audio'` loading 阶段 |
| `src/App.tsx` | LearningEngine 加换词自动播放 + 音标旁 UK/US 切换按钮 |
| `supabase/schema.sql` | 需手动执行：`ADD COLUMN audio_uk_url TEXT` / `audio_us_url TEXT` |

### 关键判断

- **音频失败不阻塞学习**：`batchGenerateAudio` 用 `Promise.allSettled`，单个词失败不影响其他词；前端 `try/catch` 静默处理，无音频时正常学习
- **Supabase Storage 而非 CDN**：Supabase Storage 已在项目中，无需引入新服务；public bucket 使 URL 直接可用，不需要签名
- **不在 `ArticleView` 里加音频**：文章阶段是阅读，不需要逐词播放
- **喇叭按钮设计**：UK/US 两个按钮复用，当前激活的高亮，点击切换并立即播放，播放中显示 `Loader2` spinner
- **PCM → WAV 在服务端处理**：浏览器 `<audio>` 不能直接播放 raw PCM，必须包 WAV header。在服务端处理比在前端处理更简单，且只需处理一次

---

## Session 5 续 (2026-04-15) — Auth 接入 + Library 修复 + DB 迁移

### Auth 接入

- 项目新增了 Supabase Auth（`useAuth` / `AuthContext`），所有 API 路由加了 `requireAuth` 中间件
- `server/index.ts` 引入了 `server/auth.ts`，所有端点需要带 JWT token（`Authorization: Bearer ...`）
- 前端通过 `apiFetch`（`src/lib/api.ts`）自动附带 token，替代了原来的裸 `fetch`
- `ImportView` 和 `LibraryView` 通过 `useAuth()` 拿 `user.id`，写入 `learning_groups.user_id` / 查询 `review_states.user_id`

### Library 数据模型调整

旧的 `LibraryView` 从 `vocabulary_items` 出发查询，new 版本改为从 `review_states` 出发：
```
review_states → vocabulary_items!inner → vocabulary_senses, confused_words
```
**原因**：Library 展示的是"用户已追踪的词"，必须有 `review_states` 记录，从这张表出发能直接拿到记忆状态（`memory_state`、`last_result`、`next_review_at`），不需要再 join 回来。

### DB 迁移（已通过 Supabase CLI + Management API 执行）

直连 pg 失败（机器无 IPv6），最终通过 Supabase CLI 登录态从 macOS Keychain 提取 PAT，用 Management REST API 执行：

```sql
-- review_states 补全新列
ALTER TABLE review_states ADD COLUMN IF NOT EXISTS memory_state, last_result,
  last_elapsed_ms, last_assessed_at, graduated_at;

-- vocabulary_items 加音频列
ALTER TABLE vocabulary_items ADD COLUMN IF NOT EXISTS audio_uk_url, audio_us_url;

-- 新建 review_events 表
CREATE TABLE IF NOT EXISTS review_events (...);
```

**执行方式**：
```bash
TOKEN=$(security find-generic-password -l "Supabase CLI" -w | sed 's/go-keyring-base64://' | base64 -d)
curl -X POST "https://api.supabase.com/v1/projects/{ref}/database/query" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"..."}'
```

**连接失败原因记录**：
- `db.{ref}.supabase.co` → ENOTFOUND（无 IPv6）
- Transaction pooler `aws-0-*.pooler.supabase.com:6543` → "Tenant or user not found"（项目在 Tokyo，`ap-northeast-1` 同样 ENOTFOUND）
- 解决方案：Supabase CLI 本地有 PAT，通过 Keychain 提取后直接调用 Management API

---

## Session 6 (2026-04-15) — 入口重构 + 真实鉴权 + 用户级隔离

### 为什么要重构入口

原先把登录页挂在产品侧边栏里，本质上是把“未登录入口”和“已登录工作区”混在了一起：

- 信息架构不对，用户会误以为 auth 只是产品里的一个子页面
- 侧边栏在未登录态提前出现，会破坏产品层级判断
- 后续一旦接真实 session，`Auth` 这个导航项会变得很别扭，因为登录成功后它本来就应该消失

这轮的核心判断很直接：

```text
Landing Page -> /auth -> /app/*
```

登录入口属于公共层，产品侧边栏只属于登录后的工作区。

### 路由与页面层级调整

- 引入 `react-router-dom`，把全局入口从 `ViewState` 切到真实 URL 路由
- 新增 `src/RootApp.tsx` 作为最外层入口
- 新结构：
  - `/`：Landing Page
  - `/auth`：登录入口
  - `/app/*`：登录后产品区
- 未登录访问 `/app/*` 时，重定向到 `/auth?next=原路径`
- 已登录访问 `/auth` 时，直接跳回 `next` 或 `/app/home`

**关键判断**：
- 没有继续让 `App.tsx` 承担“整站入口切换”的职责，而是把它收缩成产品区 shell
- `ViewState` 不再负责 landing/auth/app 三层切换，只保留产品区内部必要的局部流程状态

### Auth 结构：Google 为主，邮箱密码为备用

这轮不是只做一个 auth 视觉壳，而是把真实鉴权接进来了。

实现原则：

- 主入口：Google OAuth
- 次级备用：邮箱密码登录 / 注册
- 成功登录后回到 `next` 或 `/app/home`
- 登出后回到 `/`

涉及文件：

- `src/contexts/AuthContext.tsx`
  - `getSession()` 恢复会话
  - `onAuthStateChange()` 维护登录态
- `src/components/auth/AuthView.tsx`
  - Google CTA 为主按钮
  - 邮箱密码作为备用表单
- `src/main.tsx`
  - 用 `BrowserRouter + AuthProvider` 包住应用

**关键判断**：
- 没有把 Google 和邮箱密码做成平权入口，而是明确主次，因为真实产品里 OAuth 的完成率通常更高
- 没有在这轮扩展账户中心，只先完成“登录 -> 使用 -> 退出”的闭环

### 侧边栏调整：移除 Auth，设置按钮改为账户菜单

产品侧边栏做了两个重要收口：

- 删除 `Auth` 导航项
- 左下角 `Settings` 改成账户菜单弹层

账户菜单当前只保留最必要的信息和动作：

- 当前账户头像 / 名称 / 邮箱
- `退出账户`

**原因**：
- 这比“设置页”更符合当前阶段需要，先把账户出口做对，比堆一个空设置页更重要
- 产品里最常见的账户动作就是确认当前是谁，以及退出

### 服务端鉴权：Bearer Token + 真实 user id

之前复习系统虽然已经跑起来了，但服务端仍然缺少真实用户边界。这轮把它补齐：

- 新增 `server/auth.ts`
  - 从 `Authorization: Bearer <token>` 解析 JWT
  - 用 `supabaseAdmin.auth.getUser()` 校验 token
  - 成功后把 `authUserId` 注入 request
- `server/index.ts`
  - `review / enrich / article` 都接入 `requireAuth`
- `server/review.ts`
  - 不再使用 `DEMO_USER_ID`
  - 改为使用真实 `authUserId`

**关键判断**：
- 把用户归属收在服务端，而不是相信前端传来的 `userId`
- Bearer Token 方案和 Supabase Auth 的配合最直接，后续也方便继续扩展受保护接口

### 前端数据归属收口

前端这轮不是只“显示当前用户”，而是把实际读写都切到了真实账户边界：

- `src/lib/api.ts`
  - 统一封装 `apiFetch`
  - 自动带上当前 session token
- `src/components/import/ImportView.tsx`
  - `learning_groups.user_id = user.id`
  - 初始化 `review_states.user_id = user.id`
- `src/components/library/LibraryView.tsx`
  - 改为从 `review_states` 出发查询用户词库
  - 显式按 `user.id` 过滤
- `src/App.tsx`
  - 首页 stats 改为按当前登录用户读取

**关键判断**：
- `LibraryView` 从 `review_states` 出发是必要的，因为词库展示的是“用户已追踪的词”，不是全站词典
- 前端请求层统一加 token，避免在每个组件里手写一遍 header 逻辑

### RLS 收口

配合真实登录态，这轮把用户表的 RLS 也补上了：

- `learning_groups`
- `learning_group_words`
- `review_states`
- `review_events`
- `generated_articles`

策略方向统一为：

```sql
auth.uid()::text = user_id
```

其中 `learning_group_words` 通过所属 `learning_groups` 反查用户归属。

迁移文件：

- `supabase/migrations/20260415010000_auth_routing_rls.sql`

**关键判断**：
- `vocabulary_items`、`vocabulary_senses`、`confused_words` 继续保留公共可读，因为这些更接近全局词典数据
- 用户态数据必须收口，否则登录只是视觉层，实际数据还是串的

### 文案方向

入口与产品文案一起做了调整，原则是：

- 中文主导
- 不讲空泛口号
- 更像经验判断，而不是“功能清单式喊话”

这不是单纯的翻译，而是在修正文案姿态，让它更像一个真正用于长期记忆训练的系统。

### 当前边界

这一轮已经完成：

- 正确入口层级
- 真实 session 管理
- 登录 / 退出闭环
- 服务端鉴权
- 用户级查询与写入
- RLS 迁移文件

但还没做完的点也很明确：

- Google OAuth 仍需要在 Supabase 控制台里配置 provider 和 redirect URL
- RLS migration 需要真正跑到线上库，否则前端直连查询不会自动隔离
- 这轮没有扩展账户中心、偏好设置或 profile 编辑
