# Reading 单击查词浮窗 + Library 统一重构 — TODO

> 本文件是实施清单。每完成一个 Task,把对应 checkbox 改成 `[x]`。
> 完整设计文档见 `/Users/zhangjunqiu/.claude/plans/twinkly-dazzling-quiche.md`。

---

## IELTS Reading 真题训练接入

- [x] 新增 IELTS Academic Reading 独立数据模型和 RLS：book/test/passage/question group/question/attempt/response。
- [x] 新增本地 PDF 导入管线：`npm run import:ielts-reading -- --pdf ... --dry-run` 生成候选 JSON 和校对报告，`--apply` 通过硬校验后写入 Supabase。
- [x] 新增 `/app/ielts-reading` 前端入口：题库列表、60 分钟训练页、答题卡、提交评分、错题回看。
- [x] 复用现有阅读点击查词和加入个人词库能力。
- [x] 新增 IELTS 阅读评分 normalization 单元测试。
- [ ] 放入第一本 Cambridge IELTS A 类 PDF 后执行 dry-run，人工确认目录、文章标题、题号和答案。
- [ ] 校对通过后执行 `--apply` 写入目标 Supabase。

---

## Context

### 为什么做这件事

Lumina 当前的阅读环节(`ArticleView`)只能让用户看到 target 词的高亮,**点击任意词查询释义这个能力不存在**。用户希望在阅读 Gemini 生成的文章时,单击任意一个英文单词就能看到一个紧凑的浮窗,展示按词性分组的中文释义(参考形式:salt → n. 盐;v. 加盐于;adj. 咸的)。

同时,产品在词的来源上有两条割裂的路径:
- **Import 路径**: 用户导入词 → 直接创建 `learning_groups` + 立即可学
- **阅读路径(本次新增)**: 用户阅读时点击"加入词库" → 应该和 import 来的词进同一个池子

为统一两条路径汇入同一个"个人词库"概念,本次实现包含一个**架构重构**:把 import 流程从"导入即建 learning_group"改为"导入进入 user_saved_words 池,用户后续在词库里以 30 词为一组手动建 learning_group 开始学习"——和 official library 的体验对齐。

### 已确定的产品决策

| 决策点 | 选择 |
|---|---|
| 触发方式 | 单击实词;功能词不响应 |
| 词形还原 | 新增 `vocabulary_item_forms` 表,LLM 在 lite 阶段强制输出 forms 数组 |
| 未收录词 fallback | Gemini lite 生成(只 primary_meaning + senses 的 pos+meaning,无例句) |
| 加入词库 | 写入 `user_saved_words`,**不**进入 SRS |
| Full enrichment 时机 | 加入词库后异步 fire-and-forget,Supabase Realtime 通知前端 |
| 在库的词浮窗 | 显示 lite 版内容 + SRS 状态 badge,**红色"移除词库"按钮**(未进 SRS 时)|
| 已学过的词浮窗 | 同上,SRS badge 显示对应状态(new/fuzzy/slow_recall/stable_recall/mastered) |
| 浮窗交互 | 单浮窗;点 B 时 A 立刻关闭、B 显示 skeleton;A 的 LLM 响应仍写入 DB |
| 重复点击 | 点同一个词的不同位置 → 浮窗跳到当前位置;同一处 toggle 关闭 |
| 移动端 | 实词加 padding 扩大点击区 |
| 重构和浮窗 | 一起做,不分阶段 |
| 存量数据 | 写一次性迁移脚本: `learning_group_words` → `user_saved_words` |
| 词库到 SRS 入口 | 复用 official library 的"顺序 / 手动 30 词一组"模式 |
| `generated_articles` | 保留,仍绑 learning_group |

---

## 总体架构

### 数据库变更

```sql
-- 新增字段
ALTER TABLE vocabulary_items ADD COLUMN enrichment_level TEXT
  NOT NULL DEFAULT 'full' CHECK (enrichment_level IN ('lite', 'full'));

-- 新增表
CREATE TABLE vocabulary_item_forms (
  id UUID PRIMARY KEY,
  vocabulary_item_id UUID REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  form TEXT NOT NULL,
  UNIQUE(form)
);

CREATE TABLE user_saved_words (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  vocabulary_item_id UUID REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('import', 'reading_popup', 'manual', 'migration')),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, vocabulary_item_id)
);

-- Supabase Realtime 启用
ALTER PUBLICATION supabase_realtime ADD TABLE vocabulary_items;
```

### 文件改动总览

