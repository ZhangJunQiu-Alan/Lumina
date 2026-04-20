# AI 学习记录 — Lumina

> 每次开发会话结束后更新此文件。
> 开始新工作前必须先读取此文件。

---

## 技术栈

| 层级 | 技术 | 版本 | 状态 |
|---|---|---|---|
| 前端 | React | 19 | ✅ |
| 语言 | TypeScript | ~5.8 | ✅ |
| 构建工具 | Vite | ^6.2 | ✅ |
| 样式 | TailwindCSS | ^4.1（Vite 插件，非 PostCSS） | ✅ |
| 动画 | motion/react | ^12 | ✅ |
| 图标 | lucide-react | ^0.546 | ✅ |
| AI | @google/genai | ^1.29（Gemini 2.0 Flash） | ✅ 仅服务端 |
| 后端 | Express | ^4.21（端口 4000） | ✅ |
| 数据库/存储 | Supabase JS | ^2 | ✅ |
| 数据库客户端（脚本） | pg | ^8 | ✅ 仅脚本 |

### 开发命令
```bash
npm run dev      # Vite 前端 :3000
npm run server   # Express 后端 :4000 (tsx --env-file=.env server/index.ts)
npm run test:review  # 纯复习域规则检查
```
两个进程必须同时运行。Vite 会将 `/api/*` 代理到 `http://localhost:4000`。

---

## 环境变量（.env）

```
VITE_SUPABASE_URL=              # 前端使用 (src/lib/supabase.ts)
VITE_SUPABASE_PUBLISHABLE_KEY=  # 前端使用
SUPABASE_SERVICE_ROLE_KEY=      # 服务端 review 路由使用 (server/supabase.ts)
SUPABASE_DB_PASSWORD=           # 脚本使用 (scripts/run-migration.mjs)
GEMINI_API_KEY=                 # 仅服务端 (server/gemini.ts)，不能放入 Vite define
```

**关键**：`GEMINI_API_KEY` 不能放进 `vite.config.ts` 的 `define` 块，否则会被打包进前端。

---

## CSS 设计系统

### 工具类（在 `src/index.css` 的 `@layer utilities` 中定义）
- `.glass` — 磨砂玻璃卡片：`rgba(255,255,255,0.7)` + `backdrop-filter: blur(30px)` + 白色边框
- `.glass-dark` — 深色遮罩变体
- `.jelly-shadow` — `box-shadow: 0 20px 60px rgba(0,0,0,0.08)`

### 颜色令牌（作为 Tailwind 类使用：`text-apple-blue`、`bg-apple-red/10` 等）
```
apple-blue:   #007AFF
apple-gray:   #F5F5F7  (也用作输入框背景 bg-apple-gray)
apple-red:    #FF3B30
apple-orange: #FF9500
apple-green:  #34C759
apple-indigo: #5856D6
apple-teal:   #30B0C7
text-primary:    #1D1D1F
text-secondary:  #86868B
```

### 圆角令牌
- `rounded-apple` → 24px
- `rounded-apple-lg` → 32px

### 背景
`body` 使用微妙的径向渐变：左上角蓝色，右下角靛色，底色 `#F5F5F7`。

---

## 组件规范

### 动画模式
- **页面进入**：`initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}`
- **卡片错位**：`transition={{ delay: 0.1 + index * 0.07, duration: 0.4 }}`
- **侧边栏挂载**：`initial={{ x: -100, opacity: 0 }} animate={{ x: 0, opacity: 1 }}`
- App.tsx 的视图切换使用 `AnimatePresence mode="wait"`

### Props 规范
- 视图通过显式 props 接收数据，不使用 context（保持组件可移植性）
- 图标 props 使用 `lucide-react` 的 `LucideIcon` 类型

---

## 项目结构

