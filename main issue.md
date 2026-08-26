# Lumina QA Bug Notes

> 用途：给后续 LLM 快速了解历史 bug、复测状态和关键证据。
> 环境：本地前端 `http://127.0.0.1:3000`，本地后端 `http://127.0.0.1:4000`，Supabase 项目数据。
> 最近复测：2026-06-08，Codex 浏览器手动流程，测试账号 `codexissues68041658@example.com`。
> 标记规则：标题加 `~~删除线~~` 表示该 issue 已复测通过或不再复现。

## 当前状态

- 仍打开：问题 3、问题 9、问题 10、问题 11。
- 已复测通过：问题 1、2、4、5、6、7、8。
- 当前最需要确认：学习统计口径。两组各完成 30 个词后，首页 `新学习单词数 = 60`，但首页/官方库 `已掌握/已完成 = 45`，同时每个学习组的 `learning_group_words` 变成 70 行。

## 最新复测摘要：问题 6 / 7 / 8

- 账号：`codexissues68041658@example.com`
- 截图目录：`qa-artifacts/lumina-issues-6-8-retest-20260608/`
- 数据文件：
  - `qa-artifacts/lumina-issues-6-8-retest-20260608/word-data.json`
  - `qa-artifacts/lumina-issues-6-8-retest-20260608/after-round1-db.json`
  - `qa-artifacts/lumina-issues-6-8-retest-20260608/after-round2-db.json`
  - `qa-artifacts/lumina-issues-6-8-retest-20260608/after-round3-stuck-db.json`
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
- `qa-artifacts/lumina-main-issues-20260608/05-round1-after-two-words.png`
- `qa-artifacts/lumina-main-issues-20260608/06-home-stale-after-learning.png`
- `qa-artifacts/lumina-main-issues-20260608/07-start-routes-to-empty-library.png`

复测证据：
- `qa-artifacts/lumina-retest-20260608/07-home-after-two-words.png`
- `qa-artifacts/lumina-retest-20260608/08-continue-from-refreshed-home.png`

代码线索：
- `src/App.tsx` 的首页 `fetchStats({ preferCache: true })` 和 `homeOverviewCache` 曾导致当前会话显示旧 overview。
- 复测时同一登录会话回首页已正确显示 `继续学习`，点击可回第三张卡。

## ~~问题 2：`/auth?mode=register` 首屏显示登录表单~~

状态：已复测通过。

原始症状：
- URL 是 `/auth?mode=register`，tab 显示注册，但表单内容是登录。
- 需要先点登录再点注册，注册表单才出现。

关键证据：
- `qa-artifacts/lumina-retest-20260608/01-register-route.png`

代码线索：
- `src/components/auth/AuthView.tsx` 初始 mode 曾先默认 `login`，再由 effect 同步 query。
- 复测时首屏已直接显示注册字段和创建账号按钮。

## 问题 3：Round 1 打开首卡仍触发过多 lookup/audio 请求

状态：仍打开。

当前结论：
- 自动化检查已减少低价值 token。
- 但真实浏览器打开 Round 1 第一张卡后，后端仍看到约 15 次 `/api/vocab/lookup` 和 6 次 `/api/audio/...`。

关键证据：
- `qa-artifacts/lumina-issues-3-5-retest-20260608/05-round1-first-card.png`

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
- `qa-artifacts/lumina-issues-3-5-retest-20260608/06-after-two-round1-words.png`
- `qa-artifacts/lumina-issues-3-5-retest-20260608/db-after-two-words.json`

复测结论：
- 新账号完成 `atmosphere`、`hydrosphere` 后，逐词表同步写入两个 `round1_confirmed_at`。

## ~~问题 5：新用户无词库时首页 CTA 文案误导~~

状态：已复测通过。

原始症状：
- 新用户无词库时 CTA 写 `开始学习`，点击后进入空词库页。

复测证据：
- `qa-artifacts/lumina-issues-3-5-retest-20260608/02-empty-home-after-register.png`
- `qa-artifacts/lumina-issues-3-5-retest-20260608/03-no-library-cta-official-library.png`

