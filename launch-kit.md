# 发布工具包 · LAUNCH KIT

> 目标：让 0002 产生价值。路径 = 开源仓库（信任+引流）→ GitHub Pages（免费托管站点+徽章 URL）→ Show HN / r/mcp / X（流量）→ 徽章生态（自传播）→ 团队版 waitlist（变现）。
> 唯一人工前置：跑一次 `gh auth login`（账号 wocaoac-cpu 的 token 已失效）。完成后对 Claude 说「发布哨塔」即可全自动执行下面的发布清单。

## 一、发布清单（Claude 自动执行）

```powershell
# 1. 创建公开仓库并推送（在 0002-mcp-watchtower 目录）
gh repo create mcp-watchtower --public --source . --push
# 2. 开 GitHub Pages（serve 根目录，site/ 内是站点）
gh api repos/{owner}/mcp-watchtower/pages -X POST -f "source[branch]=master" -f "source[path]=/"
# 3. 把站点徽章 URL 里的 USERNAME 替换为真实用户名后重新提交推送
```

发布后地址：`https://<用户名>.github.io/mcp-watchtower/site/`，徽章：`.../data/badges/owner__repo.svg`

## 二、Show HN 发布贴（流量主战场）

**标题：** Show HN: I scanned 2,636 MCP servers – here's the graveyard

**正文：**
Recent audits suggested ~half of public MCP servers are abandoned, but registries still list dead servers next to live ones with equal weight. So I built Watchtower: it pulls every server from the community lists, scores each repo on push recency + maintenance hygiene (formula is public and debatable), and publishes a leaderboard, a graveyard, and a live health badge per server.

Scanner is ~200 lines of dependency-free Node, MIT licensed. Data regenerates hourly. I'd love feedback on the scoring weights — recency dominates at 70% because audit medians showed dead servers sitting ~142 days since last commit.

**发布时机：** 美东工作日早上 8–10 点（北京 20–22 点）。

## 三、r/mcp + r/ClaudeAI 发布贴

**标题：** I built a health checker for MCP servers — half the ecosystem might be dead

**正文要点：** 个人故事开头（装了个 server 连不上 → 发现它 8 个月没更新）→ 数据（扫描结果）→ 工具链接 → 求反馈评分公式。不要营销腔。

## 四、X / Twitter 线程

1/ Installed an MCP server last week. Broken. Last commit: 8 months ago. The registry never told me. So I checked the whole ecosystem…
2/ [扫描数据截图] X% of scanned MCP servers are DEAD or GONE. Not "less popular" — abandoned.
3/ Built MCP Watchtower: live health score for every server. ALIVE / FADING / DEAD. Plus a README badge so maintainers can prove they're alive.
4/ Scanner is open source, zero deps, MIT. Scoring formula is public — fight me on the weights. [链接]

## 五、徽章生态（自传播引擎）

发布 1 周后：给排行榜 TOP 20 健康仓库的维护者发 PR/issue，附上他们的现成徽章 markdown。每个贴徽章的 README 都是一个反向链接 + 信任背书。

## 六、变现路线

| 阶段 | 动作 | 收入 |
|---|---|---|
| 第 1 周 | 全部免费，攒数据攒声量 | 0（攒势能） |
| 第 2–4 周 | 站点挂团队版 waitlist：私有 server 监控、依赖告警、审计报告 | 验证付费意愿 |
| 第 2 月 | 团队版 $19/月（GitHub Sponsors / Polar.sh 收款，个人可开） | 首批 MRR |
| 长期 | 审计 API 按量计费；注册表合作 | 评级机构卡位 |

## 七、风险与对策

- 注册表官方跟进做健康信号 → 拼速度 + 先把「MCP health」徽章心智占住
- GitHub API 限额 → 发布贴里直接求一个社区 token / GitHub App，这本身就是个互动钩子
- 评分公式被喷 → 公式全公开，喷=互动=传播，照单全收迭代
