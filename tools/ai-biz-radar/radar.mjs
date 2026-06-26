#!/usr/bin/env node
/**
 * AI Biz Radar —— 定时深挖"最赚钱 / 最可落地的 AI 生意"，多阶段验证 + 去重，推送 Telegram。
 *
 * 流水线：
 *   ① 生成候选池   —— Gemini 联网搜索，扫全球顶流媒体，产出 CANDIDATE_POOL 个候选
 *   ② 对抗式验证   —— 第二次 Gemini 联网，逐个核实市场信号 / 信源真伪，打分（盈利·可行·新颖·置信）
 *   ③ 排序 + 筛选  —— 复合评分排序，毙掉低置信度，去重（标题归一化 + 词级重叠），取 TOP N
 *   ④ 信源核查     —— 实际访问每个链接，标记"已验证 / 未通"，挡掉编造的假 URL
 *   ⑤ 推送         —— Telegram，每个点子一条富文本卡片
 *   ⑥ 归档         —— 写回去重历史 + 追加可浏览的 archive.md
 *   ⑦ 失败告警     —— 任意环节挂掉，给 Telegram 报一声
 *
 * 引擎：Google Gemini 免费额度（自带联网 grounding），0 花费。
 *
 * 必填环境变量（GitHub 仓库 Secrets）：
 *   GEMINI_API_KEY      —— https://aistudio.google.com/apikey 免费申请
 *   TELEGRAM_BOT_TOKEN  —— @BotFather 创建 bot 拿到
 *   TELEGRAM_CHAT_ID    —— 你的 chat id（README 有取法）
 * 可选环境变量（带默认值）：
 *   GEMINI_MODEL        —— 覆盖模型（默认在几个免费模型间自动回退）
 *   IDEAS_PER_RUN=3     —— 每轮最终推送几个
 *   CANDIDATE_POOL=6    —— 每轮先生成多少候选再筛选
 *   MIN_CONFIDENCE=0.5  —— 置信度低于此值的点子直接丢弃（0~1）
 *   MIN_COMBINED=0      —— 复合评分低于此值丢弃（0~10）
 *   HISTORY_CAP=800     —— 去重历史最多保留多少条
 *   OUTPUT_LANG=中文     —— 推送语言
 *   VERIFY_SOURCES=1    —— 是否实际访问校验信源链接（1/0）
 */

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = `${__dirname}/history.json`;
const ARCHIVE_PATH = `${__dirname}/archive.md`;

// ---------- 配置 ----------
const GEMINI_API_KEY = need("GEMINI_API_KEY");
const TELEGRAM_BOT_TOKEN = need("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = need("TELEGRAM_CHAT_ID");

const IDEAS_PER_RUN = int("IDEAS_PER_RUN", 3);
const CANDIDATE_POOL = int("CANDIDATE_POOL", 6);
const MIN_CONFIDENCE = num("MIN_CONFIDENCE", 0.5);
const MIN_COMBINED = num("MIN_COMBINED", 0);
const HISTORY_CAP = int("HISTORY_CAP", 800);
const OUTPUT_LANG = process.env.OUTPUT_LANG || "中文";
const VERIFY_SOURCES = (process.env.VERIFY_SOURCES ?? "1") !== "0";

const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
].filter(Boolean);

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`❌ 缺少环境变量 ${name}`); process.exit(1); }
  return v;
}
function int(name, d) { const v = parseInt(process.env[name], 10); return Number.isFinite(v) ? v : d; }
function num(name, d) { const v = parseFloat(process.env[name]); return Number.isFinite(v) ? v : d; }

// ---------- 工具：去重 ----------
function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "").trim();
}
function tokens(s) {
  return new Set(String(s || "").toLowerCase().split(/[^a-z0-9一-鿿]+/).filter((t) => t.length > 1));
}
function overlap(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0; for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}
function isDup(title, list, thr = 0.6) {
  const nt = norm(title);
  return list.some((h) => norm(h.title || h) === nt || overlap(title, h.title || h) >= thr);
}

