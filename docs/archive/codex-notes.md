# Codex Work Summary (历史阶段记录)

> [!NOTE]
> **历史阶段存档说明**：本文档为 2026 年 4 月早期的开发阶段记录。
> 项目当前最新能力、架构规范与设计准则请优先查阅：
> - [README.md](../../README.md)：全局项目说明与核心架构
> - [product.md](../product/product.md)：全量产品功能与交互说明
> - [docs/enterprise-refactoring-roadmap.md](../enterprise-refactoring-roadmap.md)：企业级高可用演进路线图
> - [GEMINI.md](../../GEMINI.md)：AI 编码准则与设计红线
> 
> 原始更新时间：2026-04-18  
> 目的：记录当前由 Codex 已完成的核心工作，作为后续继续设计和开发单词复习系统的接手说明。

---

## 0. 本次更新（2026-04-18）

### 官方词库导入链路

- 官方词库入口已改成“先查库、缺的再补、补齐后直接开始”，不再停留在独立的 preview / saving / audio 等中间阶段。
- `src/lib/importFlow.ts` 已拆出可复用能力：
  - `fetchVocabularyEntriesByWords()`
  - `persistEnrichedVocabularyEntries()`
  - `createLearningGroupFromVocabularyEntries()`
- 现有官方词条会优先复用数据库里已经完整可用的内容，只有缺失词才会再调用 `/api/vocab/enrich`。
- 建组时支持直接从已持久化的词条创建 `learning_groups / learning_group_words / review_states`，减少重复写库。
- `src/lib/officialLibrary.ts` 新增 `getOfficialBatchPlan()`，统一生成本批单词、组名和进度推进值。
- `src/components/library/OfficialLibraryPanel.tsx` 已切到新的批处理流程，文案也改成“准备好就直接开始”。

### 官方词库预加载脚本

- 已新增 [`scripts/preload-official-vocab.ts`](/Users/zhangjunqiu/Desktop/Lumina/scripts/preload-official-vocab.ts:1)。
- 已在 [`package.json`](/Users/zhangjunqiu/Desktop/Lumina/package.json:1) 增加 `npm run seed:official-vocab`。
- 该脚本会批量扫描 `IELTS_WORDS_FLAT`，跳过已完整存在的词条，仅对缺失词做 enrich 并回写 `vocabulary_items / vocabulary_senses / confused_words`。

### 生产部署与自动发布

- 前端已部署到 Cloudflare Pages：`https://lumina-1oi.pages.dev`
- 后端统一部署到 Supabase Edge Functions：`https://zhjdsvcgccdvtnicyasi.supabase.co/functions/v1/api`
- GitHub 自动发布已打通：
  - `CI` workflow 负责类型检查、规则测试、session 测试、word batch 测试和生产构建验证
  - `Deploy Pages` workflow 负责将 `main` 的前端构建结果发布到现有 Pages 项目
  - Supabase Edge Function `api` 保留 `/api/*` 路由兼容层
  - GitHub Actions 通过后可触发 Supabase Function 部署 workflow
- 已确认：
  - `Deploy Pages` 成功
  - Supabase Edge Function `api` 部署成功后，`GET /api/health` 返回 `{ "status": "ok" }`

---

## 1. 当前项目状态

项目已经从“前端原型 + 局部 mock 数据”推进到“前后端协同的状态驱动复习系统 v1”。

当前主线已经具备以下能力：

- Landing Page 作为公共入口
- `/auth` 真实登录入口
- `/app/*` 登录后产品区
- 自定义导入单词
- Gemini enrich 单词信息
- 保存到 Supabase
- Google OAuth 主入口 + 邮箱密码备用入口
- 左下角设置按钮弹出账户菜单并支持退出账户
- 3 轮学习流程：`round1 -> round2 -> round3 -> article`
- 日常复习流程：`/app/home -> /app/session -> /app/review-results -> /app/home`
- Round2 / Review 的即时写库
- 基于长期状态的复习调度
- 单词详情页查看当前记忆状态
- 复习结束页查看升级 / 降级 / 毕业结果
- 服务端 Bearer Token 校验
- 用户级数据隔离与 RLS 收口

---

## 2. 已完成的核心改造

### 2.1 Review 领域规则已迁移到服务端

已将复习状态判定从前端逻辑迁移到 Express 服务端统一处理，避免前端和数据库规则漂移。

已实现状态：

- `new`
- `fuzzy`
- `slow_recall`
- `stable_recall`
- `mastered`

固定阈值：

- `elapsed_ms <= 6000` 视为快回忆
- `elapsed_ms > 6000` 视为慢回忆

核心原则：

- `Round2` 是首次长期判定入口
- `Review` 是日常升降级入口
- `Round1` 和 `Round3` 不写长期状态
- `mastered` 词直接毕业，不再进入 daily due queue

### 2.2 Round2 / Review 即时写库

当前实现为每个单词提交一次就立即写库，而不是整轮结束后统一提交。

写库内容包括：

- `review_states` 快照更新
- `review_events` 历史事件写入

这意味着：

- 中途退出 session，已做过的词不会丢失
- 再次进入复习时，只会拉取当前仍然 due 的词

