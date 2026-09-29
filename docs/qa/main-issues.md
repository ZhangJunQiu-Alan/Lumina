# Lumina QA Bug Notes

> 用途：给后续 LLM 快速了解历史 bug、复测状态和关键证据。
> 环境：本地前端 `http://127.0.0.1:3000`，本地后端 `http://127.0.0.1:4000`，Supabase 项目数据。
> 最近复测：2026-06-08，Codex 浏览器手动流程，测试账号 `codexissues68041658@example.com`。
> 标记规则：标题加 `~~删除线~~` 表示该 issue 已复测通过或不再复现。

## 当前状态

- 仍打开：问题 3（已通过高低价值词分流优化预加载，待持续观测）。
- 已复测通过并彻底根治：问题 1、2、4、5、6、7、8、9、10、11。
- 关键重构成果（阶段一已全量上线）：
  - **问题 9（70 词混淆与脏数据）**：已于 2026-09 任务 1.3 根治（废除 Append 机制，确立 30 词不可变学习组，执行迁移脚本清洗历史脏数据）。
  - **问题 10（Round 2 首屏分母闪烁 70）**：已于 2026-09 任务 1.3 根治（在 `LearningEngine.tsx` 中分母绑定会话队列唯一词数）。
  - **问题 11（学习统计口径不一致）**：已于 2026-09 任务 1.1 与 1.4 根治（落地 `daily_user_statistics` 聚合表与 PostgreSQL 强 ACID 存储过程 `record_review_attempt_atomic` / `complete_learning_group_atomic`）。

## 最新复测摘要：问题 6 / 7 / 8

- 账号：`codexissues68041658@example.com`
- 截图目录：`artifacts/lumina-issues-6-8-retest-20260608/`
- 数据文件：
  - `artifacts/lumina-issues-6-8-retest-20260608/word-data.json`
  - `artifacts/lumina-issues-6-8-retest-20260608/after-round1-db.json`
  - `artifacts/lumina-issues-6-8-retest-20260608/after-round2-db.json`
  - `artifacts/lumina-issues-6-8-retest-20260608/after-round3-stuck-db.json`
- 结果：
  - 问题 6：通过。加入 `雅思词汇真经` 后首页 CTA 是 `开始学习`，没有 `先选择学习词库`。
  - 问题 7：通过。Round 1 确认 30 个；Round 2 完成 30 个；Round 3 队列 30 个；`quartz` 在队列第 30 个且已完成 Round 2。
  - 问题 8：后续复测通过。Round 3 正确输入后可自动提交，不依赖 Enter；错误输入不会自动提交。

## ~~问题 1：首页学习状态缓存旧，学完回首页像没保存~~

状态：已复测通过。

原始症状：
- 新账号加入 `雅思词汇真经`，Round 1 正确输入 `atmosphere`、`hydrosphere` 后回首页。
- 首页仍显示空状态，没有 `继续学习`，也没有已选官方词库。
- DB 和 `/api/home/overview` 已有正确 active session，但当前会话首页吃到了旧缓存。

关键旧证据：
- `artifacts/lumina-main-issues-20260608/05-round1-after-two-words.png`
- `artifacts/lumina-main-issues-20260608/06-home-stale-after-learning.png`
- `artifacts/lumina-main-issues-20260608/07-start-routes-to-empty-library.png`

复测证据：
- `artifacts/lumina-retest-20260608/07-home-after-two-words.png`
- `artifacts/lumina-retest-20260608/08-continue-from-refreshed-home.png`

代码线索：
- `src/App.tsx` 的首页 `fetchStats({ preferCache: true })` 和 `homeOverviewCache` 曾导致当前会话显示旧 overview。
- 复测时同一登录会话回首页已正确显示 `继续学习`，点击可回第三张卡。

## ~~问题 2：`/auth?mode=register` 首屏显示登录表单~~

状态：已复测通过。

原始症状：
- URL 是 `/auth?mode=register`，tab 显示注册，但表单内容是登录。
- 需要先点登录再点注册，注册表单才出现。

关键证据：
- `artifacts/lumina-retest-20260608/01-register-route.png`

代码线索：
- `src/components/auth/AuthView.tsx` 初始 mode 曾先默认 `login`，再由 effect 同步 query。
- 复测时首屏已直接显示注册字段和创建账号按钮。

