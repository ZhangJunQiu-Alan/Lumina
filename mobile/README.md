# Lumina Android

使用 Capacitor 8 复用现有网站，在 APK 内打包页面、脚本和字体；后端仍使用现有 Supabase。原有根目录 `android/` 原生项目未修改。本工程位于 `mobile/android/`，包名 `college.lumina.mobile`。

## 安装与升级

发布包：`mobile/releases/Lumina-1.0.3-release.apk`（versionCode 3），旁边的 `.sha256` 文件用于校验传输完整性。

将 APK 发给朋友，在手机上允许该文件来源安装应用。后续直接打开新版 APK 覆盖安装，**不要先卸载**。卸载、清除应用数据或丢失手机会删除尚未同步的数据；APK 升级不能恢复这些数据。

最低 Android 7（API 24），需要 Android System WebView / Chrome 111 或更新版本。旧 WebView 会显示升级提示。首次登录、新题目、AI 服务和未缓存的音频需要联网。

新包名与旧原生项目不同，两者可共存；旧原生 App 的本地数据不会自动搬入新包，已有云端账号仍可登录。

## 数据恢复范围

- 学习和复习答案先写入本机，再发往后端；账号之间的待同步数据独立保存。
- 学习队列、轮次、复习追加词、当前输入草稿和上次页面支持恢复。
- 已加载的 IELTS 答题草稿可以恢复；缓存最近两份试卷详情。答卷提交后冻结内容，网络恢复后自动重试；服务端按同一轮考试去重。
- 学习轮次和每日任务完成记录进入持久化队列；隔天同步仍使用原学习日期。
- 听力播放位置在暂停、退后台和定期检查点保存；重新打开后手动继续播放，不在后台持续播放。
- 在线、回到前台、每 30 秒以及手动点击重试时同步。存储空间不足会明确提示，不会把写入失败显示为已保存。

这不是全量离线下载：未打开的课程/试卷、AI 生成、首次获取音频仍需网络。本机存储采用 WebView 持久化存储；没有跨设备离线备份，应用备份已禁用以避免学习数据和会话被系统备份复制。请注意同步提示。

保持网站现有功能开关：IELTS 听力当前仍关闭；现有 Google 登录适配器尚未迁移，首版使用邮箱密码登录。没有开启已关闭的听力服务，也没有修改音频存储桶。

## 构建

需要 Node.js 22+、Java 21、Android SDK 36。默认使用这台 Mac 的 Android Studio Java 和 `~/Library/Android/sdk`，其他位置分别通过 `LUMINA_ANDROID_JAVA_HOME`、`ANDROID_HOME` 配置。

```sh
npm ci
cp mobile/env.example .env.mobile.local
# 填写公开的 API 地址、Supabase URL 和 publishable key；不要填写 service role key。
npm run android:build
```

本机 `.env.mobile.local` 已配置现有生产服务。构建脚本执行类型检查、Web 构建、Capacitor 同步、Android release 编译、Android lint、签名校验，并生成 APK 和 SHA-256。发布构建启用代码压缩、资源裁剪，禁止明文 HTTP 和 WebView 混合内容。

```sh
npm run typecheck
npx vitest run --maxWorkers=2
npm run test:core
npm run test:ielts
npm run lint
```

限制测试并发可避免模拟器同时运行时的资源争用。调试构建：`npm run android:debug`，不要对外分发 debug 或 androidTest APK。

## 签名：必须备份

本机已经生成发布密钥，**不要重新生成**：

- 密钥：`~/.config/lumina-signing/lumina-mobile-release.jks`
- 密钥路径、别名和密码：`mobile/signing.local.properties`

请将这两个文件一起存入你控制的加密备份或密码管理器，保留第二份离线备份。它们均不进入 Git，也不应发给安装用户。丢失密钥后无法继续用同一身份覆盖升级。只有首次建立全新的应用签名时才使用 `npm run android:signing:init`；脚本拒绝覆盖已有密钥。

后续发布修改 `mobile/release.json`，同时提高 `versionCode` 和可读的 `versionName`，再运行构建。始终保持同一包名和同一签名。debug 在本机存在发布签名配置时使用同一密钥，仅用于覆盖安装自动化验证。

## 后端配套

- 当前 API 已增加 `https://localhost` 精确 CORS 来源，网站来源仍保留，未授权来源继续拒绝。
- 已应用 `supabase/migrations/20260828000000_mobile_ielts_retry_safety.sql`，使阅读/听力提交在重试时返回同一 attempt ID。数据库验证使用回滚事务，未保留考试测试记录。
- 网站与 API 已发布最新词库及复习修复（前端提交 `bf04e01`，API v47）；1.0.2 APK 包含同一版前端代码。