### 2.3 Due Queue 改为真实数据驱动

首页开始复习时不再使用 mock 词表，而是调用服务端接口获取真实到期队列。

队列筛选规则：

- `memory_state != mastered`
- `next_review_at <= now`

排序规则：

- `next_review_at ASC`
- 同到期时间下按 `fuzzy -> slow_recall -> stable_recall`
- 再按 `last_assessed_at ASC`

### 2.4 首页统计已接真实数据

首页统计已改为真实查询：

- `todayReviewCount`：真实 due queue 数量
- `todayNewGroups`：今日新建学习组数量
- `streak`：按历史学习日期连续计算
- `totalLearned`：`mastered` 状态词数

### 2.5 词库详情页和复习结果页已完成

已新增真实词库页，支持查看单词详情抽屉。

详情里可见：

- 当前 `memoryState`
- `nextReviewAt`
- 最近一次结果 `lastResult`
- 例句
- 易混词说明
- memory tip

复习结束后新增结果页，可查看：

- 每个词的状态变化
- 升级数量
- 降级数量
- 毕业数量

### 2.6 登录 / 注册页面视觉壳层已完成

这一块已经不再是“产品内部的 auth 视图”，而是完整入口层的一部分。

当前入口结构已经改成：

- `Landing Page -> /auth -> /app/*`
- 未登录访问 `/app/*` 会跳回 `/auth?next=...`
- 已登录访问 `/auth` 会自动回到 `/app/home` 或 `next`
- 侧边栏只存在于产品区，不再承担登录入口职责

当前 auth 入口已经具备：

- Google OAuth 主按钮
- 邮箱密码登录
- 邮箱密码注册
- 登录后自动跳转到目标产品页面
- 退出账户后返回 `/`

视觉方向也已跟主产品统一，而不是独立模板：

- 玻璃拟态卡片布局
- 柔和蓝绿渐变光斑
- 大圆角玻璃面板
- 高字重标题
- 宽松留白
- 中文主导、经验判断式的入口文案

### 2.7 设置按钮与退出闭环已完成

左下角 `Settings` 现在不再是空图标。

当前行为：

- 点击后弹出账户菜单
- 展示当前账户头像 / 名称 / 邮箱
- 提供 `退出账户`
- 退出后清空前端学习态并返回 landing page

### 2.8 真实鉴权与用户归属已接入

这轮已经把“auth 壳层”推进成真实鉴权闭环。

已完成：

- 前端新增 `AuthProvider / useAuth`
- 使用 `supabase.auth.getSession()` 恢复 session
- 使用 `onAuthStateChange()` 维持登录状态
- Google OAuth 可作为主入口发起
- 邮箱密码登录 / 注册可作为备用入口使用

数据归属也已经开始按真实用户工作：

- `review` 服务端接口不再使用 `demo user`
- Bearer Token 会在 Express 服务端校验
- `review_states` / `review_events` 写入使用真实 `auth user id`
- 前端 review API 请求会自动带 `Authorization` header

---

## 3. 数据库层已完成的调整

### 3.1 `review_states` 已扩展

已加入字段：

- `memory_state`
- `last_result`
- `last_elapsed_ms`
- `last_assessed_at`
- `graduated_at`

并重新定义原字段语义：

- `review_count`：只统计日常 review 次数
- `lapse_count`：只在 review 错误时递增
- `last_reviewed_at`：只记录日常 review 时间

### 3.2 新增 `review_events`

新增完整事件表，用于记录每次判定历史。

当前已记录：

- 来源：`round2 | review`
- 是否正确
- 用时
- 前一状态
- 下一状态
- 下次复习时间

这张表后续可以直接用于：

- 阈值调优
- 用户记忆轨迹分析
- 复习系统回放

### 3.3 导入阶段初始化逻辑已更新

导入词表时现在只初始化：

- `memory_state = 'new'`
- `next_review_at = null`

不再默认写“明天复习”。

### 3.4 用户级 RLS 已开始收口

这轮已经把几个原本完全开放的业务表改为按用户隔离：

- `learning_groups`
- `learning_group_words`
- `review_states`
- `review_events`
- `generated_articles`

当前策略方向：

- `SELECT / INSERT / UPDATE / DELETE` 全部要求 `auth.uid()::text = user_id`
- `learning_group_words` 通过所属 `learning_groups` 反查用户归属

这意味着：

- 登录后不会再继续读取所有人的复习状态
- 词库和学习组也开始具备真实账户边界
- 但前提是 migration 需要真正跑到你的 Supabase 数据库里

---

## 4. 已新增/修改的重要文件

### 服务端

- `server/index.ts`
  - `review / enrich / article` 已要求 bearer token
  - `/api/review/attempt` 和 `/api/review/due` 已切真实用户

- `server/auth.ts`
  - 新增 Bearer Token 解析与 Supabase `getUser()` 校验

- `server/review-domain.ts`
  - 纯规则层
  - 包含状态机、时间阈值、下次复习时间计算、due queue 排序

- `server/review.ts`
  - 负责真实读写 Supabase
  - 负责状态快照更新与事件落库
  - 已从 `demo` 用户切到真实 `auth user id`

