# Lumina IELTS 产品说明

> 更新时间：2026-04-15  
> 说明：这份文档按当前代码与数据库实现校正，只描述“已经落地”或“已在当前架构中明确预留”的内容，不再把尚未开发的设想写成既成事实。

## 1. 产品定位

Lumina IELTS 是一款面向雅思词汇学习的状态驱动型记忆系统。

它的目标不是让用户“看过单词”，而是把单词学习拆成几个更接近真实记忆过程的阶段：

- 先建立词形和释义的初步连接
- 再做中文到英文的主动回忆
- 再做英文到中文的快速识别
- 最后放回文章语境中完成收尾
- 后续根据作答结果和耗时，安排真正有意义的复习时间

当前产品的核心判断不是“你答对了没有”这么粗，而是进一步区分：

- 完全想不起来
- 能答出来，但明显迟疑
- 能较快回忆出来
- 已经稳定到可以毕业

## 2. 当前真实产品入口

当前入口结构已经不是“产品内嵌一个登录页”，而是清晰分层：

- `/`：Landing Page，产品预览和主入口
- `/auth`：登录 / 注册入口
- `/app/*`：登录后的产品区

行为规则：

- 未登录访问 `/app/*` 会被重定向到 `/auth?next=原路径`
- 已登录访问 `/auth` 会跳回 `next` 或 `/app/home`
- 左下角设置按钮会弹出账户菜单，支持退出账户

当前鉴权方式：

- Google OAuth 是主入口
- 邮箱密码登录 / 注册是备用入口

## 3. 当前已经跑通的主流程

当前版本已经跑通的是这条链路：

登录 → 导入自定义单词 → AI 生成词条 → 保存到 Supabase → 3 轮学习 → 文章巩固 → 进入长期复习状态 → 首页按到期队列开始复习

这里有两个边界需要说明：

- 当前只支持“用户自定义导入”作为新学习入口，还没有做系统词库选组
- 当前首页在“没有到期复习”时，会把用户带到导入页，而不是自动发放一个内置学习组

## 4. 当前学习与复习规则

### 4.1 学习单位

- 每次导入最多 30 个词
- 一组词会依次经过 `round1 -> round2 -> round3 -> article`
- 组内顺序在导入后固定保存到 `learning_group_words`

### 4.2 Round 1：明示拼写

当前实现：

- 完整显示单词、音标、词性、中文释义、例句、易混词
- 用户仍然需要输入英文拼写
- 按 Enter 或点击“下一个词”会触发校验
- 输入错误时，不会进入下一个词，而是留在当前词继续修正

这一轮的作用是建立最初的词形熟悉度，不写长期复习状态。

### 4.3 Round 2：主动回忆

当前实现：

- 只显示中文释义
- 用户输入英文单词
- 按 Enter 或点击“下一个词”都会触发校验
- 结果会即时写库

当前错题处理方式不是“原地打断重来”，而是：

- 答错后显示答案
- 当前词会被插回队列后段
- 过一小会儿再重新出现

这轮是长期状态的首次判定入口，规则固定为：

- 错误：`new -> fuzzy`
- 正确但耗时大于 `6000ms`：`new -> slow_recall`
- 正确且耗时不超过 `6000ms`：`new -> stable_recall`

### 4.4 Round 3：快速识别

当前实现：

- 显示英文单词、音标、词性、音频
- 默认隐藏中文释义
- 主按钮第一次点击是“显示释义”
- 显示释义后，主按钮变成“下一个词”
- Enter 键等价于当前主动作

这一轮不写长期状态，作用是做一次英文到中文的快速确认。

### 4.5 文章巩固

Round 3 结束后，系统会调用 Gemini 生成一篇收尾文章。

当前实现：

- 文章由服务端实时生成
- 页面会高亮本轮目标词
- 用户读完后点击“结束这一轮”返回首页

当前边界：

- 文章已生成并展示，但当前代码路径还没有把文章持久化写入 `generated_articles`

### 4.6 日常复习

首页点击开始后，系统会优先读取真实到期复习队列。

筛选规则：

- `memory_state != mastered`
- `next_review_at <= now`

排序规则：

- `next_review_at ASC`
- 同一批次下按 `fuzzy -> slow_recall -> stable_recall`
- 再按 `last_assessed_at ASC`

日常复习的交互界面沿用 Round 2，但状态迁移规则不同：

- 错误：降到 `fuzzy`
- 正确但慢：落到 `slow_recall`
- 正确且快：
  - `fuzzy -> slow_recall`
  - `slow_recall -> stable_recall`
  - `stable_recall -> mastered`

间隔规则当前是固定值，不是 SM-2：

- `fuzzy`：1 天后复习
- `slow_recall`：3 天后复习
- `stable_recall`：7 天后复习
- `mastered`：毕业，不再进入日常到期队列

## 5. 当前页面结构

### 5.1 Landing Page

作用：

- 展示产品主价值
- 解释为什么要先登录再进入产品区
- 提供主入口 CTA

当前 CTA：

- `使用 Google 继续`
- `邮箱登录`

### 5.2 Auth 页面

当前包含：

- Google 登录
- 邮箱密码登录
- 邮箱密码注册
- 登录成功后的目标路径跳转

### 5.3 Home 首页

当前展示：

- 今日待复习词数
- 今日新建学习组数
- 连续学习天数
- 已掌握单词数
- 开始按钮

注意：

- 当前的 `todayNewGroups` 是“今天创建了多少学习组”，不是系统预先分配好的“待学新词组数”
- 当前没有“继续上次未完成学习会话”的独立入口

### 5.4 导入页

当前支持：