```
lumina-ielts/
  server/
    index.ts          ← Express 入口（端口 4000），CORS 通配符（仅开发环境）
    gemini.ts         ← enrichWords()——Gemini 2.0 Flash 词汇增强
    tts.ts            ← generateWordAudio()——Gemini 2.5 Flash TTS 音频生成
    audio.ts          ← getOrCreateAudio() / batchGenerateAudio()——音频缓存层
    review-domain.ts  ← 纯状态转换 + 调度规则
    review.ts         ← 复习状态机 + due queue 注水
    supabase.ts       ← 服务端 service-role Supabase 客户端
  src/
    components/
      layout/
        Sidebar.tsx           ← 导航侧边栏（固定，左侧）
      home/
        HomeView.tsx          ← 首页（统计、今日计划、CTA）
        StatCard.tsx          ← 可复用统计卡片
      import/
        ImportView.tsx        ← 4 阶段导入流程（输入→加载→预览→保存）
      library/
        LibraryView.tsx       ← 词库详情抽屉 + 记忆状态可视化
      review/
        ReviewResultsView.tsx ← 复习后升降级汇总
    lib/
      supabase.ts     ← createClient()（使用 VITE_ 环境变量）
      reviewApi.ts    ← fetchDueReviewWords() + submitReviewAttempt()
    App.tsx           ← 路由壳层 + LearningEngine + article/review 编排
    types.ts          ← 共享域类型 + toWord()
    mockData.ts       ← 仅遗留演示数据
    index.css         ← TailwindCSS v4 + 设计令牌
  supabase/
    schema.sql        ← 8 张表的 schema（在 Supabase Dashboard SQL 编辑器中执行）
  scripts/
    run-migration.mjs    ← 基于 pg 的 schema 执行器（需要直连数据库）
    test-full-flow.mjs   ← 端到端测试：增强→保存→评估→验证
    test-review-rules.ts ← 纯规则检查：复习转换 + 队列排序
    ai-learnings.md      ← 本文件
```

---

## 视图（ViewState）
- `home` → HomeView
- `library` → LibraryView（真实词库 + 详情抽屉）
- `import` → ImportView（完整实现）
- `profile` → 占位符（用户卡片）
- `learning` → LearningEngine 或 ArticleView（取决于 `round` 状态）
- `reviewResults` → ReviewResultsView

---

## 数据结构（types.ts）

```ts
// 学习引擎使用
Word {
  id, word, phonetic, pos_tags[], ner_entities[],
  chinese_definition, example_sentences[], confusing_pair?
}

// Gemini 返回 / Supabase 存储
WordSense {
  pos, meaning_zh, example_sentence, example_translation_zh
}

EnrichedWord {
  id?, word, ipa_uk, ipa_us, primary_meaning_zh,
  ner_label, senses: WordSense[], confused_word,
  confused_diff_zh, memory_tip
}

// toWord(e: EnrichedWord): Word — 转换为学习引擎格式

UserStats {
  todayReviewCount, todayNewGroups, streak, totalLearned
}

MemoryState {
  'new' | 'fuzzy' | 'slow_recall' | 'stable_recall' | 'mastered'
}

ReviewTransition {
  from, to, source, result, graduated, nextReviewAt
}

ReviewWord extends Word {
  memoryState, nextReviewAt, lastResult
}
```

---

## 数据库 Schema（Supabase — 8 张表）

**部署方式**：将 `supabase/schema.sql` 粘贴到 Supabase Dashboard → SQL 编辑器 → 执行。
直连 pg 在没有 IPv6 的机器上会失败（Supabase 只有 AAAA 记录）。

