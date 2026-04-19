# Lumina IELTS 游戏化与打卡机制设计

> 更新时间：2026-04-19  
> 目的：把 Lumina IELTS 的打卡、连续学习、任务、奖励与游戏化方向整理成一份可继续决策、可继续实现的产品文档。  
> 当前决策基线：`双层打卡` + `中度活跃` + `先做单人` + `适度宽容` + `系统自适应目标`

---

## 0. 当前现状事实

Lumina IELTS 当前是一款面向雅思词汇学习的状态驱动型记忆系统，不是泛娱乐背单词 App。

当前已经具备的能力：

- 以 `round1 -> round2 -> round3 -> article` 组织一组词的学习过程
- 以 `new / fuzzy / slow_recall / stable_recall / mastered` 组织长期记忆状态
- 首页已展示 `待复习 / 今日新组 / 连续天数 / 已掌握`
- 词库、复习结果页、设置页都已经接入真实数据

当前还没有正式产品定义的能力：

- 什么行为才算“今天打卡成功”
- 什么叫“完美完成今天”
- 连续天数是否应该绑定学习结果，而不是绑定建组日期
- 断签怎么处理，是否允许冻结、补救、系统补偿
- 日任务、周目标、等级、徽章、奖杯柜、学习周报

当前需要特别修正的一点：

- 现在首页里的 `streak` 仍然是按 `learning_groups.created_at` 的连续日期推算，不是真正的“完成了有效学习 block 的连续天数”
- 这意味着它现在更像“连续建组”而不是“连续学对了、学到了”

所以这份文档的核心原则是：

1. 游戏化必须服务记忆效果，而不是服务表面活跃。
2. 不做“登录即打卡”。
3. 不做纯 XP 刷分。
4. 不做强社交和公开排行榜作为首期核心。
5. 所有奖励都优先绑定“有意义学习行为”。

---

## 1. 设计原则

### 1.1 游戏化不是目的，是放大学习闭环的手段

Lumina IELTS 的目标不是让用户觉得“我今天来过了”，而是让用户觉得：

- 我今天真的推进了记忆
- 我知道今天该先做什么
- 我没被系统误伤
- 我能看到自己逐步变强
- 我愿意明天继续回来

### 1.2 首先保护连续感，其次保护成就感

长周期语言学习中，最怕的不是某一天学得少，而是因为一次断签让用户放弃整个系统。

因此连续机制需要同时满足两点：

- 要真实，不能随便点一下就续命
- 要宽容，不能一次漏学就让长期努力瞬间归零

### 1.3 目标要由系统生成，而不是让用户每天重新做决定

用户每天最容易流失的时刻，不是做题做错，而是打开首页后不知道“今天先干嘛”。

因此系统必须自动给出最合理的今日顺序：

- 先复习
- 再继续没做完的学习
- 最后再考虑新内容

### 1.4 视觉奖励要克制，但要可累计

Lumina 当前气质偏克制、干净、高级。  
不适合上宠物养成、重卡通大弹窗、强刺激氪金式 UI。

更适合的是：

- 学习航线
- 光轨节点
- 连续点亮
- 奖杯柜
- 周回顾卡

也就是“安静但有成就感”的游戏化。

---

## 2. 外部参考

这一节只记录对 Lumina 有帮助的机制，不照搬外部产品表层玩法。

## 参考项目：Duolingo

### 这是什么

Duolingo 是语言学习领域里最成熟的连续学习与轻量游戏化产品之一。它把 streak、quests、achievements、friends quest、路径推进和里程碑动画串成了完整留存循环。

### 为什么有效

- 把“每天回来”变成一个明确目标
- 用 streak 放大习惯形成
- 用 freeze 降低一次断签带来的挫败感
- 用 quest 把用户引导到更高价值的学习路径，而不是无脑刷 XP
- 用动画和里程碑放大“我又前进了一点”的感觉

### 适合借鉴什么

- `streak freeze`：给连续机制一点容错
- `daily quests + monthly progress`：让目标更具体
- `achievement shelf`：让长期积累可展示
- `progress should follow learning path`：奖励必须跟真实学习路径绑定
- `milestone animation`：关键天数、关键毕业节点要庆祝

### 不该照搬什么

- 公开排行榜和周冲榜
- 以 XP 为核心的奖励体系
- 为了活动而活动的高频运营位

### 来源链接

