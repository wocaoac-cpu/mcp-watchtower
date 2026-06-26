#!/usr/bin/env node
// AI Biz Radar — 定时深挖"最赚钱 / 最可落地的 AI 生意"，去重后推送到 Telegram。
//
// 引擎用 Google Gemini 的免费额度（自带联网搜索 grounding）。
// 不需要付费 API；GitHub Actions 定时触发，全程 0 花费。
//
// 需要的环境变量（在 GitHub 仓库 Secrets 里配置）：
//   GEMINI_API_KEY      —— https://aistudio.google.com/apikey 免费申请
//   TELEGRAM_BOT_TOKEN  —— 找 @BotFather 创建 bot 拿到
//   TELEGRAM_CHAT_ID    —— 你的 chat id（给 bot 发条消息后用下方 README 的方法取）
// 可选：
//   GEMINI_MODEL        —— 覆盖默认模型（默认会自动在几个免费模型间回退）
//   IDEAS_PER_RUN       —— 每次产出几个点子（默认 3）

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = `${__dirname}/history.json`;

const GEMINI_API_KEY = need("GEMINI_API_KEY");
const TELEGRAM_BOT_TOKEN = need("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = need("TELEGRAM_CHAT_ID");
const IDEAS_PER_RUN = Number(process.env.IDEAS_PER_RUN || 3);

// 模型按顺序尝试，谁能用用谁（免费档模型 id 偶尔变动，这样更抗造）。
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
].filter(Boolean);

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ 缺少环境变量 ${name}`);
    process.exit(1);
  }
  return v;
}

// 标题归一化，用于去重（去标点/空格/大小写）。
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "")
    .trim();
}

// 词级重叠度，挡住"换个说法的同一个生意"。
function tokens(s) {
  return new Set(
    String(s || "")
      .toLowerCase()
      .split(/[^a-z0-9一-鿿]+/)
      .filter((t) => t.length > 1),
  );
}
function overlap(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

async function loadHistory() {
  try {
    const raw = await readFile(HISTORY_PATH, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function isDuplicate(idea, history) {
  const nt = norm(idea.title);
  for (const h of history) {
    if (norm(h.title) === nt) return true;
    if (overlap(idea.title, h.title) >= 0.6) return true;
  }
  return false;
}

function buildPrompt(history) {
  const recent = history
    .slice(-60)
    .map((h) => `- ${h.title}`)
    .join("\n");
  return `你是一名顶级的 AI 商业机会分析师。请联网检索全球顶流媒体、行业报告、投融资动态、产品社区（如 TechCrunch、The Information、a16z、Y Combinator、Hacker News、Product Hunt、彭博、路透、36氪、虎嗅等），找出当下【最赚钱且可落地性极强】的 AI 创业/生意方向。

要求：
1. 给出 ${IDEAS_PER_RUN} 个不同的方向，必须是"小团队/个人在 3-6 个月内有现实机会启动"的，而不是只有大厂能做的。
2. 每个方向都要经过你的"研究 + 验证"：说明赚钱逻辑、真实市场信号（最好带具体数据/案例）、落地路径、启动成本量级、主要风险。
3. 必须有依据，附上 1-3 个可点击的信息来源链接（真实 URL）。
4. 不要泛泛而谈（如"做个 AI 助手"），要具体到细分场景和目标客户。
5. 严格不要与下面这些"已经推送过"的方向重复或换皮：
${recent || "（暂无历史）"}

只输出一个 JSON 数组，不要任何额外文字、不要 markdown 代码块。格式：
[
  {
    "title": "一句话点子标题（具体、可检索）",
    "why_profitable": "为什么赚钱（赚钱逻辑 + 市场信号/数据）",
    "market_signal": "最近的真实信号/事件/数据点",
    "how_to_start": "小团队的落地路径，分步骤",
    "startup_cost": "启动成本量级，如 '低（<$5k）' / '中' / '高'",
    "risks": "主要风险",
    "feasibility": "可行性评分 1-10 及一句理由",
    "sources": ["https://...", "https://..."]
  }
]`;
}

async function callGemini(prompt) {
  let lastErr = "";
  for (const model of MODEL_CANDIDATES) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.95, maxOutputTokens: 8192 },
        }),
      });
      if (!res.ok) {
        lastErr = `[${model}] HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
        continue;
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || "").join("").trim();
      if (!text) {
        lastErr = `[${model}] 返回为空`;
        continue;
      }
      console.log(`✅ 使用模型: ${model}`);
      return text;
    } catch (e) {
      lastErr = `[${model}] ${e.message}`;
    }
  }
  throw new Error(`所有 Gemini 模型都调用失败：${lastErr}`);
}

function parseIdeas(text) {
  // 容错：剥掉可能的 ```json 围栏，抓第一个 [...] 块。
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error(`无法从输出里解析 JSON：${text.slice(0, 200)}`);
  const arr = JSON.parse(t.slice(start, end + 1));
  return Array.isArray(arr) ? arr : [];
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatIdea(idea, i) {
  const sources = (idea.sources || [])
    .filter(Boolean)
    .map((u, k) => `<a href="${esc(u)}">来源${k + 1}</a>`)
    .join(" · ");
  return [
    `💡 <b>${i}. ${esc(idea.title)}</b>`,
    ``,
    `💰 <b>赚钱逻辑</b>：${esc(idea.why_profitable)}`,
    `📈 <b>市场信号</b>：${esc(idea.market_signal)}`,
    `🛠️ <b>怎么启动</b>：${esc(idea.how_to_start)}`,
    `💵 <b>启动成本</b>：${esc(idea.startup_cost)}`,
    `⚠️ <b>风险</b>：${esc(idea.risks)}`,
    `✅ <b>可行性</b>：${esc(idea.feasibility)}`,
    sources ? `🔗 ${sources}` : ``,
  ].filter(Boolean).join("\n");
}

async function sendTelegram(html) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Telegram 推送失败 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

async function main() {
  const history = await loadHistory();
  const prompt = buildPrompt(history);

  const raw = await callGemini(prompt);
  const ideas = parseIdeas(raw);

  const fresh = [];
  for (const idea of ideas) {
    if (!idea?.title) continue;
    if (isDuplicate(idea, history) || fresh.some((f) => overlap(f.title, idea.title) >= 0.6)) continue;
    fresh.push(idea);
  }

  if (fresh.length === 0) {
    console.log("本轮没有产出新点子（可能都和历史重复了），跳过推送。");
    return;
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const header = `🚀 <b>AI 赚钱雷达</b> · ${stamp} UTC\n本轮 ${fresh.length} 个新方向：`;

  // 一条头 + 每个点子单独一条，避免超 Telegram 4096 字符上限。
  await sendTelegram(header);
  for (let i = 0; i < fresh.length; i++) {
    await sendTelegram(formatIdea(fresh[i], i + 1));
  }

  // 写回历史用于去重。
  const updated = history.concat(
    fresh.map((f) => ({ title: f.title, date: stamp })),
  );
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(updated, null, 2) + "\n", "utf8");
  console.log(`✅ 已推送 ${fresh.length} 个，历史累计 ${updated.length} 个。`);
}

main().catch((e) => {
  console.error("💥", e.message);
  process.exit(1);
});