| 表名 | 关键字段 | 备注 |
|---|---|---|
| vocabulary_items | id, word (UNIQUE), ipa_uk, ipa_us, primary_meaning_zh, ner_label, memory_tip, audio_uk_url, audio_us_url, source_type | 核心词汇数据 |
| vocabulary_senses | id, vocabulary_item_id, pos, meaning_zh, example_sentence, example_translation_zh | 每词 1~N 条 |
| confused_words | id, vocabulary_item_id, confused_word, difference_note_zh | 每词 0~1 条 |
| learning_groups | id, group_name, source_type, created_at | 30 词一组 |
| learning_group_words | learning_group_id, vocabulary_item_id, sequence_no | 关联表 |
| review_states | user_id, vocabulary_item_id, memory_state, next_review_at, last_result, last_elapsed_ms | 复习快照 / due 调度 |
| review_events | vocabulary_item_id, learning_group_id, source, was_correct, elapsed_ms, previous_state, next_state | 完整复习历史 |
| generated_articles | id, learning_group_id, content, created_at | Round3 后阅读文章 |

所有表已启用 RLS，开发阶段使用开放的 `public_all` 策略（上线前需收紧）。

---

## API 端点

### `POST /api/vocab/enrich`
- **请求体**：`{ words: string[] }`（最多 30 个）
- **响应**：`{ data: EnrichedWord[] }`
- 调用 Gemini 2.0 Flash，使用 `responseMimeType: 'application/json'` 强制结构化输出
- 避免了 Markdown 代码围栏和无效 JSON 转义序列问题

### `POST /api/vocab/article`
- **请求体**：`{ words: string[] }`
- **响应**：`{ data: string }`
- 生成 Round3 阅读文章

### `POST /api/review/attempt`
- **请求体**：`{ vocabularyItemId, learningGroupId?, source, wasCorrect, elapsedMs }`
- **响应**：`{ data: { memoryState, nextReviewAt, graduated, transition } }`
- 服务端计算状态转换，同时写入 `review_states` 和 `review_events`

### `GET /api/review/due`
- **响应**：`{ data: ReviewWord[] }`
- 返回已注水为前端 `Word` 格式的到期复习词，按紧急程度排序

### `GET /api/audio/:word?locale=uk|us`
- **响应**：`{ data: string }`（公开音频 URL）
- 优先返回缓存 URL；缓存不存在时调用 Gemini TTS 生成并上传到 Supabase Storage

### `POST /api/audio/batch`
- **请求体**：`{ words: string[] }`
- **响应**：`{ data: { [word]: { uk_url, us_url } } }`
- 并行生成所有词的 UK + US 音频（使用 `Promise.allSettled`，错误按词静默跳过）

### `GET /api/health`
- 返回 `{ ok: true }`

---

## 音频系统

### 架构
双层保障：
1. **Gemini TTS（主）**：`gemini-2.5-flash-preview-tts` 生成高质量音频，缓存到 Supabase Storage `word-audio` 桶
2. **Web Speech API（备用）**：Gemini TTS 失败时自动降级到浏览器原生 TTS

### 存储路径
`word-audio/{locale}/{word}.wav`（如 `uk/allocate.wav`）

### 速率限制
- 免费层：10 RPM（导入多词时极易触发 429）
- 付费层：1000+ RPM，可安全使用并行 `Promise.allSettled`

### 前端降级逻辑（App.tsx）
```tsx
const playAudio = useCallback(async (word: Word, locale: 'uk' | 'us') => {
  const url = locale === 'uk' ? word.audio_uk_url : word.audio_us_url;
  const resolvedUrl = url ?? await fetch(`/api/audio/${encodeURIComponent(word.word)}?locale=${locale}`)
    .then(r => r.ok ? r.json().then(d => d.data) : null).catch(() => null);
  if (!resolvedUrl) { speakViaBrowser(word.word, locale); return; }
  const audio = new Audio(resolvedUrl);
  audio.onerror = () => speakViaBrowser(word.word, locale);
  audio.play().catch(() => speakViaBrowser(word.word, locale));
}, [...]);
```

---

## 轮次行为规则

```
首页 → 复习（如有到期词）→ 复习结果 → 首页
首页/导入 → Round1 → Round2 → Round3 → 文章 → 首页
```

若 `todayReviewCount > 0`：CTA 从 `GET /api/review/due` 加载真实到期队列。

