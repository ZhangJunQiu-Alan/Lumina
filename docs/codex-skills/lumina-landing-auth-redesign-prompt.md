# Lumina Landing/Auth Redesign Prompt

请在 `/Users/zhangjunqiu/Desktop/Lumina` 中执行一次完整的视觉与文案改版，目标是重新设计 Lumina 的 landing page、登录页、注册页。

必须使用并遵循这些 skill，按顺序加载：

1. `frontend-app-builder`
   - 作为主流程：完整 redesign、视觉概念、React/Vite 实现、浏览器验证。
   - 本地参考文件：`docs/codex-skills/frontend-app-builder/SKILL.md`
2. `frontend-skill`
   - 用于 landing page 的品牌首屏、视觉锚点、文案层级、动效节奏和页面结构判断。
3. `frontend-design`
   - 用于确定强视觉方向，避免普通模板化 SaaS 风格。
   - 本地参考文件：`docs/codex-skills/frontend-design/SKILL.md`
4. `enterprise-ux-review`
   - 用于登录/注册表单体验、状态设计、错误提示、可访问性、移动端可用性。
   - 本地参考文件：`docs/codex-skills/enterprise-ux-review/SKILL.md`
5. `react-best-practices`
   - 用于 React 组件拆分、状态组织和性能约束。
   - 本地参考文件：`docs/codex-skills/react-best-practices/SKILL.md`
6. `frontend-testing-debugging` + `browser:browser`
   - 用于本地浏览器验证、截图、console 检查、桌面/移动端 QA。
   - 本地参考文件：
     - `docs/codex-skills/frontend-testing-debugging/SKILL.md`
     - `docs/codex-skills/browser/SKILL.md`

项目风格约束：

- 当前项目已经使用 `animal-island-ui`，这是一套参考动物森友会风格的 React UI 组件库。
- 必须优先读取：
  - `node_modules/animal-island-ui/README.md`
  - `src/components/shared/AnimalPrimitives.tsx`
  - `src/components/landing/LandingView.tsx`
  - `src/components/auth/AuthView.tsx`
  - `src/index.css`
  - `src/RootApp.tsx`
- 优先复用已有封装：`IslandButton`、`IslandPanel`、`IslandCard`、`IslandInput`、`IslandBadge`、`IslandIconButton`、`IslandModalShell`。
- 不要直接使用任何任天堂官方素材、角色、图标、商标或名称。只能延续“温暖、岛屿、圆润、轻游戏化、学习旅程”的原创视觉方向。
- 页面要适合 Lumina：英语词汇学习、每日复习、官方词库、AI 词条增强、四段式学习、长期记忆。

设计目标：

- Landing page：从“功能介绍页”升级成一个有记忆点的产品入口。首屏要清楚表达 Lumina 是一个状态驱动的英语词汇学习系统，并有明确进入学习/登录注册 CTA。
- 登录页：更轻、更可信、更顺畅，保留邮箱登录、注册切换、Google 登录开关逻辑、错误状态和加载状态。
- 注册页：强化“开始学习旅程”的动机，但不要营销话术过重；减少用户犹豫，解释注册后能获得什么。
- 文案要全部重写或精修。要求具体、简短、有产品感，不要写设计说明，不要出现 prompt 痕迹。

推荐视觉方向：

- Visual thesis：像一张温暖的学习岛屿地图，圆润、轻盈、带一点游戏 UI 的反馈感，但保持英语学习产品的可信度。
- Landing 首屏应有一个强视觉锚点，例如岛屿地图、学习路径、星轨/记忆状态、词汇旅程场景；如果需要 bitmap 资产，可使用 `imagegen` 生成原创插图，并保存到项目内。
- 不要做通用 SaaS 卡片堆砌、紫色渐变模板、复杂 dashboard hero、过多 badge/pill。
- 保持移动端优先：首屏、表单、CTA、输入框在手机上要清晰可点。

实现要求：

- 使用当前 React/Vite/Tailwind 结构，不引入不必要的新框架。
- 保持现有路由和认证逻辑，不破坏登录、注册、Google 登录、重置密码、错误处理。
- 如果重构组件，保持改动集中在 landing/auth 相关文件和必要共享样式中。
- 保证桌面和移动端文本不重叠、不溢出、不被背景遮挡。
- 控件状态必须完整：loading、disabled、error、success/confirmation、mode switch。
- 动效要轻、有目的，尊重 `prefers-reduced-motion`。

工作流程：

1. 先读取上述 skill 文件和项目相关文件，给出一个简短执行计划。
2. 提炼当前 landing/auth 的信息架构和必须保留的行为。
3. 形成视觉系统：颜色、字体、圆角、阴影、岛屿/地图/路径元素、按钮和输入框规则。
4. 设计并实现 landing page、login mode、register mode。
5. 更新文案，确保中英文风格统一。如果当前页面主要是英文，则保持英文为主；如产品已有中文语境，优先中文。
6. 运行类型检查/构建，例如 `npm run lint` 和 `npm run build`。
7. 启动本地服务，使用 Browser 插件验证：
   - `http://localhost:3000/`
   - `/auth` 登录模式
   - `/auth` 注册模式
   - 桌面视口
   - 手机视口
   - console errors/warnings
   - CTA 和登录/注册切换交互
8. 最终汇报：
   - 改了哪些页面和文件
   - 新视觉方向
   - 新文案策略
   - 保留了哪些认证行为
   - 运行了哪些检查
   - 浏览器验证结果和剩余风险

请直接执行实现，不要停留在建议层面。除非遇到会破坏认证逻辑、需要外部密钥、或需要我选择视觉方案的重大分歧，否则自行做保守决策并完成端到端验证。