| 文件 | 改动性质 |
|---|---|
| `supabase/migrations/20260502000000_word_lookup_and_saved_words.sql` | **新增** |
| `scripts/migrate-learning-groups-to-saved-words.ts` | **新增** |
| `server/gemini.ts` | **扩展** `enrichWordLite()` + `enrichToFull()` |
| `server/index.ts` | **扩展** 加 4 个路由 |
| `server/library.ts` | **扩展** saved_words CRUD |
| `src/lib/stopWords.ts` | **新增** |
| `src/lib/wordLookup.ts` | **新增** |
| `src/components/shared/WordPopover.tsx` | **新增** |
| `src/components/shared/ClickableText.tsx` | **新增** |
| `src/components/learning/ArticleView.tsx` | **修改** 替换 `renderHighlightedSentence` |
| `src/components/import/ImportView.tsx` | **修改** 调用 `saveToUserSavedWords` |
| `src/lib/importFlow.ts` | **扩展** 新增 `saveToUserSavedWords()` |
| `src/components/library/LibraryView.tsx` | **修改** 新增"我的词库"区 |
| `src/components/library/SavedWordsPanel.tsx` | **新增** |
| `src/lib/libraryApi.ts` | **扩展** |
| `src/contexts/SavedWordsContext.tsx` | **新增** |
| `src/contexts/WordPopoverContext.tsx` | **新增** |

---

# Phase 0 — Schema 与迁移

## - [x] Task 0.1: 加 `enrichment_level` 字段到 `vocabulary_items`

**上下文:**
区分 vocabulary_item 是 lite(只有 primary_meaning + senses 的 pos+meaning_zh)还是 full(完整有 morphology / relations / confused_words / memory_tip)。
- 查询时:前端判断 `enrichment_level='lite'` 决定显示精简内容
- 加入词库时:server 检查这个字段,lite 才触发 full enrichment
- 批量补全时:`WHERE enrichment_level='lite'` 一句筛出

**默认值 `'full'`** —— 因为存量数据都是完整生成的,不能误标 lite。

**关联文件:**
- `supabase/migrations/20260502000000_word_lookup_and_saved_words.sql`(新增)

**验收:**
- migration 跑通
- `SELECT enrichment_level, COUNT(*) FROM vocabulary_items GROUP BY enrichment_level;` 返回 `full | <存量数>`
- CHECK 约束生效:插 `enrichment_level='partial'` 应失败

---

## - [x] Task 0.2: 新增 `vocabulary_item_forms` 表

**上下文:**
解决"用户点击 `decided` 但库里只有 `decide`"的问题。这个表是**全局共享**(所有用户共用),把变形映射到 vocabulary_items 的主词。

```sql
CREATE TABLE vocabulary_item_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_item_id UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  form TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(form)
);

CREATE INDEX vocabulary_item_forms_form_idx ON vocabulary_item_forms (form);

ALTER TABLE vocabulary_item_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all" ON vocabulary_item_forms FOR ALL USING (true) WITH CHECK (true);
```

**关键设计:**
- `UNIQUE(form)` —— 一个变形只指向一个原形(`bear` 这种歧义词稀有,接受 first-write-wins)
- 不存原形和变形相同的行(salt → salt 不写),前端 lookup 流程会先直接查 vocabulary_items.word

**关联文件:** `supabase/migrations/20260502000000_word_lookup_and_saved_words.sql`

**验收:**
- 表创建成功,索引存在
- 手工插入 `(decide_id, 'decided')` 后查询能命中

---

## - [x] Task 0.3: 新增 `user_saved_words` 表

**上下文:**
统一"个人词库"概念。Import 来的词、阅读浮窗加入的词都进这里。和 `learning_groups` 解耦。

```sql
CREATE TABLE user_saved_words (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  vocabulary_item_id UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('import', 'reading_popup', 'manual', 'migration')),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, vocabulary_item_id)
);

CREATE INDEX user_saved_words_user_idx ON user_saved_words (user_id, saved_at DESC);

ALTER TABLE user_saved_words ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_saved_words_owner_select" ON user_saved_words
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "user_saved_words_owner_insert" ON user_saved_words
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "user_saved_words_owner_update" ON user_saved_words
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "user_saved_words_owner_delete" ON user_saved_words
  FOR DELETE USING (auth.uid()::text = user_id);
```

**关联文件:** `supabase/migrations/20260502000000_word_lookup_and_saved_words.sql`

**验收:**
- 表 + 索引 + RLS 生效
- 重复插同一 (user_id, vocabulary_item_id) 报 UNIQUE 冲突

---

## - [x] Task 0.4: 启用 vocabulary_items 的 Realtime publication

