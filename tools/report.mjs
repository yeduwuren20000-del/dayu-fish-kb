// 生成一份人看的体检报告：reports/status.md
// 定时任务每次跑完都会覆盖它，方便直接看仓库现在什么状态。
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/cli.mjs";
import { loadConfig, loadTaxonomy, loadCatalog, loadOptimized, buildIndex } from "../lib/kb.mjs";

const cfg = loadConfig(ROOT);
const taxo = loadTaxonomy(ROOT, cfg);
const entries = loadCatalog(ROOT, cfg);
const optMap = loadOptimized(ROOT, cfg);
const index = buildIndex(entries, taxo, optMap);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
const tin = [...optMap.values()].reduce((s, r) => s + (r.srcBytes || 0), 0);
const tout = [...optMap.values()].reduce((s, r) => s + (r.optBytes || 0), 0);
const saved = tin ? Math.round((1 - tout / tin) * 100) : 0;

// 每个场景收了几个 —— 合作方/自己都能立刻看出哪一轴还空
const sceneRows = (taxo.raw.dimensions.scene?.values || []).map((v) => {
  const ids = index.byTag[`scene:${v.id}`] || [];
  return `| ${v.label} | ${v.id} | ${ids.length} |`;
});

const heaviest = [...optMap.values()]
  .sort((a, b) => (b.optBytes || 0) - (a.optBytes || 0))
  .slice(0, 5)
  .map((r) => `| \`${r.id}\` | ${mb(r.srcBytes || 0)} | ${kb(r.optBytes || 0)} | ${r.width}x${r.height}${r.animated ? ` · ${r.frames}帧` : ""} |`);

const untaggedDraft = (() => {
  const p = path.join(ROOT, "manifest/catalog.draft.jsonl");
  if (!fs.existsSync(p)) return 0;
  // 只数「还没进 catalog 的草稿」——已经 tag 收录的草稿不算未打标
  const known = new Set(Object.keys(index.byId || {}));
  return fs
    .readFileSync(p, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l).id;
      } catch {
        return null;
      }
    })
    .filter((id) => id && !known.has(id)).length;
})();

const md = `# 大肥鱼配图知识库 · 体检报告

> 生成时间：${new Date().toISOString()}　｜　自动生成，请勿手改（改 \`tools/report.mjs\`）

## 总量

- 条目 **${index.count}**（local ${index.local} / remote ${index.remote}）
- 已打标 ${index.count - index.untagged.length}，未打标 ${index.untagged.length}
- 标签桶 ${Object.keys(index.byTag).length}，词表外标签 ${index.unknownTags.length}
- 优化版 ${optMap.size} 条：${mb(tin)} → ${mb(tout)}，**省 ${saved}%**
- sha256 重复 ${index.duplicates.length} 组${index.duplicates.length ? `：${index.duplicates.map((g) => g.join(" = ")).join("; ")}` : ""}
- 草稿里还没打标的：${untaggedDraft}

## 最重的 5 张（优化后）

| 条目 | 原图 | 优化后 | 尺寸 |
| --- | --- | --- | --- |
${heaviest.join("\n")}

## 各场景覆盖

| 场景 | id | 张数 |
| --- | --- | --- |
${sceneRows.join("\n")}

## 词表外标签（要修）

${index.unknownTags.length ? index.unknownTags.map((u) => `- \`${u.id}\` → \`${u.tag}\``).join("\n") : "无"}
`;

const dir = path.join(ROOT, "reports");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "status.md"), md);
console.log(`✓ 报告已生成 → reports/status.md（${index.count} 条，优化省 ${saved}%）`);
