// 构建索引：标签倒排 + 去重报告 + 覆盖率
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/cli.mjs";
import { loadConfig, loadTaxonomy, loadCatalog, loadOptimized, buildIndex } from "../lib/kb.mjs";

const cfg = loadConfig(ROOT);
const taxo = loadTaxonomy(ROOT, cfg);
const entries = loadCatalog(ROOT, cfg);
const optMap = loadOptimized(ROOT, cfg);
const index = buildIndex(entries, taxo, optMap);

const dir = path.join(ROOT, cfg.indexDir);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");

const tagCount = Object.keys(index.byTag).length;
console.log(`✓ 索引已生成 → ${path.relative(ROOT, path.join(dir, "index.json"))}`);
console.log(`  条目 ${index.count}（local ${index.local} / remote ${index.remote}）`);
console.log(`  标签桶 ${tagCount}，未打标 ${index.untagged.length}，词表外标签 ${index.unknownTags.length}`);
if (index.duplicates.length) {
  console.log(`  ⚠ sha256 重复 ${index.duplicates.length} 组：${index.duplicates.map((g) => g.join(" = ")).join("; ")}`);
}
if (index.untagged.length) {
  console.log(`  ⚠ 未打标条目：${index.untagged.join(", ")}`);
}
if (index.unknownTags.length) {
  for (const u of index.unknownTags) console.log(`  ✗ ${u.id} 使用了词表外标签 ${u.tag}`);
  process.exitCode = 1;
}