| 轮次 | 输入方式 | 推进方式 | 答错处理 |
|---|---|---|---|
| Round1 | 输入框可见，单词/音标/词性/含义/例句/易混词均以明文显示 | 回车或点击"下一词"验证；正确则推进 | 留在当前词，输入框变红 |
| Round2 | 看中文 → 输入英文 | 回车或点击"下一词"验证；正确则在 `/api/review/attempt` 成功后推进 | 立即显示答案并清空输入，1500ms 后调用 `nextWord()` |
| review | 同 Round2 | 回车验证 | 同 Round2 |
| Round3 | 翻转卡（音标 → 显示含义/例句） | 主按钮为"显示含义"/"下一词"；回车触发当前主操作 | 不适用 |

**Round1/Round2 验证规则**：回车键与"下一词"按钮走同一条验证路径。

**Round2/Review 持久化规则**：每个词提交后立即通过服务端写库，UI 再推进。

**Round2 答错 UX 细节**：`setInputValue('')` 和 `setIsWrong(false)` 与 `setShowAnswer(true)` 同时触发——输入框立即清空，不等待 1500ms 延迟。

### 过时闭包修复（App.tsx 中的 nextWord）
`nextWord` 在 `setTimeout` 内调用时必须使用 ref 避免过时闭包：
```tsx
const queueRef = useRef<Word[]>([]);
const currentIndexRef = useRef(0);
useEffect(() => { queueRef.current = queue; }, [queue]);
useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
const nextWord = useCallback(() => {
  if (currentIndexRef.current < queueRef.current.length - 1) {
    setCurrentIndex(prev => prev + 1);
    setInputValue(''); setIsWrong(false); setShowAnswer(false);
  } else { onComplete(); }
}, [onComplete]);
```

### ProgressBar 不能是 React 组件
`renderProgressBar(currentIndex, queueLength)` 必须是 `LearningEngine` 外部的普通函数。
若在组件体内定义为 `const ProgressBar = () => ...`，React 每次渲染都会卸载/重挂载（破坏动画）。

---

## ImportView 流程

4 个阶段：`input` → `loading` → `preview` → `saving`

1. 用户粘贴词汇（逗号/换行分隔，最多 30 个）
2. `POST /api/vocab/enrich` → Gemini 增强
3. 预览展示：单词 + 音标 + 词性 + 中文含义
4. "开始学习" → `saveToSupabase()` → `onStartLearning(words, groupId)`

### saveToSupabase 写入顺序
1. Upsert `vocabulary_items`（冲突键：word）
2. 每词 `Promise.all`：删除+插入 `vocabulary_senses`，删除+插入 `confused_words`
3. 插入 `learning_groups`
4. 插入 `learning_group_words`
5. Upsert `review_states`，初始化 `memory_state = 'new'`、`next_review_at = null`

使用 `Promise.all`（非串行循环）——30 词 × 4 次 DB 操作，否则需要 120 次串行往返。
每次插入都检查 `error`，非空则抛出异常。

---

## 复习状态机

### Round2 首次判定
- 答错：`new → fuzzy`
- 答对但慢（>6000ms）：`new → slow_recall`
- 答对且快（≤6000ms）：`new → stable_recall`
- 若该词已不是 `new`，再次 Round2 不会重复升级

### Review 升降级
- 答错：降到 `fuzzy`
- 答对但慢：落到 `slow_recall`
- 答对且快：
  - `fuzzy → slow_recall`
  - `slow_recall → stable_recall`
  - `stable_recall → mastered`

### 间隔规则
- `fuzzy`：1 天后复习
- `slow_recall`：3 天后复习
- `stable_recall`：7 天后复习
- `mastered`：不再进入日常复习队列

---

## 剩余技术债