- `server/supabase.ts`
  - 新增 service-role client
  - 使用 `SUPABASE_SERVICE_ROLE_KEY`

### 前端

- `src/RootApp.tsx`
  - 新增全局路由层
  - 入口拆成 `/`、`/auth`、`/app/*`
  - 包含 public / protected route 逻辑

- `src/contexts/AuthContext.tsx`
  - 新增 auth context
  - 负责 session 恢复、登录、注册、Google OAuth、退出

- `src/App.tsx`
  - 已改成产品区 `/app/*` 壳层
  - review 启动逻辑切到真实 due queue
  - Round2 / Review 接入即时写库
  - session / review-results 改为真实路由页面
  - 登出时清理 app 级状态

- `src/components/landing/LandingView.tsx`
  - 新增 landing page
  - 负责入口层产品预览与 CTA

- `src/components/auth/AuthView.tsx`
  - 改为真实 auth 入口页
  - Google 为主入口
  - 邮箱密码为备用方式

- `src/components/layout/Sidebar.tsx`
  - 删除 `Auth` 导航入口
  - `Settings` 改成账户弹层 + 退出账户

- `src/lib/reviewApi.ts`
  - review 请求自动带 token

- `src/lib/api.ts`
  - 新增通用带 token 的 API 请求封装

- `src/components/import/ImportView.tsx`
  - 导入后初始化 review state 为 `new`
  - 返回真实数据库词 ID
  - `learning_groups` / `review_states` 写入真实 user id

- `src/components/library/LibraryView.tsx`
  - 改为从 `review_states` 侧发起查询
  - 避免登录后仍读取所有词表数据

- `src/components/review/ReviewResultsView.tsx`
  - 已调整为中文主导结果文案

- `src/types.ts`
  - 新增 `MemoryState`、`ReviewTransition`、`ReviewWord`
  - 旧 `ViewState` 现在已不再承担全局入口职责

- `src/main.tsx`
  - 已挂载 `BrowserRouter + AuthProvider`

### 数据库与脚本

- `supabase/schema.sql`
  - 已补充用户级 RLS 策略

- `supabase/migrations/20260415000000_review_system_v1.sql`
  - Review System v1 增量迁移

- `supabase/migrations/20260415010000_auth_routing_rls.sql`
  - 新增 auth / routing / RLS 收口迁移

- `scripts/test-review-rules.ts`
  - 纯规则测试脚本

---

## 5. 当前已实现的业务规则

### Round2 首次判定

- 错误：`new -> fuzzy`
- 正确但慢：`new -> slow_recall`
- 正确且快：`new -> stable_recall`
- 如果某词已经不是 `new`，再次 Round2 不会重复升级

### Review 升降级

- 错误：降到 `fuzzy`
- 正确但慢：落到 `slow_recall`
- 正确且快：
  - `fuzzy -> slow_recall`
  - `slow_recall -> stable_recall`
  - `stable_recall -> mastered`

### 间隔规则

- `fuzzy`：1 天后复习
- `slow_recall`：3 天后复习
- `stable_recall`：7 天后复习
- `mastered`：不再进入日常复习

---

## 6. 已完成的验证

当前已经通过以下验证：

```bash
npm run lint
npm run build
npm run test:review
npm run test:session
npm run test:word-batch
```

验证结果：

- TypeScript 静态检查通过
- Vite 生产构建通过
- 纯规则测试通过
- Learning session 检查通过
- Word batch 校验通过

当前仍有一个非阻塞警告：

- 主 bundle 约 `635 kB`
- 后续可以做 code-splitting / manualChunks 优化

---

## 7. 当前已知边界

以下内容目前已知，但还没有继续往下推进：

- Google OAuth 还需要你在 Supabase 控制台里配置 provider 和 redirect URL
- 新的 RLS migration 需要真正执行到数据库，否则前端直连查询仍不会按用户隔离
- `review` / `auth` / `landing` 的真实线上联调还需要结合你本地 Supabase 环境继续走一遍
- 文章生成链路已经可用，但文章质量和目标词覆盖率还可以继续优化
- `enrich / article` 这类服务端接口现在要求 token，旧脚本如果不带 token 会直接 401
- `Profile` 页仍是轻量账户卡片，不是正式账户中心
- 构建体积偏大，尚未做拆包

---

## 8. 建议的下一步

如果继续沿这个方向做，推荐顺序是：

1. 在 Supabase 控制台完成 Google OAuth 和 redirect URL 配置
2. 跑一遍真实登录联调，验证 `/ -> /auth -> /app/* -> logout -> /`
3. 执行新的 RLS migration，确认 `library / import / review` 已按用户隔离
4. 修复旧联调脚本，让它显式支持 access token
5. 再回到 `Round2` 的状态解释层和可视化设计
6. 最后再考虑 v2：毕业抽查、动态阈值、个体化间隔

---

## 9. 一句话总结

当前项目已经不再是单纯的单词学习 UI，而是一个具备“真实入口层、真实鉴权、用户级数据边界、状态判定、即时落库、真实调度、结果可追踪”的单词复习系统 v1。