复测结论：
- 空首页 CTA 已显示 `先选择学习词库`。
- 点击后进入官方词库 tab，不再进入空的个人词库页。

## ~~问题 6：已选 `雅思词汇真经` 后首页 CTA 仍写 `先选择学习词库`~~

状态：已复测通过。

原始症状：
- 从官方词库点击 `开始记忆` 回首页。
- 页面显示已选 `雅思词汇真经`，但底部主按钮仍写 `先选择学习词库`。
- 旧截图：
  - `qa-artifacts/lumina-full-round-20260608/04-home-after-select-ielts.png`
  - `qa-artifacts/lumina-full-round-20260608/05-home-after-refresh-selected.png`

最新复测：
- 加入 `雅思词汇真经` 后 URL：`/app/home?officialLibraryId=ielts-vocab`
- 首页显示已选 `雅思词汇真经`
- CTA 显示 `开始学习`
- 页面没有 `先选择学习词库`

最新证据：
- `qa-artifacts/lumina-issues-6-8-retest-20260608/03-home-after-add-ielts.png`

代码线索：
- `src/components/home/HomeView.tsx` 已在 selected official library 场景下将 CTA 改为 `开始学习`。

## ~~问题 7：Round 1 完成 30 个后，Round 2 / Round 3 只剩 29 个，漏 `quartz`~~

状态：已复测通过。

原始症状：
- Round 1 显示完成 `30 / 30`。
- 进入 Round 3 后显示 `1 / 29`。
- DB 对比发现 `quartz` 在 Round 1 确认过，但没有进入 Round 2 / Round 3。

旧证据：
- `qa-artifacts/lumina-full-round-20260608/10-after-round1-continued.png`
- `qa-artifacts/lumina-full-round-20260608/12-round3-start.png`
- `qa-artifacts/lumina-full-round-20260608/final-db-state.json`

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
- `qa-artifacts/lumina-issues-6-8-retest-20260608/05-after-round1.png`
- `qa-artifacts/lumina-issues-6-8-retest-20260608/06-after-round2-round3-start.png`
- `qa-artifacts/lumina-issues-6-8-retest-20260608/after-round1-db.json`
- `qa-artifacts/lumina-issues-6-8-retest-20260608/after-round2-db.json`

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
- `qa-artifacts/lumina-issues-6-8-retest-20260608/07-round3-after-atmosphere.png`
- `qa-artifacts/lumina-issues-6-8-retest-20260608/08-round3-after-real-key-atmosphere.png`
- `qa-artifacts/lumina-issues-6-8-retest-20260608/after-round3-stuck-db.json`

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
- 目录：`qa-artifacts/lumina-round3-autosubmit-20260608/`
- 错误输入 `quarts`，不按 Enter：页面不前进，DB 不写 `round3_completed_at`。
- 正确输入 `quartz`，不按 Enter：页面自动提交并完成学习组。
- DB：`round3Rows = 30`，`learnedRows = 30`，`quartz.round3_completed_at` 和 `learned_at` 均写入。
- 再学习第二组时，Round 3 从 `granite` 到 `steeper` 也能全程自动提交。

## 问题 9：学习组名/队列是 40 或 30，但 `learning_group_words` 变成 70 行

状态：仍打开。

最新复测：
- 账号：`codexissues68041658@example.com`
- 目录：`qa-artifacts/lumina-learning-stats-round-20260608/`
- 第 1 组：`雅思词汇真经 · 0001-0040`
  - `status = completed`
  - `learning_group_words.count = 70`
  - `round1 = 30`
  - `round2 = 30`
  - `round3 = 30`
  - `learned = 30`
- 第 2 组：`雅思词汇真经 · 顺序 · 第2组 · 40词`
  - 启动时 active group 显示第 2 组 40 词。
  - Round1 完成后 DB 里 `learning_group_words.count = 70`
  - `session_queue_word_ids.length = 30`
  - `session_round1_confirmed_word_ids.length = 30`
  - 完成后仍是 `learning_group_words.count = 70`，但 `learned = 30`
- 两组后 `review_states.total = 140`，但实际学完词数是 `learned = 60`。