- [Protecting streaks from site issues](https://blog.duolingo.com/protecting-streaks-from-site-issues/)
- [Friends Quests](https://blog.duolingo.com/friends-quests/)
- [Achievements](https://blog.duolingo.com/achievement-badges/)
- [Time Spent Learning Well](https://blog.duolingo.com/time-spent-learning-well/)
- [Streak habit effects](https://blog.duolingo.com/de/duolingos-streak-gewohnheiten-aufbaut/)

## 参考项目：Memrise

### 这是什么

Memrise 一方面保留了 streak，另一方面又补了 `My Activities` 这种更低压力的进展回顾模块。

### 为什么有效

- 不只用 streak 驱动用户
- 允许用户从“我今天有没有坚持”转向“我最近到底学了什么”
- 能减轻长周期学习里的 guilt 感

### 适合借鉴什么

- `quiet progress recap`：安静的进展回顾
- `多个真实学习动作都能计入连续`：不要把 streak 绑定到单一入口
- 在 Profile 页展示本周真实学习轨迹，而不是只显示一个火焰数字

### 不该照搬什么

- 过于松散的目标定义
- 只看活动量，不看学习质量

### 来源链接

- [How can I track my Streak?](https://memrisebeta.zendesk.com/hc/en-us/articles/16898724195729-How-can-I-track-my-Streak)
- [What is My Activities?](https://memrisebeta.zendesk.com/hc/en-us/articles/34227724083857-What-is-My-Activities)

## 参考项目：Quizlet

### 这是什么

Quizlet 在 Learn 模式里提供 `answer streak`。它不是天级 streak，而是一次学习会话内的连续正确反馈。

### 为什么有效

- 即时反馈非常强
- 用户会在单次 session 里获得“我现在状态很好”的爽感
- 它强化的是答题专注度，不是单纯签到

### 适合借鉴什么

- `answer streak / recall combo`
- 在 Round 2 和日常复习中，对连续首答正确做微庆祝
- 把成就感下沉到单词级、会话级，而不是只停留在“今天来没来”

### 不该照搬什么

- 把会话连击直接做成可刷的大数值经济

### 来源链接

- [Studying with Answer Streaks](https://help.quizlet.com/hc/en-us/articles/40011154960653-Studying-with-Answer-Streaks)

## 参考项目：Elevate

### 这是什么

Elevate 是典型的“每日训练 + streak freeze + badge ladder”结构。它对“什么叫完成今天”定义得很清楚。

### 为什么有效

- 每日训练完成口径清楚
- freeze 上限明确
- 里程碑奖励清楚
- badge 的阶梯感很强

### 适合借鉴什么

- `每日训练完成` 必须有明确口径
- `freeze` 有上限，不能无限囤
- 达成里程碑时返还保护资源
- 徽章要做成阶梯，而不是一次性勋章

### 不该照搬什么

- 过于简单的“做完 Daily Workout 就算全部完成”，因为 Lumina 的学习结构比它更复杂

### 来源链接

- [What is a streak?](https://support.elevateapp.com/hc/en-us/articles/4402925042715-What-is-a-streak)
- [What is a streak freeze?](https://support.elevateapp.com/hc/en-us/articles/28507604797595-What-is-a-streak-freeze)
- [How are Achievement badges earned?](https://support.elevateapp.com/hc/en-us/articles/4402924937243-How-are-Achievement-badges-earned)

## 参考项目：Khan Academy

### 这是什么

Khan Academy 的做法很克制：它把 streak 和 level 绑定到 `proficient` 这种有学习含义的进展，而不是绑定浅层行为。

### 为什么有效

- 用户知道这个 streak 有含金量
- 等级不是刷出来的，而是学出来的
- 游戏化没有压过教育目标

### 适合借鉴什么

- streak 要绑定“有意义进步”
- level 要绑定“真正毕业、真正掌握”
- 要有“离下一等级还差多少”的清晰反馈

### 不该照搬什么

- 直接照搬周级 streak 口径

Lumina 是词汇系统，更适合日级闭环；但 Khan Academy 的“必须绑定有效学习成果”这条原则非常值得保留。

### 来源链接

- [Introducing Streaks and Levels](https://support.khanacademy.org/hc/en-us/articles/28946883989261-Introducing-Streaks-and-Levels)
- [What are Streaks and Course Levels?](https://support.khanacademy.org/hc/en-us/articles/360054115071-What-are-Streaks-and-Course-Levels)

## 参考项目：Forest

### 这是什么

Forest 不是语言学习产品，但它用“种树、成长、枯萎”的视觉机制，把专注变成了可累计的成果。

### 为什么有效

- 用户会把抽象的坚持，感知成具体的视觉积累
- 放弃会造成可见损失
- 每一次完成都能往更大的整体图景上添一笔

### 适合借鉴什么

- 用“光轨 / 星图 / 航线”取代普通日历
- 让连续学习拥有可累计、可回看的视觉痕迹
- 用 shield 日、完美日、普通打卡日做不同亮度层级

### 不该照搬什么

- 直接做“树死了”的强惩罚叙事

Lumina 更适合“航线暂时变暗”而不是“摧毁成果”。

### 来源链接

- [Forest 官方站点](https://www.forestapp.cc/)

## 参考项目：Duolingo Friends Quests

### 这是什么

Duolingo 用朋友组队任务提升外部责任感和共同完成感。

### 为什么有效

- 有同伴责任感
- 有中期目标
- 完成后奖励显著

### 适合借鉴什么

- 只作为未来扩展位保留
- 将来可以做“好友助力完美周”或“二人复习挑战”

### 不该照搬什么

- 首期就把社交做成核心

Lumina 当前更需要先把个人闭环做扎实。

### 来源链接

- [Friends Quests](https://blog.duolingo.com/friends-quests/)

---

## 3. Lumina 推荐方案

这一节不是“可选脑暴”，而是当前推荐默认方案。

## 决策点：双层打卡

**推荐**：采用

- [x] 采用
- [ ] 暂缓
- [ ] 不采用

### 这是什么

把“我今天回来学习了”和“我今天把系统建议的关键任务做完了”拆成两层：

- `学习打卡`：今天完成至少 1 个有效学习 block
- `完美日`：今天系统生成的所有关键 block 都完成

### 为什么要引入

- 单层签到太容易变成形式主义
- 单层高门槛又会让很多用户因为忙碌而断掉
- 双层机制既保留连续感，也保留质量感

### 怎么引入

- 学习打卡用于 `current streak`
- 完美日用于 `weekly milestone / badge / 周报`
- 完美日不另起一条平行 streak，避免系统复杂和用户认知负担

### 有趣点

- 用户即使只完成了第一块，也会觉得“今天没断”
- 用户完成全部块时，会得到明显更强的点亮反馈
- 完美日可以形成“本周我拿了几次满格”的成就感

### 对现有数据/页面的影响

- 首页顶部 streak 要改成真正的学习 streak
- Profile 页新增 `完美日`
- 日历型视图要区分普通打卡和完美日

## 决策点：系统自适应学习块

**推荐**：采用

- [x] 采用
- [ ] 暂缓
- [ ] 不采用

### 这是什么

把“今天要做什么”自动拆成最多 3 个 block，并固定优先级：

1. `复习块`
2. `继续块`
3. `新学习块`

默认规则：

- `复习块`：最多 10 个到期词
- `继续块`：推进 10 个词，或推进到当前轮次边界
- `新学习块`：新组前 10 个词

### 为什么要引入

- 让用户打开首页后不用自己判断
- 把任务量切成可完成的小块
- 避免“今天没空，算了不学”的心理

### 怎么引入

- 每日首次进入首页时，由服务端生成当天 block
- 如果当天有到期复习，必须先出现复习块
- 如果当天无到期复习但有未完成会话，优先继续块
- 只有前两者都没有时，才生成新学习块

### 有趣点

- 每完成一个块，航线就亮一个节点
- 用户会感觉自己在“推进今天的路线”
- 很适合后续叠加完美日和周目标

### 对现有数据/页面的影响

- 首页 CTA 从单一按钮进化成“今日路线”
- 需要新的 `today blocks` 接口
- 原有 `todayReviewCount` 仍可保留，但不再是首页唯一主叙事

## 决策点：连续机制与 Streak Shield

**推荐**：采用

- [x] 采用
- [ ] 暂缓
- [ ] 不采用

### 这是什么

主 streak 绑定“完成至少 1 个有效 block”。  
当用户漏掉一天时，如果还有 shield，则自动保护 streak，不让它断开。

默认规则：

- shield 上限：2
- 默认新用户初始：2
- 自动触发，不要求用户手动点
- 用掉后可通过里程碑或重建 streak 补回

### 为什么要引入

- 一次忙碌不该摧毁长期努力
- 容错能提高长期坚持率
- 也能覆盖网络、同步、系统故障等非用户原因

### 怎么引入

- `3 / 7 / 14 / 30 / 50 / 100` 天里程碑时，如果 shield 未满，则补 1 个
- 当用户 shield 用光且断签后，新的 streak 达到 2 天时补回 2 个
- 系统故障或延迟时，服务端可按日志和记录自动补偿

### 有趣点

- 用户会把 shield 当成“连续感保险”
- 到 7 天、14 天等里程碑时更有仪式感
- 暗光 shield 节点在视觉上会很有记忆点

### 对现有数据/页面的影响

- 首页需展示 `streak + shield`
- Profile 页需要展示 `当前连续 / 最长连续 / shield 余额`
- streak 不再由前端按建组日期临时计算

## 决策点：日任务系统

**推荐**：采用

- [x] 采用
- [ ] 暂缓
- [ ] 不采用

### 这是什么

每天 3 个任务，每周 1 个里程碑。

推荐任务池：

- 清掉 1 个复习块
- 毕业 3 个词
- 以 80% 首答正确率完成 1 个 block
- 继续昨天没学完的那组
- 完成今天全部 block

### 为什么要引入

- 把“学一下”改成“完成一个明确目标”
- 让不同阶段的用户都知道下一步是什么
- 强化中度活跃，而不是重度游戏

### 怎么引入

- 任务只从高价值行为池里抽取
- 每日任务不允许通过单词级重复操作刷完
- 周里程碑建议优先与 `完美日次数 / mastered 数 / 完成复习块数` 绑定

### 有趣点

- 每天任务不同，能减少单调感
- 周里程碑会给用户“这一周我不只是签到”的感觉
- 后续可扩展为赛季卡片，但首期不必重做

### 对现有数据/页面的影响

- 首页新增任务卡
- Profile 页增加“本周进度”
- 需要 `quest_instances`

## 决策点：等级与徽章

**推荐**：采用，但放在 V1.5

- [x] 采用
- [ ] 暂缓
- [ ] 不采用

### 这是什么

等级用于展示长期成长，徽章用于展示里程碑与风格化成就。

推荐等级经验来源：

- `mastered` 数
- `stable -> mastered` 次数
- 完成组数
- 完美日数

推荐徽章分类：

- 连续性
- 精准度
- 恢复力
- 毕业量
- 坚持度

### 为什么要引入

- streak 只讲连续，不讲“我变强了多少”
- 等级和徽章可以承接长期成就
- 很适合放到 Profile 页形成奖杯柜

### 怎么引入

- level 只吃高价值进度，不吃纯点击或纯登录
- 徽章采用 tier 结构，例如铜银金，而不是一次性点亮后就结束

### 有趣点

- 奖杯柜很适合做收藏感
- 用户会从“保 streak”过渡到“冲成就”
- 也方便后续做年度回顾

### 对现有数据/页面的影响

- Profile 页会从轻量账户页升级为轻度成长页
- 需要 `user_gamification_state` 与 `achievement_progress`

## 决策点：微反馈与 Answer Streak

**推荐**：采用，但放在 V1.5

- [x] 采用
- [ ] 暂缓
- [ ] 不采用

### 这是什么

在 Round 2 和日常 Review 中追踪连续首答正确数。

建议触发点：

- 3 连：`Recall Combo`
- 5 连：`Sharp Recall`

### 为什么要引入

- 用户在单次 session 里也需要即时爽感
- 它直接强化“答得稳、答得快”
- 比单纯做个 streak 大数字更贴近学习手感

### 怎么引入

- 只统计首答正确
- 只做动画、文案、轻量音效，不做货币奖励
- 被答错打断时立刻归零

### 有趣点

- 单轮学习更有节奏
- 用户会更在意自己的首答质量
- 与 `80% 首答正确率完成 block` 的任务天然联动

### 对现有数据/页面的影响

- 学习页与 Review 页增加会话内状态
- 首期可以先前端计算，不必先落库

## 决策点：安静的进展回顾

**推荐**：采用

- [x] 采用
- [ ] 暂缓
- [ ] 不采用

### 这是什么

在 Profile 页增加低压力的真实学习回顾，而不只显示账户信息与三个统计卡。

推荐指标：

- 本周复习词数
- 本周新学词数
- 本周完美日
- 最长连续
- 最难词

### 为什么要引入

- 减轻 streak 的单点压力
- 帮用户看到真正的学习轨迹
- 很适合作为中长期留存的缓冲层

### 怎么引入

- 指标优先取自 review、learning、daily record 的真实数据
- 最难词可按最近 7 天错误次数或重试次数排序

### 有趣点

- 用户会获得“我并没有白学”的感觉
- 它比单一 streak 更适合长周期备考

### 对现有数据/页面的影响

- Profile 页从“账户卡片”升级为“学习成长页”
- 周回顾未来可以继续衍生成分享卡

## 决策点：视觉主题

**推荐**：采用 `Lumina 光轨 / 星图 / 学习航线`

- [x] 采用
- [ ] 暂缓
- [ ] 不采用

### 这是什么

用“航线推进”而不是“宠物养成”做整体视觉母题：

- 普通打卡日：点亮基础节点
- 完美日：高亮节点
- shield 保护日：暗光节点
- 连续周：形成一段可回看的航线

### 为什么要引入

- 和当前克制高级的视觉风格兼容
- 能承接连续感、完美日、任务完成、周回顾
- 比传统日历更有产品识别度

### 怎么引入

- 首期先落在首页和 Profile 页
- 不必一次性重做整站视觉

### 有趣点

- 用户能直观看到“我的学习轨迹在延长”
- 保护日和完美日有不同视觉层级，会很有记忆点

### 对现有数据/页面的影响

- 首页顶区可升级为路线视图
- Profile 页适合加“过去 14 天航线”

---

## 4. 推荐数据结构与接口

这一节是产品设计所需的数据真相，不是要求一次性全部实现。

## 数据结构

### `daily_learning_records`

用途：记录“某个本地日期里，系统给了什么 block，用户完成到了哪一步，是否打卡，是否完美，是否用了 shield”。

建议字段：

- `id`
- `user_id`
- `local_date`
- `timezone`
- `generated_blocks_json`
- `checkin_at`
- `perfect_day_at`
- `streak_status`
- `shield_used`
- `created_at`
- `updated_at`

### `user_gamification_state`

用途：存放用户级游戏化状态，不再让首页靠前端散算。

建议字段：

- `user_id`
- `current_streak`
- `longest_streak`
- `shield_balance`
- `level`
- `level_points`
- `perfect_days`
- `updated_at`

### `quest_instances`

用途：记录每天和每周任务的生成结果、进度和完成情况。

建议字段：

- `id`
- `user_id`
- `scope`：`daily | weekly`
- `quest_type`
- `title`
- `target_value`
- `progress_value`
- `reward_type`
- `reward_payload_json`
- `starts_at`
- `ends_at`
- `completed_at`

### `achievement_progress`

用途：记录徽章解锁与进度。

建议字段：

- `id`
- `user_id`
- `category`
- `achievement_key`
- `tier`
- `progress_value`
- `unlocked_at`
- `updated_at`

## 接口方向

首页与 Profile 页最终应统一依赖新的 stats 接口，而不是继续在前端临时拼接：

- `today blocks`
- `current streak`
- `longest streak`
- `shield balance`
- `today quests`
- `weekly milestone`
- `level / level points`
- `badge summary`
- `profile weekly recap`

---

## 5. 分阶段落地建议

## V1 必做

- [x] 双层打卡
- [x] 系统自适应学习块
- [x] 真正的学习 streak
- [x] streak shield
- [x] Profile 安静进展回顾

这一阶段解决的问题是：

- 今天到底算不算打卡
- 首页该先让我做什么
- 连续天数是否可信
- 一次漏学会不会毁掉长期努力

## V1.5 增强

- [x] 日任务系统
- [x] 周里程碑
- [x] 等级
- [x] 徽章
- [x] answer streak 动效

这一阶段解决的问题是：

- 如何把中期目标做出来
- 如何让学习 session 本身更有爽感
- 如何让 Profile 页更像成长页

## V2 预留

- [x] 周报卡片
- [x] 赛季主题
- [x] 好友助力扩展位
- [ ] 公开排行榜

这一阶段只做增强，不改变核心闭环。

---

## 6. 明确不做

以下方向当前明确不建议进入首期：

- [x] 登录即打卡
- [x] 纯 XP 经济
- [x] 强制社交
- [x] 公开排行榜
- [x] 重宠物养成
- [x] 随机抽卡式奖励
- [x] 只靠签到维持连续、不要求有效学习

原因很简单：

- 它们会稀释学习目标
- 它们和 Lumina 当前气质不一致
- 它们会显著抬高系统复杂度
- 它们更容易带来“活跃上去了，记忆质量没上去”的伪增长

---

## 7. 验收标准

以下场景必须在产品定义上先明确，后续实现才能稳定：

- [ ] 用户只打开页面、不完成 block，不算打卡
- [ ] 当天有到期复习时，系统必须先生成复习块，而不是推新词
- [ ] 当天无到期复习但有未完成会话时，系统必须生成继续块
- [ ] 当天前两者都没有时，才生成新学习块
- [ ] 有 shield 时漏 1 天，连续天数保持
- [ ] 无 shield 时漏 1 天，连续天数重置，并在次日可正常重建
- [ ] 午夜前开始、午夜后结束的学习，要有稳定归属规则
- [ ] 跨时区、弱网、离线后补同步时，streak 判定一致
- [ ] 系统故障或同步延迟时，可按服务端记录补偿，不误伤用户
- [ ] 日任务不能通过低价值重复动作刷完

---

## 8. 对当前产品页面的具体影响

## 首页

从“单个开始按钮 + 三张统计卡”升级为：

- 今日路线
- 当前 streak + shield
- 今日任务
- 今天先做什么
- 完成后点亮的航线节点

## 学习页 / Review 页

增强点：

- 连续首答正确反馈
- block 完成感
- 从“做完一个词”变成“推进一个 block”

## Profile 页

从“轻量账户页”升级为：

- 当前 streak
- 最长 streak
- shield 余额
- 本周复习词数
- 本周新学词数
- 完美日
- 最难词
- 奖杯柜

## 设置页

未来可扩展但不建议首期就做满：

- 是否展示 streak 提醒
- block 强度偏好
- 视觉庆祝强度

---

## 9. 当前推荐结论

Lumina IELTS 最适合的不是“强刺激游戏化”，而是“有学习含金量的中度游戏化”。

最应该坚持的方向：

- 用 `双层打卡` 解决连续感与质量感冲突
- 用 `系统自适应学习块` 解决首页无从下手的问题
- 用 `shield` 解决断签挫败问题
- 用 `任务 / 等级 / 徽章 / 微反馈` 提升中短期动力
- 用 `安静的进展回顾` 抵消单一 streak 带来的心理压力
- 用 `Lumina 光轨 / 星图 / 学习航线` 保持品牌气质，而不是变成另一个通用游戏壳

一句话总结：

> Lumina 的游戏化不应该让用户“玩得上头”，而应该让用户“更稳定地记住词，并且愿意明天继续回来”。

---

## 10. 研究锚点

- [Duolingo：streak freeze 与系统故障补偿](https://blog.duolingo.com/protecting-streaks-from-site-issues/)
- [Duolingo：Friends Quests 与社交激励](https://blog.duolingo.com/friends-quests/)
- [Duolingo：Achievements 与 milestone 展示](https://blog.duolingo.com/achievement-badges/)
- [Duolingo：任务应绑定真实学习路径，而不是 XP 刷量](https://blog.duolingo.com/time-spent-learning-well/)
- [Duolingo：streak 的习惯效应、里程碑动画、loss aversion、7 天 streak 与完成率](https://blog.duolingo.com/de/duolingos-streak-gewohnheiten-aufbaut/)
- [Memrise：streak 可以由多种真实学习动作触发](https://memrisebeta.zendesk.com/hc/en-us/articles/16898724195729-How-can-I-track-my-Streak)
- [Memrise：My Activities 的低压力进展回顾](https://memrisebeta.zendesk.com/hc/en-us/articles/34227724083857-What-is-My-Activities)
- [Quizlet：answer streak 的即时爽感机制](https://help.quizlet.com/hc/en-us/articles/40011154960653-Studying-with-Answer-Streaks)
- [Elevate：每日训练定义、freeze、里程碑返还、badge ladder](https://support.elevateapp.com/hc/en-us/articles/4402925042715-What-is-a-streak)
- [Elevate：freeze 规则与获取方式](https://support.elevateapp.com/hc/en-us/articles/28507604797595-What-is-a-streak-freeze)
- [Elevate：achievement badge 解锁逻辑](https://support.elevateapp.com/hc/en-us/articles/4402924937243-How-are-Achievement-badges-earned)
- [Khan Academy：streak 应绑定 proficiency，不绑定浅层活跃](https://support.khanacademy.org/hc/en-us/articles/28946883989261-Introducing-Streaks-and-Levels)
- [Khan Academy：streak + levels 的组合方式](https://support.khanacademy.org/hc/en-us/articles/360054115071-What-are-Streaks-and-Course-Levels)
- [Forest：通过可累计视觉成果制造投入感与 loss aversion](https://www.forestapp.cc/)