## 问题 3：Round 1 打开首卡仍触发过多 lookup/audio 请求

状态：仍打开。

当前结论：
- 自动化检查已减少低价值 token。
- 但真实浏览器打开 Round 1 第一张卡后，后端仍看到约 15 次 `/api/vocab/lookup` 和 6 次 `/api/audio/...`。

关键证据：
- `artifacts/lumina-issues-3-5-retest-20260608/05-round1-first-card.png`

代码线索：
- `src/lib/round1Preload.ts`
- `src/lib/round1ClickableWords.ts`
- `src/lib/clickableTextTokenizer.ts`

待确认：
- 是否应彻底取消 Round 1 对 clickable words 的自动 lookup/audio 预加载，只保留当前主词和必要例句音频。

## ~~问题 4：Round 1 已确认词只写 session，不写逐词进度表~~

状态：已复测通过。

原始症状：
- Round 1 页面已推进，`learning_groups.session_round1_confirmed_word_ids` 有数据。
- `learning_group_words.round1_confirmed_at` 仍为空，导致逐词进度和 session 快照不一致。

复测证据：
- `artifacts/lumina-issues-3-5-retest-20260608/06-after-two-round1-words.png`
- `artifacts/lumina-issues-3-5-retest-20260608/db-after-two-words.json`

复测结论：
- 新账号完成 `atmosphere`、`hydrosphere` 后，逐词表同步写入两个 `round1_confirmed_at`。

## ~~问题 5：新用户无词库时首页 CTA 文案误导~~

状态：已复测通过。

原始症状：
- 新用户无词库时 CTA 写 `开始学习`，点击后进入空词库页。

复测证据：
- `artifacts/lumina-issues-3-5-retest-20260608/02-empty-home-after-register.png`
- `artifacts/lumina-issues-3-5-retest-20260608/03-no-library-cta-official-library.png`

复测结论：
- 空首页 CTA 已显示 `先选择学习词库`。
- 点击后进入官方词库 tab，不再进入空的个人词库页。

## ~~问题 6：已选 `雅思词汇真经` 后首页 CTA 仍写 `先选择学习词库`~~

状态：已复测通过。

原始症状：
- 从官方词库点击 `开始记忆` 回首页。
- 页面显示已选 `雅思词汇真经`，但底部主按钮仍写 `先选择学习词库`。
- 旧截图：
  - `artifacts/lumina-full-round-20260608/04-home-after-select-ielts.png`
  - `artifacts/lumina-full-round-20260608/05-home-after-refresh-selected.png`

最新复测：
- 加入 `雅思词汇真经` 后 URL：`/app/home?officialLibraryId=ielts-vocab`
- 首页显示已选 `雅思词汇真经`
- CTA 显示 `开始学习`
- 页面没有 `先选择学习词库`

最新证据：
- `artifacts/lumina-issues-6-8-retest-20260608/03-home-after-add-ielts.png`

代码线索：
- `src/components/home/HomeView.tsx` 已在 selected official library 场景下将 CTA 改为 `开始学习`。

## ~~问题 7：Round 1 完成 30 个后，Round 2 / Round 3 只剩 29 个，漏 `quartz`~~

状态：已复测通过。

原始症状：
- Round 1 显示完成 `30 / 30`。
- 进入 Round 3 后显示 `1 / 29`。
- DB 对比发现 `quartz` 在 Round 1 确认过，但没有进入 Round 2 / Round 3。

旧证据：
- `artifacts/lumina-full-round-20260608/10-after-round1-continued.png`
- `artifacts/lumina-full-round-20260608/12-round3-start.png`
- `artifacts/lumina-full-round-20260608/final-db-state.json`

最新复测：
- Round 1 手动提交前 30 个词，最后一个是 `quartz`。
- `after-round1-db.json`：
  - `session_round = round2`
  - `session_queue_word_ids.length = 30`
  - `session_round1_confirmed_word_ids.length = 30`
  - `learning_group_words.round1_confirmed_at = 30`
  - 队列最后三个：`mineral`、`marble`、`quartz`
- Round 2 手动选择 30 个。
- `after-round2-db.json`：
  - `session_round = round3`
  - `session_queue_word_ids.length = 30`
  - `learning_group_words.round2_completed_at = 30`
  - Round 2 完成最后三个：`mineral`、`marble`、`quartz`