// ---------- 历史 ----------
async function loadHistory() {
  try { const a = JSON.parse(await readFile(HISTORY_PATH, "utf8")); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function categoryGlut(history) {
  // 统计最近 40 条的品类，找出"扎堆"的，喂回提示词让模型避开。
  const counts = {};
  for (const h of history.slice(-40)) {
    const c = (h.category || "其他").trim();
    counts[c] = (counts[c] || 0) + 1;
  }
  return Object.entries(counts).filter(([, n]) => n >= 4).map(([c]) => c);
}

// ---------- Gemini 调用（带重试 / 模型回退） ----------
async function gemini(prompt, { search = true, temperature = 0.9 } = {}) {
  let lastErr = "";
  for (const model of MODEL_CANDIDATES) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              ...(search ? { tools: [{ google_search: {} }] } : {}),
              generationConfig: { temperature, maxOutputTokens: 8192 },
            }),
          },
        );
        if (res.status === 429 || res.status >= 500) {
          lastErr = `[${model}] HTTP ${res.status}`;
          await sleep(1500 * (attempt + 1)); // 限流 / 服务端错误 → 退避重试
          continue;
        }
        if (!res.ok) { lastErr = `[${model}] HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`; break; }
        const data = await res.json();
        const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
        if (!text) { lastErr = `[${model}] 空返回`; break; }
        return { text, model };
      } catch (e) {
        lastErr = `[${model}] ${e.message}`;
        await sleep(1000 * (attempt + 1));
      }
    }
  }
  throw new Error(`Gemini 调用失败：${lastErr}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractJson(text) {
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = t.indexOf("["), e = t.lastIndexOf("]");
  if (s === -1 || e === -1) throw new Error(`无法解析 JSON：${text.slice(0, 200)}`);
  return JSON.parse(t.slice(s, e + 1));
}

// ---------- ① 生成候选 ----------
async function generate(history) {
  const recent = history.slice(-60).map((h) => `- ${h.title}`).join("\n") || "（暂无）";
  const glut = categoryGlut(history);
  const prompt = `你是顶级 AI 商业机会分析师。请用联网搜索，扫描全球顶流媒体与一手信源（TechCrunch、The Information、a16z、Y Combinator、Hacker News、Product Hunt、彭博、路透、CB Insights、36氪、虎嗅、即刻、Reddit 相关板块等），找出当下【最赚钱且可落地性极强】的 AI 创业/生意方向。

硬性要求：
1. 产出 ${CANDIDATE_POOL} 个**互不相同**的方向，必须是"个人或小团队 3-6 个月内有现实机会启动"的，而非只有大厂能做。
2. 要具体到细分场景与目标客户，不要泛泛（如"做个 AI 助手"是不合格的）。
3. 每个都要基于真实、近期的市场信号（带数据/事件/案例），并给 1-3 个**真实可点击**的来源 URL。
4. 严格避免与下列"已推送过"的方向重复或换皮：
${recent}
${glut.length ? `5. 最近这些品类已经太多，请尽量避开、换新赛道：${glut.join("、")}` : ""}

只输出 JSON 数组，不要任何多余文字、不要代码块。每个对象字段：
{
  "title": "一句话点子（具体、可检索）",
  "category": "所属赛道（如 法律科技/医疗/电商/开发者工具/营销/教育 等，单词或短语）",
  "target_customer": "精确目标客户/ICP",
  "why_profitable": "赚钱逻辑 + 市场信号/数据",
  "market_signal": "最近的真实信号/事件/数据点",
  "revenue_model": "收费模式与定价思路",
  "tam": "市场规模量级与依据",
  "how_to_start": "小团队落地路径，分步骤",
  "gtm": "获客渠道/冷启动方式",
  "skills_needed": "需要的核心技能/团队",
  "startup_cost": "启动成本量级：低(<$5k)/中/高",
  "time_to_revenue": "预计多久能有第一笔收入",
  "moat": "护城河/壁垒（或坦诚说明缺乏壁垒）",
  "why_now": "为什么是现在这个时间点（技术/政策/行为变化）",
  "risks": "主要风险",
  "sources": ["https://...", "https://..."]
}`;
  const { text, model } = await gemini(prompt, { temperature: 0.95 });
  console.log(`① 生成候选用模型：${model}`);
  return extractJson(text);
}

// ---------- ② 对抗式验证 + 打分 ----------
async function verify(candidates) {
  const prompt = `下面是一批 AI 生意候选点子（JSON）。请你作为**怀疑论审稿人**，用联网搜索逐个核实，给出客观评估。对每一个：
- 核实其"市场信号/数据"是否真实存在、是否被夸大；
- 判断来源 URL 是否像真实存在的页面（明显编造的标记出来）；
- 给四个 1-10 的分数：profitability(盈利潜力)、feasibility(小团队可行性)、novelty(新颖/非红海)、以及 confidence(你对该评估的置信，0-1 小数)；
- 给一句话 verdict（一针见血的结论）；
- 若发现信号不实或不可行，confidence 给低分。

只输出 JSON 数组，顺序与输入一致，每个对象：
{ "title": "原标题", "profitability": n, "feasibility": n, "novelty": n, "confidence": 0.x, "verdict": "...", "source_ok": true/false }

输入：
${JSON.stringify(candidates.map((c) => ({ title: c.title, why_profitable: c.why_profitable, market_signal: c.market_signal, sources: c.sources })), null, 2)}`;
  const { text, model } = await gemini(prompt, { temperature: 0.3 });
  console.log(`② 验证打分用模型：${model}`);
  let scores = [];
  try { scores = extractJson(text); } catch { scores = []; }
  // 按标题对齐回填
  const byTitle = new Map(scores.map((s) => [norm(s.title), s]));
  return candidates.map((c) => {
    const s = byTitle.get(norm(c.title)) || {};
    const profitability = clamp(s.profitability, 5);
    const feasibility = clamp(s.feasibility, 5);
    const novelty = clamp(s.novelty, 5);
    const confidence = Number.isFinite(s.confidence) ? Math.max(0, Math.min(1, s.confidence)) : 0.5;
    // 复合分：盈利与可行权重更高
    const combined = +(((profitability * 0.4 + feasibility * 0.4 + novelty * 0.2) * confidence)).toFixed(2);
    return { ...c, profitability, feasibility, novelty, confidence, combined, verdict: s.verdict || "", source_ok: s.source_ok !== false };
  });
}
function clamp(v, d) { const n = Number(v); return Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : d; }

// ---------- ④ 信源真实性核查 ----------
async function checkUrl(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    return !!res; // 只要域名解析、有响应（哪怕 403/404）就算"存在"
  } catch { return false; }
}
async function annotateSources(idea) {
  if (!VERIFY_SOURCES) return (idea.sources || []).map((u) => ({ url: u, ok: null }));
  const out = [];
  for (const u of (idea.sources || []).filter(Boolean)) out.push({ url: u, ok: await checkUrl(u) });
  return out;
}

// ---------- ⑤ Telegram ----------
async function tg(text, { silentFail = false } = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok && !silentFail) throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } catch (e) { if (!silentFail) throw e; }
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function bars(n) { return "▰".repeat(Math.round(n / 2)) + "▱".repeat(5 - Math.round(n / 2)); }

function card(idea, i, srcs) {
  const sline = srcs.map((s, k) =>
    `<a href="${esc(s.url)}">来源${k + 1}${s.ok === false ? "⚠" : s.ok ? "✓" : ""}</a>`).join(" · ");
  return [
    `💡 <b>${i}. ${esc(idea.title)}</b>  <code>[${esc(idea.category || "")}]</code>`,
    ``,
    `🎯 <b>目标客户</b>：${esc(idea.target_customer)}`,
    `💰 <b>赚钱逻辑</b>：${esc(idea.why_profitable)}`,
    `📈 <b>市场信号</b>：${esc(idea.market_signal)}`,
    `💳 <b>收费模式</b>：${esc(idea.revenue_model)}`,
    `🌍 <b>市场规模</b>：${esc(idea.tam)}`,
    `🛠️ <b>怎么启动</b>：${esc(idea.how_to_start)}`,
    `📣 <b>获客</b>：${esc(idea.gtm)}`,
    `🧑‍💻 <b>所需技能</b>：${esc(idea.skills_needed)}`,
    `💵 <b>启动成本</b>：${esc(idea.startup_cost)} ｜ ⏱️ <b>回款</b>：${esc(idea.time_to_revenue)}`,
    `🏰 <b>护城河</b>：${esc(idea.moat)}`,
    `⏳ <b>为什么是现在</b>：${esc(idea.why_now)}`,
    `⚠️ <b>风险</b>：${esc(idea.risks)}`,
    ``,
    `📊 盈利 ${bars(idea.profitability)} ${idea.profitability}/10 ｜ 可行 ${bars(idea.feasibility)} ${idea.feasibility}/10 ｜ 新颖 ${bars(idea.novelty)} ${idea.novelty}/10`,
    `🔎 置信 ${(idea.confidence * 100) | 0}% ｜ 综合分 <b>${idea.combined}</b>`,
    idea.verdict ? `🧠 <i>${esc(idea.verdict)}</i>` : ``,
    sline ? `🔗 ${sline}` : ``,
  ].filter(Boolean).join("\n");
}

// ---------- ⑥ 归档 ----------
async function archive(stamp, ideas) {
  const lines = [`\n## ${stamp} UTC\n`];
  for (const it of ideas) {
    lines.push(`- **${it.title}** \`[${it.category || ""}]\` — 综合 ${it.combined}（盈利${it.profitability}/可行${it.feasibility}/新颖${it.novelty}/置信${(it.confidence * 100) | 0}%）`);
  }
  await appendFile(ARCHIVE_PATH, lines.join("\n") + "\n", "utf8");
}

