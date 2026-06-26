# AI Biz Radar 🚀

每 6 小时自动深挖 **3 个"最赚钱 / 最可落地的 AI 生意"**，去重后推送到你的 Telegram。

- **引擎**：Google Gemini 免费额度（自带联网搜索），**0 花费**
- **调度**：GitHub Actions 定时任务，不依赖任何人在线
- **去重**：`history.json` 记录已推送方向，标题归一化 + 词级重叠双重比对

## 一次性配置（约 5 分钟）

### 1. 申请 Gemini 免费 API Key
打开 <https://aistudio.google.com/apikey> → "Create API key"。免费档约 1500 次/天，本机器人一天才 4 次，绰绰有余，不要信用卡。

### 2. 创建 Telegram Bot
1. 在 Telegram 找 **@BotFather** → 发 `/newbot` → 按提示拿到 **bot token**。
2. 给你刚建的 bot 随便发一条消息（必须先发，否则拿不到 chat_id）。
3. 浏览器打开（把 `<TOKEN>` 换成你的）：
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   返回 JSON 里 `"chat":{"id": 123456789}` 那个数字就是你的 **chat_id**。

### 3. 在 GitHub 仓库加 3 个 Secret
仓库 → **Settings → Secrets and variables → Actions → New repository secret**，分别添加：

| Name | Value |
|------|-------|
| `GEMINI_API_KEY` | 第 1 步拿到的 key |
| `TELEGRAM_BOT_TOKEN` | 第 2 步的 bot token |
| `TELEGRAM_CHAT_ID` | 第 2 步的 chat id |

> ⚠️ 这些是密钥，**只填到 Secrets 里，不要写进代码或聊天**。

### 4. 立即测试
仓库 → **Actions → AI Biz Radar → Run workflow**。几十秒后 Telegram 就该收到推送。之后它会每 6 小时自动跑。

## 调参

- 改频率：编辑 `.github/workflows/ai-biz-radar.yml` 里的 `cron`
  （`0 */6 * * *` = 每6小时；`0 */3 * * *` = 每3小时；`0 9 * * *` = 每天9点UTC）。
- 改每轮数量 / 模型：在 workflow 的 `env` 里设 `IDEAS_PER_RUN`、`GEMINI_MODEL`。

## 想换成 Claude（更高质量，但付费）

把 `radar.mjs` 里的 `callGemini` 换成 Anthropic API 调用、`GEMINI_API_KEY` 换成 `ANTHROPIC_API_KEY` 即可。注意 Claude API 按量付费，没有免费额度。

## 注意

- Google 免费额度的限制可能随时调整，不保证永久。
- 产出是"经联网调研 + 可行性评估的建议"，不是赚钱保证，落地请自行判断。