- Round 3 首屏显示 `这一轮进度 1 / 30`。

最新证据：
- `artifacts/lumina-issues-6-8-retest-20260608/05-after-round1.png`
- `artifacts/lumina-issues-6-8-retest-20260608/06-after-round2-round3-start.png`
- `artifacts/lumina-issues-6-8-retest-20260608/after-round1-db.json`
- `artifacts/lumina-issues-6-8-retest-20260608/after-round2-db.json`

观察：
- Round 2 刚进入时曾短暂出现 `第 1 / 70 个词`，第一题继续后恢复为 `第 2 / 30 个词`；DB 队列始终是 30。暂不作为独立 issue，除非可稳定复现。

## ~~问题 8：Round 3 正确输入后不进入下一题~~

状态：已复测通过。

当前症状：
- Round 3 第一题 `atmosphere`。
- 输入正确答案并按 Enter 后，例句空格补全为 `atmosphere`。
- 页面仍停在 `这一轮进度 1 / 30`。
- 隐藏输入框值仍是 `atmosphere`。
- 右侧下一张按钮仍禁用。
- DB 未写入 Round 3 完成。

最新复测方式：
- 先用填充值加 Enter：仍停住。
- 再清空后逐键输入 `atmosphere` 并 Enter：仍停住。
- 等待 7 秒：仍停住。

最新证据：
- `artifacts/lumina-issues-6-8-retest-20260608/07-round3-after-atmosphere.png`
- `artifacts/lumina-issues-6-8-retest-20260608/08-round3-after-real-key-atmosphere.png`
- `artifacts/lumina-issues-6-8-retest-20260608/after-round3-stuck-db.json`

最新 DB 状态：
- `session_round = round3`
- `session_current_index = 0`
- `session_queue_word_ids.length = 30`
- `session_round1_confirmed_word_ids.length = 30`
- `learning_group_words.round3_completed_at = 0`
- 第一词 `atmosphere` 的 `round3_completed_at = null`

当前代码线索：
- `src/components/learning/LearningEngine.tsx:1661` `handleInput` 会更新 `inputValue`，但自动提交条件是 `type !== 'round1'` 时直接 return；Round 3 输入正确不会自动调用 `validateCurrentInput`。
- `src/components/learning/LearningEngine.tsx:1700` `handleSubmit` 在 `isRecallRound` 时调用 `handleRound3PrimaryAction()`，不是 `validateCurrentInput()`。
- `src/components/learning/LearningEngine.tsx:1380` `handleRound3PrimaryAction()` 只做两件事：第一次把 `showAnswer` 设为 true，第二次 `nextWord()`；它不校验输入、不持久化 Round 3 正确事件。
- `src/components/learning/LearningEngine.tsx:1528-1564` 的 dictation 正确输入推进逻辑仍在 `validateCurrentInput` 里，但当前 Round 3 表单路径没有进入它。

修复目标：
- Round 3 输入正确答案时必须调用 `validateCurrentInput(nextValue/inputValue)` 或等效逻辑。
- 正确输入后必须写入 Round 3 attempt / `round3_completed_at`，并自动进入下一词，或显示可点击的 `继续下一个词`。
- 加测试覆盖：Round 3 cloze 输入 `atmosphere` 后，`session_current_index` 从 0 前进，DB 有 Round 3 正确记录。

最新复测：
- 目录：`artifacts/lumina-round3-autosubmit-20260608/`
- 错误输入 `quarts`，不按 Enter：页面不前进，DB 不写 `round3_completed_at`。
- 正确输入 `quartz`，不按 Enter：页面自动提交并完成学习组。
- DB：`round3Rows = 30`，`learnedRows = 30`，`quartz.round3_completed_at` 和 `learned_at` 均写入。
- 再学习第二组时，Round 3 从 `granite` 到 `steeper` 也能全程自动提交。

## ~~问题 9：学习组名/队列是 40 或 30，但 learning_group_words 变成 70 行~~

状态：已复测通过并彻底根治（阶段一 任务 1.3，Commit: `7daafba`）。