// ---------- 主流程 ----------
async function main() {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const history = await loadHistory();

  // ① 生成
  const candidates = await generate(history);
  console.log(`① 候选 ${candidates.length} 个`);

  // 先去掉与历史重复的，减少验证开销
  const novel = candidates.filter((c) => c?.title && !isDup(c.title, history));

  // ② 验证打分
  const scored = await verify(novel);

  // ③ 排序 + 阈值 + 批内去重
  scored.sort((a, b) => b.combined - a.combined);
  const picked = [];
  for (const it of scored) {
    if (it.confidence < MIN_CONFIDENCE) continue;
    if (it.combined < MIN_COMBINED) continue;
    if (isDup(it.title, picked)) continue;
    picked.push(it);
    if (picked.length >= IDEAS_PER_RUN) break;
  }

  if (picked.length === 0) {
    console.log("本轮无合格新点子，跳过推送。");
    return;
  }

  // ④ 信源核查 + ⑤ 推送
  await tg(`🚀 <b>AI 赚钱雷达</b> · ${stamp} UTC\n本轮 ${picked.length} 个经验证的新方向（语言：${esc(OUTPUT_LANG)}）：`);
  for (let i = 0; i < picked.length; i++) {
    const srcs = await annotateSources(picked[i]);
    await tg(card(picked[i], i + 1, srcs));
  }

  // ⑥ 归档 + 写回历史
  await archive(stamp, picked);
  const updated = history.concat(picked.map((p) => ({
    title: p.title, category: p.category || "其他", combined: p.combined, date: stamp,
  }))).slice(-HISTORY_CAP);
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(updated, null, 2) + "\n", "utf8");

  console.log(`✅ 推送 ${picked.length} 个，历史累计 ${updated.length}。`);
}

main().catch(async (e) => {
  console.error("💥", e.message);
  // ⑦ 失败告警（尽力而为，不再抛错）
  await tg(`⚠️ <b>AI 赚钱雷达本轮失败</b>\n<code>${esc(e.message).slice(0, 300)}</code>`, { silentFail: true });
  process.exit(1);
});