**上下文:**
Full enrichment 在后台完成时,前端需要被通知刷新。Supabase Realtime 默认不为所有表开启 publication。

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE vocabulary_items;
```

**关联文件:** 同一个 migration 文件 `supabase/migrations/20260502000000_word_lookup_and_saved_words.sql`

**验收:**
- 在 Supabase dashboard → Database → Replication 确认 vocabulary_items 在 publication 中
- 前端订阅 `postgres_changes` event:UPDATE/INSERT 时能收到 payload

---

## - [x] Task 0.5: 一次性迁移脚本 `learning_group_words` → `user_saved_words`

**上下文:**
所有现有用户的 `learning_groups`(无论 source_type='custom' 还是 'system')里的词,都要镜像一份到 `user_saved_words`。用户改完后能在"我的词库"页面看到历史所有学过的词。

**关键约束:**
- 同一个 vocabulary_item 在多个 learning_group 中出现 → user_saved_words 只存一条(UNIQUE 兜底)
- 取**最早**的 learning_group.created_at 作为 saved_at
- source 标 `'migration'`,以便日后可识别历史数据
- 学习状态(memory_state, next_review_at)继续在 review_states 里,**不动**

**实现位置:** `scripts/migrate-learning-groups-to-saved-words.ts`(新增)

**模式参照:** `scripts/preload-official-vocab.ts`(批量 upsert + 重试)

**伪代码:**
```typescript
async function migrate() {
  // 1. SELECT lg.user_id, lgw.vocabulary_item_id, MIN(lg.created_at) AS saved_at
  //    FROM learning_group_words lgw JOIN learning_groups lg ON lgw.learning_group_id = lg.id
  //    GROUP BY lg.user_id, lgw.vocabulary_item_id
  // 2. 按用户分批,每批 500 行
  // 3. supabaseAdmin.from('user_saved_words').upsert(rows, {
  //      onConflict: 'user_id,vocabulary_item_id',
  //      ignoreDuplicates: true,
  //    })
  // 4. 报告插入数 + 跳过数(已存在)
}
```

**关联文件:**
- `scripts/migrate-learning-groups-to-saved-words.ts`(新增)
- `package.json`: 加 `"migrate:saved-words": "node --import tsx scripts/migrate-learning-groups-to-saved-words.ts"`

**验收:**
- 测试 Supabase 项目跑一遍,结果数等于 `SELECT COUNT(DISTINCT (lg.user_id, lgw.vocabulary_item_id)) FROM ...`
- 可重入:跑第二遍新增数为 0

---

# Phase 1 — 后端 API

## - [x] Task 1.1: `enrichWordLite()` + `POST /api/vocab/lite-enrich`

**上下文:**
单词级 fast-path,只生成最少必要字段。
- **输出**: `primary_meaning_zh` + `senses[]`(每条只有 `pos`、`meaning_zh`,**不**生成 example_sentence) + `forms[]`(常见变形)
- **温度**: 0.2(同现有 enrichWords)
- **maxOutputTokens**: 1024

**Prompt 草案(在 `server/gemini.ts` 新增 `LITE_ENRICH_PROMPT`):**

```
You are an English-Chinese vocabulary helper. For ONE English word, return concise structured data for Chinese learners.

Return ONLY a valid JSON object — no markdown fences, no extra text.

Schema:
{
  "word": "...",
  "primary_meaning_zh": "very short 1-line summary",
  "senses": [
    { "pos": "n" | "v" | "adj" | "adv" | "phr" | "...", "meaning_zh": "concise meaning, semicolon-separated if multiple" }
  ],
  "forms": ["common variations of this word, e.g. plural, past tense, gerund"]
}