- 用户粘贴单词
- 按逗号或换行切分
- 最多取前 30 个词
- 调用 AI 生成词条
- 预览后保存并开始学习

当前不支持：

- 系统词库选组
- 批量预制课程路线

### 5.5 学习会话页

当前承担：

- Round 1
- Round 2
- Round 3
- 日常复习
- 文章收尾

如果没有当前会话数据，会显示空状态并引导回首页。

### 5.6 词库页

当前词库页不是全站词典，而是“当前用户已进入追踪状态的词”。

数据来源：

- 从 `review_states` 出发
- 关联 `vocabulary_items / vocabulary_senses / confused_words`

当前可见内容：

- 单词
- 音标
- 中文释义
- 当前记忆状态
- 下次复习时间
- 最近一次结果
- 例句
- 易混词说明
- 记忆提示

### 5.7 复习结果页

当前在一轮日常复习结束后展示：

- 每个词本次的状态变化
- 升级 / 降级 / 毕业结果

### 5.8 我的页面

当前是轻量账户页，不是完整数据看板。

目前只展示：

- 当前账户基本信息
- 已掌握数量
- 当前待复习数量

尚未实现：

- 错词统计
- 完整复习完成率
- 收藏词
- 深度学习画像

## 6. AI 与音频能力

### 6.1 AI 词条生成

当前 AI 生成内容包括：

- 英式 / 美式音标
- 中文主释义
- 多个词性义项
- 例句
- 易混词
- 记忆提示
- 命名实体标签（如适用）

返回形式是结构化 JSON，便于前端渲染和数据库写入。

### 6.2 音频

当前音频策略：

- 导入完成后，会尝试批量生成 UK / US 发音
- 已有缓存时直接复用
- 没有缓存时调用 Gemini TTS 生成并上传到 Supabase Storage
- 学习中换词会自动播放 UK 发音
- 如果远端音频失败，会降级到浏览器 `speechSynthesis`

当前音频接口：

- `GET /api/audio/:word?locale=uk|us`
- `POST /api/audio/batch`

## 7. 当前真实数据结构

### 7.1 已存在并在当前系统中使用的表

- `vocabulary_items`
- `vocabulary_senses`
- `confused_words`
- `learning_groups`
- `learning_group_words`
- `review_states`
- `review_events`

### 7.2 已建表但当前主流程未完整使用的表

- `generated_articles`

说明：

- 表已经存在，也已纳入 RLS
- 但当前文章生成流程仍是“生成后直接返回前端展示”，还没有落库保存

### 7.3 当前不存在的表

下面这些在旧版文档里被写成了既有设计，但当前项目里并不存在：

- `user_wordbook_items`
- `audio_assets`

因此它们不应再被当成当前实现的一部分。

### 7.4 `review_states` 当前字段语义

当前关键字段：

- `memory_state`
- `last_result`
- `last_elapsed_ms`
- `last_assessed_at`
- `next_review_at`
- `review_count`
- `lapse_count`
- `graduated_at`

字段含义：

- `review_count`：只统计日常 review，不统计 Round 2 首次判定
- `lapse_count`：只在日常 review 答错时增加
- `last_reviewed_at`：只记录日常 review 时间

## 8. 当前真实 API

### 8.1 已实现接口

- `POST /api/vocab/enrich`
- `POST /api/vocab/article`
- `POST /api/review/attempt`
- `GET /api/review/due`
- `GET /api/audio/:word`
- `POST /api/audio/batch`
- `GET /api/health`

### 8.2 鉴权要求

以下接口当前要求 Bearer Token：

- `POST /api/vocab/enrich`
- `POST /api/vocab/article`
- `POST /api/review/attempt`
- `GET /api/review/due`

音频接口当前未要求登录态。

### 8.3 旧文档中提到、但当前并不存在的接口

以下接口在当前仓库中没有实现，不应再当成已落地 API：

- `POST /api/vocab/import/system`
- `POST /api/vocab/import/custom`
- `POST /api/vocab/enrich/batch`
- `POST /api/groups/create`
- `GET /api/groups/:id`
- `GET /api/groups/:id/words`
- `GET /api/learn/today`
- `POST /api/learn/round1/submit`
- `POST /api/learn/round2/submit`
- `POST /api/learn/round3/submit`
- `GET /api/article/:groupId`
- `POST /api/audio/generate`
- `GET /api/user/dashboard`

## 9. 当前技术栈

- 前端：React 19、TypeScript、Vite、React Router
- 动效：`motion`
- 服务端：Express、TSX
- AI：Google Gemini
- 数据库与鉴权：Supabase
- 存储：Supabase Storage

## 10. 当前已实现与未实现边界

### 10.1 已实现

- 正确入口层级：Landing → Auth → App
- 真实 Supabase Auth
- Google OAuth 主入口
- 用户级数据隔离
- 30 词内自定义导入
- AI enrich
- 三轮学习
- 实时生成文章
- 音频缓存与播放
- Round 2 / Review 即时写库
- 状态驱动复习调度
- 词库详情抽屉
- 复习结果页

### 10.2 仍未实现或未完全打通

- 系统词库选组
- 自动发放新的内置学习组
- 文章落库到 `generated_articles`
- 完整学习会话恢复
- 完整账户中心 / 偏好设置
- 深度统计面板
- 收藏与错词专题管理

## 11. 一句话定义

Lumina IELTS 当前是一套“先登录、再导入、再学习、再按真实状态复习”的雅思词汇系统：它已经具备用户级鉴权、三轮学习、文章巩固、即时写库和状态驱动复习，但仍处在“自定义导入优先、系统词库与深度运营能力待补”的阶段。