| # | 问题 | 文件 | 优先级 |
|---|---|---|---|
| 5 | 无全局状态管理——从 App.tsx 逐层传 props | App.tsx | 中 |
| 6 | 前端仍直接向 Supabase 写导入数据；仅复习规则完全由服务端管理 | ImportView.tsx | 中 |
| 7 | 尚无自动化测试覆盖 `/api/review/attempt` 状态转换矩阵 | server/review.ts | 高 |
| 8 | `profile` 视图仍显示占位掌握度/准确率卡片 | App.tsx | 低 |
| 10 | Express 使用 CORS 通配符（`*`） | server/index.ts | 中（上线前） |
| 11 | `SUPABASE_DB_PASSWORD` 直接用于本地迁移脚本 | scripts/ | 低（仅开发脚本） |

---

## 会话记录

### 第 1 次会话（2026-04-14）
- 从单体 App.tsx 中拆分出 `Sidebar`、`HomeView`、`StatCard`
- 为 HomeView 新增"今日计划"板块，展示复习 → 新词流程的锁定/解锁状态
- 去除基于时间的问候语；页头改为展示应用名称 + 用户名
- 建立文件夹结构和本知识库

### 第 2 次会话（2026-04-14）
- 通过审计识别 11 项技术债
- 修复 Bug #1–3（nextWord 过时闭包、Round2 UX、ProgressBar 重挂载）
- 接入 Supabase：新增 `src/lib/supabase.ts`、`supabase/schema.sql`（7 张表），通过 Dashboard SQL 编辑器部署（直连 pg 因 IPv6 失败）
- 接入 Gemini：`server/gemini.ts` + `server/index.ts` Express 后端，实现 `/api/vocab/enrich`
- 实现完整 `ImportView`（4 阶段流程）

### 第 3 次会话（2026-04-14）
- 修复 TS 错误：Fragment 上的 `key` prop，`ImportMeta.env`（tsconfig types 加入 `vite/client`）
- 修复 Round1 答案标牌始终显示的 Bug（`type === 'round1'` 条件永远为真）
- 修复 Round3 显示输入框而非翻转卡 UX
- 从 `vite.config.ts` `define` 中移除 `GEMINI_API_KEY`（否则会泄露到前端包）
- 修复批量替换后遗留的 ProgressBar 引用
- 新增 `scripts/test-full-flow.mjs` 用于端到端 Supabase 验证

### 第 4 次会话（2026-04-14）
- 修复 Bug #4：`saveToSupabase` 串行循环 → `Promise.all` + 错误检查
- Round1 推进方式改变：定时器（500ms setTimeout）→ 显式"下一词"按钮 + 回车键
- 同步知识库（本文件）和 README

### 第 5 次会话（2026-04-15）
- 更新 Round1 UI：保留输入框，同时以明文展示当前词的所有信息，引导拼写
- 统一 Round1/Round2"下一词"按钮与回车键的验证路径
- Round3 新增回车键处理，触发当前主操作（"显示含义"/"下一词"）

### 第 6 次会话（2026-04-15）
- 实现状态驱动复习系统 v1
- 新增 `memory_state`、复习元数据字段和 `review_events`
- 新增服务端复习路由：`POST /api/review/attempt` 和 `GET /api/review/due`
- Round2/review 答题改为即时服务端持久化，基于用时分类
- 首页复习入口改为加载真实到期队列（替代本地 mock 词切片）
- 新增词库详情抽屉和复习后状态转换汇总页

### 第 7 次会话（2026-04-15）
- 修复导入时"Gemini returned invalid JSON"：在 `enrichWords` 中加入 `responseMimeType: 'application/json'`，强制结构化输出，彻底解决 IPA 反斜杠转义问题
- 新增音频系统：`server/tts.ts`（Gemini TTS）+ `server/audio.ts`（缓存层）+ `server/index.ts` 音频路由
- 前端新增 Web Speech API 降级逻辑，Gemini TTS 不可用时自动使用浏览器原生 TTS
- 确认使用付费 Gemini API Key；`batchGenerateAudio` 恢复并行 `Promise.allSettled`