Rules:
- senses: max 4, ordered by frequency.
- meaning_zh: under 30 Simplified Chinese characters.
- forms: include only forms that look DIFFERENT from the base word (don't include the word itself). Empty array if no variations.
- All Chinese must be Simplified.
```

**写库逻辑:**
1. UPSERT vocabulary_items (`enrichment_level='lite'`, `source_type='custom'`, `primary_meaning_zh=...`)
2. DELETE 然后 INSERT vocabulary_senses(只填 pos + meaning_zh)
3. INSERT vocabulary_item_forms(每个 form 一条,UNIQUE(form) ON CONFLICT DO NOTHING)
4. **如已存在 vocabulary_items**(无论 lite/full),返回现有数据,不重新调 LLM

**关联文件:**
- `server/gemini.ts`(扩展):`enrichWordLite(word: string): Promise<LiteEnrichResult>`
- `server/index.ts`(扩展):`POST /api/vocab/lite-enrich`

**重试 + 失败处理:** 复用 `enrichWordsResilient` 的 retry 模式,但单词级失败时不拆分批次。失败缓存 30 分钟在前端做(Task 2.3)。

**验收:**
- `curl -X POST localhost:3001/api/vocab/lite-enrich -d '{"word":"decide"}'` 返回结构化数据
- DB 中 `vocabulary_items.enrichment_level='lite'`、`vocabulary_senses` 有 2-4 行、`vocabulary_item_forms` 有 forms

---

## - [x] Task 1.2: `enrichToFull()` + `POST /api/vocab/full-enrich`(异步)

**上下文:**
用户在浮窗里点"加入词库"时,前端立即写入 user_saved_words(乐观更新),server 在后台 fire-and-forget 触发 full enrichment(如果当前是 lite)。

**关键决策:**
- **异步,立即返回 202**:用户即使关浮窗、翻页都没事
- **Supabase Realtime 通知**:full enrichment 完成后 UPDATE `vocabulary_items` 触发 realtime 事件
- **幂等**:重复触发不重复 enrich(检查 enrichment_level)

**实现:**
```typescript
// server/index.ts
app.post('/api/vocab/full-enrich', requireAuth, async (req, res) => {
  const { word } = req.body;
  // 1. 验证: vocabulary_items 存在且 enrichment_level='lite'
  // 2. 立刻 res.status(202).json({ queued: true })
  // 3. fire-and-forget: void enrichToFull(word).catch(logger.error)
});

// server/gemini.ts
async function enrichToFull(word: string): Promise<void> {
  // 1. 复用 enrichWordsResilient([word]) 拿完整 GeminiWordResult
  // 2. UPDATE vocabulary_items SET enrichment_level='full', morphology_summary_zh=..., memory_tip=..., ipa_uk=..., ipa_us=...
  // 3. 补 vocabulary_senses 的 example_sentence + example_translation_zh(按 pos 匹配)
  // 4. INSERT vocabulary_morphology_parts / vocabulary_relations / confused_words(先 DELETE 旧数据)
  // 5. UPDATE 自动触发 Supabase Realtime
}
```

**关联文件:**
- `server/gemini.ts`(扩展):`enrichToFull(word: string)`
- `server/index.ts`(扩展):路由

**验收:**
- 调用立即收到 202
- 几秒后 DB 中 `vocabulary_items.enrichment_level='full'`,所有相关表写入
- 前端订阅到 update 事件(在 Task 2.3 完成后才能验证)

---

## - [x] Task 1.3: `POST /api/vocab/lookup` —— 浮窗的统一入口

**上下文:**
浮窗点击词时,前端调一个 endpoint。后端按以下顺序查找:
1. `vocabulary_items.word = $word`(精确)
2. `vocabulary_item_forms.form = $word` → 拿到 vocabulary_item_id → 查 vocabulary_items
3. 都没有 → 调 `enrichWordLite($word)` 创建并返回

返回值统一:
```typescript
{
  vocabulary_item: { id, word, primary_meaning_zh, enrichment_level, ... },
  senses: [{ pos, meaning_zh }],
  in_user_library: boolean,
  srs_state: 'new' | 'fuzzy' | 'slow_recall' | 'stable_recall' | 'mastered' | null
}
```

**为什么不让前端各自查多张表:**
- 前端需要的是"给我这个词的所有展示数据",而不是 DB 细节
- 后端可以一次性 join,减少往返
- 后端集中处理 lite enrich fallback 逻辑

**关联文件:**
- `server/index.ts`(扩展):`POST /api/vocab/lookup` 路由

**验收:**
- 已存在的 full 词:返回完整数据 + `in_user_library` 正确
- 已存在的 lite 词:返回 lite 数据
- 变形词(`decided`):返回 `decide` 的数据
- 全新词:触发 lite enrich,1-3s 后返回新数据
- LLM 失败:返回 503

---

## - [x] Task 1.4: `POST /api/library/saved-words` & `DELETE /api/library/saved-words/:vocabularyItemId`

**上下文:**
浮窗的"加入词库"和"移除词库"按钮调用。POST 写入 user_saved_words 同时 fire-and-forget 触发 full enrichment(如果 lite)。

**实现位置:** `server/library.ts`(扩展)+ `server/index.ts`(注册路由)

```typescript
// server/library.ts
export async function saveWordToLibrary(userId: string, vocabularyItemId: string, source: 'reading_popup' | 'manual') {
  // 1. INSERT user_saved_words ON CONFLICT DO NOTHING
  // 2. SELECT vocabulary_items.enrichment_level WHERE id=$vocabularyItemId
  // 3. if 'lite': void enrichToFull(word)
  // 4. return { saved: true }
}

export async function removeWordFromLibrary(userId: string, vocabularyItemId: string) {
  // DELETE FROM user_saved_words WHERE user_id=$userId AND vocabulary_item_id=$vocabularyItemId
}
```

**关联文件:**
- `server/library.ts`
- `server/index.ts`

**验收:**
- POST 后 DB 有 user_saved_words 行
- 如果词是 lite,触发 full enrichment(几秒后变 full)
- DELETE 后 DB 行被删
- RLS 验证:user A 不能删 user B 的行

---

# Phase 2 — 前端基础设施

## - [x] Task 2.1: 客户端停用词表 `src/lib/stopWords.ts`

**上下文:**
功能词不触发浮窗,也不打 LLM。表只放"翻译完全没价值"的词。

**清单(初版,均小写):**
- 冠词: a, an, the
- 介词(单独): of, to, in, on, at, with, for, by, as, from
- 连词: and, but, or, so, if, that, than, then, when, while, because
- 代词: i, you, he, she, it, we, they, me, him, her, us, them, this, that, these, those, my, your, his, its, our, their
- be 动词: is, are, was, were, am, be, been, being
- 通用辅助词: do, does, did, have, has, had, will, would, can, could, should, may, might, must, shall

**注意:** 情态动词(would/could/should/might 等)和复杂介词(through、between、despite 等)**不放**,它们有学习价值,留给 LLM 处理。

**实现:**
```typescript
// src/lib/stopWords.ts
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the',
  // ... 全部小写
]);

export function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word.toLowerCase());
}
```

**关联文件:** `src/lib/stopWords.ts`(新增)

**验收:** `isStopWord('The') === true`,`isStopWord('decide') === false`

---

## - [x] Task 2.2: 单词渲染层 `<ClickableText>` 组件

**上下文:**
替换 `ArticleView.tsx:37-52` 当前的 `sentence.split(/(\s+)/).map(...)` 渲染逻辑。组件接收一段文本,输出**实词包 span,功能词不包 span**。

**为什么不用 caretRangeFromPoint:**
- 需要给实词加 padding(决策 4 — 移动端点击区扩大)
- 必须包 span 才能加 padding
- 但避免**所有词**都包 span(1000+ 节点);只给实词包

**核心逻辑:**
```typescript
type TokenKind = 'content' | 'stop' | 'whitespace' | 'punct' | 'cjk';