## 验证记录（2026-09-16，1.0.2）

- 包含网站文案优化、个人词库任意数量手动选词、单词发音、未完成学习组入口，以及词库清理和复习状态修复。
- 对应网站版本的 CI 已通过 214 项单元测试；本次 Android 构建通过 TypeScript、release 编译和 Android lint。
- APK 保持原包名与签名，versionCode 从 1 升至 2；v2 签名校验通过，无调试标志，禁止明文 HTTP 和系统备份。包内未发现服务端密钥、测试凭证或 source map；原生来源 API 健康与 CORS 检查通过。
- Android 16 模拟器：从旧包 `Lumina-1.0.1.apk`（包内实际版本 1.0.0 / code 1）直接覆盖至 1.0.2 / code 2，新版页面正常渲染，升级前的测试存储标记和存储草稿均保留。升级前已单独验证旧版重启后数据保留。
- 初次测试立即结束写入进程，未保留测试标记；测试准备步骤增加后台落盘等待后，重启与覆盖升级检查通过。本轮未重跑登录后的完整业务流程或实体手机测试。

## 历史验证记录（2026-08-28）

- TypeScript、ESLint、157 项单元测试、核心业务脚本和 IELTS 评分脚本通过。
- Android 16 / 2 GB 内存模拟器：原生本地资源加载、活动重建后的存储保留、登录后的主要路由、复习队列与输入草稿恢复通过。
- 生产 API：原生来源邮箱密码登录、会话与首页接口通过；CORS 正反例通过；两种 IELTS 提交的数据库幂等性通过。
- Wi-Fi 与移动数据均关闭：原生网络状态与 WebView 离线标识一致，活动重建后复习位置和输入草稿保留。
- 签名发布 APK：v2/RSA-3072 校验通过；release 无调试标志，禁止明文 HTTP 与系统备份；包内未发现服务端密钥、测试凭证或 source map。
- 覆盖安装：调试版上保存数据后，用相同签名的 release APK 覆盖安装。直接在压缩后的 release 中确认页面正常渲染、旧存储标记及复习输入草稿均保留。

本版本适合个人和朋友小范围试用。尚未验证实体低端手机、最低系统版本、所有厂商后台回收行为和每一项完整业务流程，不能据此宣称所有机型都流畅。下一步优先在一台真实低端手机做学习、来电/后台中断、断网重连和 APK 升级测试。

2026-09-16 发布检查：依赖审计未发现漏洞。不要使用 `npm audit fix --force` 自动降级 Capacitor。

Android 自动化源码：`mobile/android/app/src/androidTest/java/college/lumina/mobile/MobileSmokeTest.java`。登录恢复测试需要本地临时 `androidTest/assets/private-session.json`，该文件被忽略且不会进入 release；交付时测试账号和凭证已清理。凭证必须是未过期的临时会话，未配置凭证时只运行无登录测试。断网恢复检查传 `expectOffline=true`，执行前关闭模拟器 Wi-Fi 和移动数据，结束后恢复。

压缩后的 release 使用独立的 `ReleaseSmokeInstrumentation.java`，避免 AndroidX 调试测试运行器与 R8 的类名冲突。保留模拟器里的预置升级标记和草稿，先覆盖安装 release，然后构建并安装测试 APK（不会修改 release）：

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' mobile/android/gradlew -p mobile/android :app:assembleDebugAndroidTest -PluminaReleaseSmoke=true
adb install -r mobile/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w college.lumina.mobile.test/college.lumina.mobile.ReleaseSmokeInstrumentation
```

成功输出必须包含 `PASS: minified signed release rendered`，不能仅凭 adb 命令退出码判断测试通过。

无登录会话时，可用独立的测试标记和存储草稿检查覆盖升级。安装测试 APK 后，在旧应用上准备数据，再覆盖安装新版并验证；两次传入相同标记：

```sh
adb shell am instrument -w -e prepareUpgrade lumina-1.0.2-bf04e01 college.lumina.mobile.test/college.lumina.mobile.ReleaseSmokeInstrumentation
adb shell am instrument -w -e verifyUpgrade lumina-1.0.2-bf04e01 college.lumina.mobile.test/college.lumina.mobile.ReleaseSmokeInstrumentation
adb install -r mobile/releases/Lumina-1.0.2-release.apk
adb shell am instrument -w -e verifyUpgrade lumina-1.0.2-bf04e01 college.lumina.mobile.test/college.lumina.mobile.ReleaseSmokeInstrumentation
```

该模式验证原生页面渲染和存储保留，不验证登录后的复习输入恢复。