证据：
- `qa-artifacts/lumina-learning-stats-round-20260608/baseline-db.json`
- `qa-artifacts/lumina-learning-stats-round-20260608/after-continue-db.json`
- `qa-artifacts/lumina-learning-stats-round-20260608/after-round1-db.json`
- `qa-artifacts/lumina-learning-stats-round-20260608/final-db.json`

风险：
- 首页、官方词库完成度、review state 总数可能混入预创建/未学词。
- 如果后续统计用 `learning_group_words.count` 或 `review_states.total`，会高估学习范围。

## 问题 10：Round 2 刚进入时显示 `第 1 / 70 个词`，但真实 session 队列只有 30

状态：仍打开。

复现：
- 完成 Round1 30 个词后进入 Round2。
- 页面第一张 Round2 卡显示 `第 1 / 70 个词`。
- 点击第一题继续后，页面恢复为 `第 2 / 30 个词`。

DB 对照：
- `session_queue_word_ids.length = 30`
- `session_round1_confirmed_word_ids.length = 30`
- `learning_group_words.count = 70`

证据：
- `qa-artifacts/lumina-learning-stats-round-20260608/03-after-round1.png`
- `qa-artifacts/lumina-learning-stats-round-20260608/04-after-first-round2.png`
- `qa-artifacts/lumina-learning-stats-round-20260608/after-round1-db.json`

推测：
- Round2 首屏进度可能临时用了 `words.length`，而不是当前 session queue 长度。
- 这个现象已经在两次完整路径里出现，不再视为偶发。

## 问题 11：学习统计口径不一致，`新学习`、`已掌握/已完成`、Round2 正确率容易混淆

状态：仍打开，需要产品口径确认。

最新复测结果：
- 两组各完成 30 个 Round3 后，首页显示：
  - `新学习单词数 = 60`
  - `已掌握单词数 = 45`
- 官方词库页显示：
  - `雅思词汇真经 45 / 3631 词`
  - 其他官方库也显示若干已完成词数。
- DB：
  - 第二组 `learned = 30`
  - 第二组 `review_events = round2:wrong 6, round2:correct 24, round3:correct 30`
  - 第二组 `learning_group_words.round2_completed_at = 30`
  - `review_states.counts = stable_recall 45, new 80, fuzzy 7, slow_recall 8`

证据：
- `qa-artifacts/lumina-learning-stats-round-20260608/07-after-steeper-submit.png`
- `qa-artifacts/lumina-learning-stats-round-20260608/08-library-after-completion.png`
- `qa-artifacts/lumina-learning-stats-round-20260608/09-home-after-refresh.png`
- `qa-artifacts/lumina-learning-stats-round-20260608/final-db.json`

需要确认的口径：
- 首页 `已掌握单词数` 是否应该等于 `stable_recall`，还是等于已完成学习的 `learned_at`。
- 官方词库卡片的 `已完成` 是否应该显示 `stable_recall`，还是显示该词库内已学完/已完成 Round3 的词。
- Round2 里答错后，`round2_completed_at` 仍写入是否符合语义；如果它表示“已尝试”没问题，但名称和统计使用时容易被误解为“答对完成”。
- 官方库之间共享词导致其他库出现完成数是否是预期；如果是预期，UI 需要避免让用户误以为自己学习过多个词库。

## 证据索引

- `qa-artifacts/lumina-main-issues-20260608/`：第一轮主流程原始截图。
- `qa-artifacts/lumina-retest-20260608/`：问题 1 / 2 复测截图。
- `qa-artifacts/lumina-issues-3-5-retest-20260608/`：问题 3 / 4 / 5 复测截图和 DB 文件。
- `qa-artifacts/lumina-full-round-20260608/`：旧问题 6 / 7 / 8 原始完整路径截图和 DB 文件。
- `qa-artifacts/lumina-issues-6-8-retest-20260608/`：最新问题 6 / 7 / 8 手动复测截图和 DB 文件。
- `qa-artifacts/lumina-round3-autosubmit-20260608/`：Round 3 自动提交专项复测。
- `qa-artifacts/lumina-learning-stats-round-20260608/`：第二组完整学习和统计口径复测。