function tokenize(text: string): Array<{kind: TokenKind, text: string, normalized?: string}> {
  // 1. 用 /(\s+|[\p{P}]|[\p{Script=Han}])/u 分词
  // 2. 字母组成的 token,normalize(去标点、小写)
  // 3. CJK 字符独立 token,kind='cjk'
  // 4. stop words 用 isStopWord 判定
}

interface ClickableTextProps {
  text: string;
  targetWords?: Set<string>;  // 高亮特殊样式的词
  onWordClick: (word: string, anchor: HTMLElement) => void;
}

export function ClickableText({ text, targetWords, onWordClick }: ClickableTextProps) {
  return tokenize(text).map((token, i) => {
    if (token.kind === 'content') {
      const isTarget = targetWords?.has(token.normalized!);
      const baseClass = 'px-0.5 py-0.5 rounded cursor-pointer transition-colors';
      const targetClass = 'bg-apple-blue/10 text-apple-blue font-bold hover:bg-apple-blue/20';
      const normalClass = 'hover:bg-apple-blue/10';
      return (
        <span
          key={i}
          className={`${baseClass} ${isTarget ? targetClass : normalClass}`}
          onClick={(e) => onWordClick(token.normalized!, e.currentTarget)}
          data-clickable-word={token.normalized}
        >
          {token.text}
        </span>
      );
    }
    return token.text;  // 功能词、空格、标点、CJK 全部不包
  });
}
```

**关键样式:**
- `px-0.5 py-0.5`: 移动端点击区扩大
- `cursor-pointer`: 桌面端 affordance
- `hover:bg-apple-blue/10`: 悬停反馈
- 功能词没有这些样式 — 自然就是不可点击的视觉感

**target 词样式参考:** `ArticleView.tsx:46`(`bg-apple-blue/10 text-apple-blue font-bold ...`)

**关联文件:**
- `src/components/shared/ClickableText.tsx`(新增)
- `src/lib/stopWords.ts`(依赖 Task 2.1)

**验收:**
- 渲染 `"The salt is on the table."` → 实词 span 数 = 2(salt, table)
- 移动端 viewport 实测 tap 命中率改善
- CJK 字符不包 span

---

## - [x] Task 2.3: `lookupWord()` + 请求去重 + 失败缓存

**上下文:**
管理浮窗的查词流程。需要:
1. 同一个词同一时间只发一次请求(去重)
2. DB 命中(包括 lite)立即返回,不重新拉(SWR)
3. LLM 失败缓存 30 分钟
4. 配合 Realtime:订阅 vocabulary_items 的 update,full enrichment 完成时刷新内存缓存

**实现位置:** `src/lib/wordLookup.ts`(新增)

```typescript
interface CachedLookup {
  data: WordLookupResult | null;
  fetchedAt: number;
  failedUntil?: number;
}

const memoryCache = new Map<string, CachedLookup>();
const inflightRequests = new Map<string, Promise<WordLookupResult | null>>();
const FAILURE_CACHE_MS = 30 * 60 * 1000;

export async function lookupWord(word: string): Promise<WordLookupResult | null> {
  const key = word.toLowerCase();
  const cached = memoryCache.get(key);

  if (cached?.failedUntil && Date.now() < cached.failedUntil) return null;
  if (cached?.data) return cached.data;
  if (inflightRequests.has(key)) return inflightRequests.get(key)!;

  const promise = apiFetch('/api/vocab/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word }),
  })
    .then(res => res.json())
    .then(({ data }) => {
      memoryCache.set(key, { data, fetchedAt: Date.now() });
      return data;
    })
    .catch(err => {
      memoryCache.set(key, { data: null, fetchedAt: Date.now(), failedUntil: Date.now() + FAILURE_CACHE_MS });
      return null;
    })
    .finally(() => inflightRequests.delete(key));

  inflightRequests.set(key, promise);
  return promise;
}

