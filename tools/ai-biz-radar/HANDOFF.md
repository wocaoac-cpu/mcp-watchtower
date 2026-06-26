# 🌙 睡前交接 · AI 赚钱雷达

> 给 wocaoac@gmail.com 的总结。环境里没有发邮件的工具，所以存成这份文档，醒了直接看。
> 所有代码已永久保存在 GitHub PR #1（容器回收也不会丢）。

## 一、做好了什么

一个 **每小时自动深挖 3 个"最赚钱 / 最可落地的 AI 生意"、多阶段验证 + 去重、推送 Telegram** 的机器人。

- **引擎**：Google Gemini 免费额度（自带联网搜索）→ **0 花费**
- **调度**：GitHub Actions 定时（`cron: 23 * * * *`，每小时）→ 不依赖任何人在线
- **PR**：https://github.com/wocaoac-cpu/mcp-watchtower/pull/1 （草稿）

### 流水线
① 生成候选池(6个) → ② 对抗式联网验证打分 → ③ 复合评分排序筛选(毙掉低置信) → ④ 信源真实性核查(挡假链接) → ⑤ Telegram 推送 → ⑥ 归档 archive.md → ⑦ 失败告警

### 每条推送包含
目标客户 / 赚钱逻辑 / 市场信号 / 收费模式 / 市场规模 / 落地步骤 / 获客 / 所需技能 / 启动成本 / 回款周期 / 护城河 / 为什么是现在 / 风险 / 盈利·可行·新颖评分 / 置信度 / 带验证标记的信源

## 二、醒来要做的 3 步（约 5 分钟，全在 README.md 里）

1. **拿 Gemini key**：https://aistudio.google.com/apikey （免费，不要卡）
2. **建 Telegram bot**：找 @BotFather 发 `/newbot`，拿到 bot token；给 bot 发条消息，再访问
   `https://api.telegram.org/bot<TOKEN>/getUpdates` 取 chat id
3. **填 Secrets**：仓库 Settings → Secrets and variables → Actions，加 3 个：
   `GEMINI_API_KEY`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`
   然后 Actions → AI Biz Radar → Run workflow 测试

> ⚠️ 密钥只填 Secrets，别贴聊天/代码里。

## 三、下一步可选升级（你睡前聊到的，待你拍板）

**多提供商自动故障转移**——免费羊毛不止 Gemini，可轮着薅，基本永不断供：

| 提供商 | 免费额度 | 是否自带联网 | 角色 |
|---|---|---|---|
| Google Gemini | ~1500 次/天 | ✅ 是 | 调研主力（不可替代）|
| Cerebras | 100万 token/天 | ❌ | 验证/推理（超快超量）|
| Groq | ~1000 次/天 | ❌ | 兜底（OpenAI 兼容）|
| OpenRouter | ~50 次/天 | ❌ | 一键多模型备用 |
| GitHub Models | 50~150 次/天 | ❌ | 蹭 GPT-4o/o3/Grok |
| Mistral | ~10亿 token/月 | ❌ | 量大（需勾选数据可训练）|

关键点：**只有 Gemini 免费带联网搜索**，所以它当"扒数据"的主力；其他几家接"纯推理验证"的活或当兜底。
想做的话，我把 `radar.mjs` 改成 Gemini + Cerebras + Groq 三家自动切换。

## 四、提醒（诚实说）

- 产出是"经联网调研 + 验证的建议"，**不是赚钱保证**，落地自行判断。
- 免费档普遍会拿数据训练（调研内容不敏感，问题不大）。
- Google 免费额度不保证永久；多家兜底才最稳。

## 五、文件清单

| 文件 | 作用 |
|---|---|
| `.github/workflows/ai-biz-radar.yml` | 每小时定时 + 手动触发 |
| `tools/ai-biz-radar/radar.mjs` | 主逻辑（多阶段流水线，无第三方依赖）|
| `tools/ai-biz-radar/history.json` | 去重历史 |
| `tools/ai-biz-radar/archive.md` | 每轮归档 |
| `tools/ai-biz-radar/README.md` | 配置指引 |
| `tools/ai-biz-radar/HANDOFF.md` | 本文档 |

晚安 😴
