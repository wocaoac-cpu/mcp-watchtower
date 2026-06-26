# AI Biz Radar 🚀

每小时自动深挖 **3 个经过验证的"最赚钱 / 最可落地的 AI 生意"**，去重后推送到你的 Telegram。

- **引擎**：Google Gemini 免费额度（自带联网搜索），**0 花费**
- **调度**：GitHub Actions 定时任务（默认每小时），不依赖任何人在线
- **多阶段流水线**：① 生成候选池 → ② 对抗式联网验证打分 → ③ 复合评分排序筛选 → ④ 信源真实性核查 → ⑤ 推送 → ⑥ 归档
- **去重**：`history.json` 标题归一化 + 词级重叠双重比对，并按品类防扎堆
- **失败告警**：任意环节挂掉会给 Telegram 报一声

每条推送包含：目标客户 / 赚钱逻辑 / 市场信号 / 收费模式 / 市场规模 / 落地步骤 / 获客 / 所需技能 / 启动成本 / 回款周期 / 护城河 / 为什么是现在 / 风险 / 盈利·可行·新颖评分 / 置信度 / 信源（带 ✓已验证 标记）。

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
  （`23 * * * *` = 每小时；`0 */6 * * *` = 每6小时；`0 9 * * *` = 每天9点UTC）。
- workflow 的 `env` 可调：`IDEAS_PER_RUN`(每轮推几个) / `CANDIDATE_POOL`(候选池大小) /
  `MIN_CONFIDENCE`(置信度门槛) / `GEMINI_MODEL` / `OUTPUT_LANG` / `VERIFY_SOURCES`。

> 免费额度够不够？Gemini 免费档约 **1500 次请求/天**，每小时一轮、每轮约 2-3 次调用 ≈ 70 次/天，远没到上限，可放心每小时跑。

## 想换成 Claude（更高质量，但付费）

把 `radar.mjs` 里的 `callGemini` 换成 Anthropic API 调用、`GEMINI_API_KEY` 换成 `ANTHROPIC_API_KEY` 即可。注意 Claude API 按量付费，没有免费额度。

## 注意

- Google 免费额度的限制可能随时调整，不保证永久。
- 产出是"经联网调研 + 可行性评估的建议"，不是赚钱保证，落地请自行判断。