export function invalidateWord(word: string) {
  memoryCache.delete(word.toLowerCase());
}
```

**Realtime 订阅:**
```typescript
// src/contexts/SavedWordsContext.tsx (新增)
useEffect(() => {
  const channel = supabase
    .channel('vocab-updates')
    .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'vocabulary_items' },
        (payload) => {
          invalidateWord(payload.new.word);
          // emit event 让浮窗刷新
        })
    .subscribe();
  return () => { channel.unsubscribe(); };
}, []);
```

**Hook 包装:**
```typescript
export function useWordLookup(word: string | null) {
  const [data, setData] = useState<WordLookupResult | null | undefined>(undefined);
  useEffect(() => {
    if (!word) return;
    setData(undefined);
    lookupWord(word).then(setData);
  }, [word]);
  return { data, loading: data === undefined };
}
```

**关联文件:**
- `src/lib/wordLookup.ts`(新增)
- `src/contexts/SavedWordsContext.tsx`(新增)
- `src/lib/api.ts`(参考 apiFetch 模式)

**验收:**
- 连续点同一词 5 次 → 网络面板只 1 次请求
- DB 命中的词 → 浮窗 < 100ms 显示
- 新词 → skeleton 1-3s 后变成内容
- 模拟 LLM 失败 → 30 分钟内不再发请求
- Realtime:DB 手动改 vocabulary_items 的 enrichment_level → 浮窗内容刷新

---

# Phase 3 — 浮窗集成

## - [x] Task 3.1: `<WordPopover>` 组件

**上下文:**
浮窗 UI 本身。从零写。

**外观:**
```
┌──────────────────────┐
│ decide  [SRS badge]  │  ← 词头 + 状态
├──────────────────────┤
│ 决定                 │  ← primary_meaning_zh(更大字号)
│                      │
│ v.  决定;选定        │  ← senses 行
│ n.  决定                │
├──────────────────────┤
│ [ + 加入词库 ]        │  ← 按钮(在库则变红色"移除词库")
└──────────────────────┘
```

**Props:**
```typescript
interface WordPopoverProps {
  word: string;
  anchor: HTMLElement;
  onClose: () => void;
}
```

**实现要点:**

**a) 定位算法**
- 默认锚下方;视口下边缘剩余 < popover.height → 翻到上方
- 视口右边缘剩余 < popover.width / 2 → 左对齐
- 视口左边缘剩余 < popover.width / 2 → 右对齐
- 滚动跟随 anchor.getBoundingClientRect()
- `position: fixed` + `top/left`

**b) SRS Badge**
```typescript
const SRS_BADGE_CONFIG: Record<string, { text: string; className: string }> = {
  'new': { text: '未学习', className: 'bg-sky-50 text-sky-700' },
  'fuzzy': { text: '模糊', className: 'bg-amber-50 text-amber-700' },
  'slow_recall': { text: '记忆中', className: 'bg-blue-50 text-blue-700' },
  'stable_recall': { text: '已记忆', className: 'bg-emerald-50 text-emerald-700' },
  'mastered': { text: '已掌握', className: 'bg-violet-50 text-violet-700' },
};
```

只在 `srs_state` 不为空时显示。**不显示倒计时。**

**c) 按钮区**

| 状态 | 按钮 |
|---|---|
| 不在库 | 蓝色"+ 加入词库" |
| 在库未进 SRS | 红色"从词库移除"(text-red-600 + hover bg-red-50) |
| 在库已进 SRS | 不显示按钮(只显示 SRS badge) |

**d) 单浮窗管理 + 关闭逻辑**
- 用 React Portal + 单例 ref
- 关闭路径:点外部 / ESC / 滚动超过阈值 / 点新词替换 / 点同一词同位置 toggle
- 点新词时 A 立即关闭,B 显示 skeleton(决策 7)
- "同一处同一个词" 判定:`anchor === currentAnchor`

**e) Skeleton 加载态**
`useWordLookup.loading === true` 时显示骨架(灰条)。

**关联文件:**
- `src/components/shared/WordPopover.tsx`(新增)
- `src/lib/wordLookup.ts`(已建)
- `src/contexts/SavedWordsContext.tsx`(已建)
- 用 `motion/react` 做出现/退出动画(参考 `ArticleView.tsx:93-99`)

**验收:**
- 桌面浏览器点词 → 浮窗在词附近显示
- 点屏幕右边的词 → 浮窗左对齐
- 点屏幕底部的词 → 浮窗显示在词上方
- 滚动 → 浮窗跟随
- ESC 关闭
- 点同词同位置 → toggle 关闭
- 加入词库 → 按钮变红色"移除"
- 移除 → 按钮变蓝色"加入"
- 浮窗动画顺滑

---

## - [x] Task 3.2: 集成到 `ArticleView.tsx`

**上下文:**
替换现有 `renderHighlightedSentence`(`ArticleView.tsx:37-52`),改用 `ClickableText` + 全局 `WordPopover`。

**改动后:**
```tsx
import { ClickableText } from '../shared/ClickableText';
import { useWordPopover } from '../../contexts/WordPopoverContext';

// 组件内
const { openPopover } = useWordPopover();

// JSX 里(line 91 附近)
<p>
  <ClickableText
    text={sentence.en}
    targetWords={targetWords}
    onWordClick={(word, anchor) => openPopover(word, anchor)}
  />