根因分析：
- 历史上官方词库在 Round 1 剩余词数 ≤ 15 时，曾通过 `OFFICIAL_APPEND_PRELOAD_REMAINING_THRESHOLD` 自动向当前学习组的 `learning_group_words` 异步追加 30 词，导致单个学习组行数从 40 膨胀到 70；
- 追加逻辑生成的脏数据在进入 `review_states` 时产生了未真正学习的孤儿记录，造成词库总数虚高。

解决方案与落地：
1. **彻底下线 Append 逻辑**：在 `officialLibraryStart.ts` 与 `officialLibrary.ts` 中废除所有追加缓存与后台预分配逻辑，确立不可变批次（严格固定 30 词或末尾余量，`OFFICIAL_BATCH_SIZE = 30`）；
2. **落地数据清洗脚本**：创建并执行迁移脚本 `20260923030000_cleanup_70_word_groups_and_orphans.sql`，精准清除序列号 ≥ 30 的未学冗余词条，级联清理孤儿 `review_states`，将所有系统学习组的真实行数精确校准为实际词数；
3. **自动化测试守卫**：在 `scripts/test-official-library.ts` 中增加不可变批次大小与契约断言。

## ~~问题 10：Round 2 刚进入时显示 第 1 / 70 个词，但真实 session 队列只有 30~~

状态：已复测通过并彻底根治（阶段一 任务 1.3，Commit: `7daafba`）。

根因分析：
- `LearningEngine.tsx` 在计算进度的分母 `initialUniqueCount` 时，旧逻辑直接读取了 `words.length`。当学习组因历史问题含有 70 词时，Round 2 初始渲染读取到 70；在首题作答后，内部 `activeWords` 才被会话状态切片为 30，从而造成页面首屏显示 `第 1 / 70 个词` 的闪烁。

解决方案与落地：
- 在 `LearningEngine.tsx` 中将 `initialUniqueCount` 重构为响应式通过 `useMemo` 计算有效题库队列（`initialEngineState.queue`）中的唯一单词数；
- 当由 Round 1 推进至 Round 2 时，队列严格按照水合状态的 `session_queue_word_ids`（30 词）加载，首屏分母在数学上恒定为 30，彻底杜绝闪烁。

## ~~问题 11：学习统计口径不一致，新学习、已掌握/已完成、Round2 正确率容易混淆~~

状态：已复测通过并彻底根治（阶段一 任务 1.1 与 任务 1.4，Commit: `ae1c549`, `f3d4fba`）。

根因分析：
- 早期各视图的统计口径不一致：首页、词库详情、设置页各自通过前端全表拉取循环回放计算统计，缺乏权威全局数据源；
- 复习状态写入与日度打卡步骤分多次独立 HTTP 请求发起，弱网下极易发生数据撕裂。

解决方案与落地：
1. **建立权威日度聚合表（`daily_user_statistics`）**：以日度聚合表作为打卡状态、新学词数（`learned_word_count`）、复习词数（`review_word_count`）、答题数与正确数的唯一权威事实来源，首页概览查询复杂度由 O(N) 降至 O(1)；
2. **全流程 PostgreSQL 强 ACID 事务原子化**：
   - 落地 `record_review_attempt_atomic` 存储过程：复习状态快照变更、历史审计日志插入与日度统计累加同生共死；
   - 落地 `complete_learning_group_atomic` 存储过程：学习组全流程结业、生词本自动移除、打卡进度更新与新学词数累加全部收拢为单一事务原子提交；
3. **词库完成度统一**：官方词库进度与卡片已完成计数严格基于该词库专属已学词（`learned_at IS NOT NULL`）与掌握词计算，消除跨词库共享词造成的概念混淆。

## 证据索引

- `artifacts/lumina-main-issues-20260608/`：第一轮主流程原始截图。
- `artifacts/lumina-retest-20260608/`：问题 1 / 2 复测截图。
- `artifacts/lumina-issues-3-5-retest-20260608/`：问题 3 / 4 / 5 复测截图和 DB 文件。
- `artifacts/lumina-full-round-20260608/`：旧问题 6 / 7 / 8 原始完整路径截图和 DB 文件。
- `artifacts/lumina-issues-6-8-retest-20260608/`：最新问题 6 / 7 / 8 手动复测截图和 DB 文件。
- `artifacts/lumina-round3-autosubmit-20260608/`：Round 3 自动提交专项复测。
- `artifacts/lumina-learning-stats-round-20260608/`：第二组完整学习和统计口径复测。