</p>
```

`WordPopoverContext` 提供 `openPopover` 单例方法,在 `App.tsx` 顶层 Provider 包裹。

**关联文件:**
- `src/components/learning/ArticleView.tsx`(改 37-52 + 91 附近)
- `src/contexts/WordPopoverContext.tsx`(新增,管理单例浮窗状态)
- `src/App.tsx`(顶层加 `<WordPopoverProvider>`)

**验收:**
- target 词依旧粗蓝色(不破坏现有视觉)
- 任意非停用词点击都弹浮窗
- target 词和非 target 词都可点
- 重复出现的同一词,点不同位置浮窗会跳转

---

# Phase 4 — 词库重构

## - [x] Task 4.1: 改造 `ImportView` 写入 `user_saved_words`

**上下文:**
现状:用户导入完点 "Start Learning" → 立即创建 learning_group + learning_group_words + review_states(`ImportView.tsx:214-251`)。

新流程:用户导入完点 "保存到词库" → 写入 user_saved_words(source='import')。**不再立即创建 learning_group,不再写 review_states。**

学习要等用户去 LibraryView 主动选 30 词建组(Task 4.3)。

**改动位置:** `src/components/import/ImportView.tsx:214-251`(`handleStartLearning`)

```typescript
async function handleSaveToLibrary() {
  // 1. persistEnrichedVocabularyEntries 不变(把词写 vocabulary_items / senses / morphology / relations / confused_words)
  // 2. 调新函数 saveToUserSavedWords(enriched, user.id, 'import')
  // 3. 跳转 /app/library 而不是 /app/session
}
```

**新增函数(在 `src/lib/importFlow.ts`):**
```typescript
export async function saveToUserSavedWords(
  entries: PersistedVocabularyEntry[],
  userId: string,
  source: 'import' | 'reading_popup' | 'manual',
): Promise<{ saved: number; skipped: number }> {
  const rows = entries.map(e => ({
    user_id: userId,
    vocabulary_item_id: e.id,
    source,
  }));
  const { data, error } = await supabase
    .from('user_saved_words')
    .upsert(rows, { onConflict: 'user_id,vocabulary_item_id', ignoreDuplicates: true })
    .select();
  // 返回新增数 + 已存在跳过数
}
```

**关联文件:**
- `src/lib/importFlow.ts`(扩展)
- `src/components/import/ImportView.tsx`(修改 214-251)

**关键:不要删 `createLearningGroupFromVocabularyEntries`** —— 它仍然被 official library 流程和 Task 4.3 的"建组"流程使用。

**验收:**
- import 30 词 → user_saved_words 增加 30 行,**learning_groups 表不增加行**
- 重复 import 同样的词 → upsert,行数不增加
- 词的完整内容(vocabulary_items / senses / morphology / relations) 还是被写入

---

## - [x] Task 4.2: LibraryView 加"我的词库"区

**上下文:**
LibraryView 现在主要展示 learning_groups(custom + 各 official library 的进度)。新增一个区块"我的词库"(读 user_saved_words),让用户看到所有收藏的词,并能从这里建学习组。

**布局参考:** 现有 LibraryView 已经有 OfficialLibraryPanel + 我的学习组 — 在它们之间或之上加"我的词库"section。

**展示内容:**
- 总词数 / 已学完词数 / 待学词数(后两者从 review_states 关联)
- 词列表(分页,可搜索):每个词展示 `word`、`primary_meaning_zh`、加入时间、SRS 状态 badge
- 每行支持删除按钮("从词库移除")
- 顶部有"开始学习一组"按钮 → 进入 Task 4.3 的选词流程

**数据查询:**
```typescript
// src/lib/libraryApi.ts(扩展)
export async function fetchSavedWords(userId: string): Promise<SavedWordEntry[]> {
  // SELECT user_saved_words 关联 vocabulary_items + LEFT JOIN review_states
  // 一次性拿到展示数据
}
```

**关联文件:**
- `src/components/library/LibraryView.tsx`(扩展)
- `src/lib/libraryApi.ts`(扩展)
- `src/components/library/SavedWordsPanel.tsx`(新增,独立组件,避免 LibraryView 进一步膨胀)

**验收:**
- 进入 LibraryView 看到 saved words 列表
- 删除一个词 → user_saved_words 行被删
- 数量统计正确

---

## - [x] Task 4.3: 从 saved words 建 learning_group(顺序 / 手动)

**上下文:**
点击"开始学习一组"按钮后的流程,完全对齐 official library 的 30 词 chunk 模式。

**两种模式:**
- **顺序模式**(默认):取 saved_at ASC 排序中 *尚未在任何 active learning_group 内* 的前 30 个
- **手动模式**:用户在词库列表里勾选 30 个词

**点击"建组并开始学习"后:**
1. 创建 learning_group(`source_type='custom'`,`group_name='我的词库 · 第 N 组 · 30 词'`)
2. 写 learning_group_words
3. 写 review_states(`memory_state='new'`)—— **这个时候才进 SRS!**
4. 创建 session(`session_round='round1'`)
5. 跳转 `/app/session`

**复用现有函数(无需重写):**
- `createLearningGroupFromVocabularyEntries`(`importFlow.ts:490-552`)
- `createInitialLearningSession`(`learningSession.ts:98-117`)

**新增的部分:**
- 词库 UI:多选模式(checkbox)和"取下一组 30 词"按钮
- 后端"哪些 saved words 还可用(没在 active group 里)"的查询

**关联文件:**
- `src/components/library/SavedWordsPanel.tsx`(扩展)
- `src/lib/libraryApi.ts`(扩展):`fetchAvailableSavedWords()`
- `src/lib/importFlow.ts`(已有 createLearningGroupFromVocabularyEntries,无需改)

**验收:**
- 顺序模式:点按钮,自动建组、跳转学习
- 手动模式:勾 30 个,点按钮,建组、跳转学习
- 同一个词不会同时在两个 active group 里
- 学习流程跑通(round1/2/3/article)

---

# Phase 5 — 收尾与验证

## - [x] Task 5.1: 移动端实测 + 调优

**目标:**
- iPhone Safari + Android Chrome 各测一次
- 关注:tap 命中率、浮窗位置、滚动跟随、按钮可点击区、Realtime 在 mobile 网络下的延迟

**验证记录(2026-05-02):**
- Playwright Chromium 模拟 desktop / iPhone / Android 三套 viewport 通过。
- 覆盖:点击命中、浮窗 viewport clamp、右侧贴边、底部翻转、ESC/外部点击/大滚动关闭、同 anchor toggle、不同 anchor 移动、加入/移除按钮。

---

## - [x] Task 5.2: LLM 调用监控

**上下文:**
新功能会带来 LLM 调用增量(每点击一个未收录词都是一次 lite enrich;每加入词库是一次 full enrich)。需要监控:
- 每天 lite/full enrichment 调用数
- 来源分布(reading_popup vs import)
- 失败率

**实现:**
- 在 `enrichWordLite` 和 `enrichToFull` 函数里 console.log + 用 `server/logger.ts` 结构化日志
- (可选)新增表 `gemini_call_log` 记录每次调用的 word/model/tokens/latency/success

**验证记录(2026-05-02):**
- 已改为 `logger.info/error('gemini_call', ...)` 结构化日志,不新增 DB 表。
- 日志字段包含: `enrichment_type`, `source`, `word_count`, `word`/`words_preview`, `model`, `success`, `duration_ms`, `retry_count`, `error_name`, `error_message`。
- 本地 smoke 命中当前 Gemini key 过期,已确认 lite/full 失败日志均输出 `gemini_call` 且包含 `source=reading_popup` / `source=manual_api`。

**关联文件:**
- `server/gemini.ts`(扩展)

---

## - [ ] Task 5.3: 功能验收清单

桌面 + 移动端各测试一遍以下场景:

- [x] 阅读文章,点击 target 词 → 浮窗显示完整 senses
- [x] 点击非 target 词(已收录,full)→ 浮窗 < 100ms 显示
- [x] 点击非 target 词(已收录,lite)→ 浮窗显示 lite 版
- [x] 点击非 target 词(变形,如 `decided`)→ 显示原形 `decide` 数据
- [ ] 点击未收录词 → skeleton → 1-3s 后显示新数据 → DB 中 `enrichment_level='lite'`
- [x] 点击停用词(the / of)→ 不弹浮窗
- [x] 浮窗里点"加入词库" → 按钮变红色"移除"+ 后台触发 full enrichment
- [ ] 几秒后(若停留在 LibraryView)→ Realtime 触发,词的内容自动刷新到 full
- [ ] LibraryView 看到 saved word
- [ ] LibraryView 选 30 词建组 → 跳转学习,流程跑通
- [ ] Import 30 词 → 进入词库,**不直接进入学习**
- [x] 点击同一词的不同位置 → 浮窗位置跟随
- [ ] 浮窗加载中点另一词 → A 关闭,B 显示 skeleton(且 A 的请求结果仍写入 DB)

**阻塞记录(2026-05-02):**
- 真实 LLM 验收被当前 `.env` 的 Gemini API key 阻塞: Gemini 返回 `API key expired. Please renew the API key.`。
- 因此未勾选依赖真实 Gemini 成功的 fresh-word lite fallback、full enrichment 完成后的 Realtime 刷新,以及端到端 Import/Library 30 词建组验收。
- 已完成的勾选项来自 Playwright 三视口组件验收 + 临时 Supabase 用户/API smoke；未完成项需要替换有效 Gemini key 后重跑。

---

# 风险与回滚

## 主要风险
1. **forms UNIQUE 约束冲突**:不同 vocabulary_item 都尝试 claim `bear` 这种歧义形。处理:lite enrich 写入用 `ON CONFLICT DO NOTHING`,先到先得。
2. **Realtime 配置失败**:如果 publication 没启用 vocabulary_items,full enrichment 完成后前端不刷新。**降级:** LibraryView 进入时强制重新 fetch。
3. **migration 脚本对生产数据**:理论是只读 + 写 user_saved_words,不动 learning_groups。**先在 test 项目跑过**。
4. **lite vs full 视觉混淆**:用户可能看到 lite 词没有例句以为是 bug。**减缓:** 词详情页加"(完整数据生成中)"小提示。

## 回滚
- 每个 phase 独立 commit
- migration 写好 down(DROP TABLE / ALTER TABLE DROP COLUMN)
- lite enrich 大规模失败:`/api/vocab/lite-enrich` 临时返回 503,浮窗显示"无法查询此词"

---

# 预计工作量

| Phase | 工时 |
|---|---|
| Phase 0 — Schema 与迁移 | 1-2 小时 |
| Phase 1 — 后端 API | 3-4 小时 |
| Phase 2 — 前端基础设施 | 3-4 小时 |
| Phase 3 — 浮窗集成 | 4-6 小时 |
| Phase 4 — 词库重构 | 4-6 小时 |
| Phase 5 — 收尾验证 | 1-2 小时 |
| **合计** | **16-24 小时** |
