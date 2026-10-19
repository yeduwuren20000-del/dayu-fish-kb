// 校验：文件真实存在、sha 对得上、标签都在词表内、id 不重复、优化版与侧车一致
import { ROOT } from "../lib/cli.mjs";
import { loadConfig, loadTaxonomy, loadCatalog, loadOptimized, validateCatalog, validateOptimized } from "../lib/kb.mjs";

const cfg = loadConfig(ROOT);
const taxo = loadTaxonomy(ROOT, cfg);
const entries = loadCatalog(ROOT, cfg);
const catalog = validateCatalog(entries, taxo, ROOT);

const optMap = loadOptimized(ROOT, cfg);
const opt = validateOptimized(optMap, ROOT);

const errors = [...catalog.errors, ...opt.errors];
const warnings = [...catalog.warnings, ...opt.warnings];

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);

const mb = (n) => (n / 1048576).toFixed(2);
const savedPct = opt.stats.tin ? Math.round((1 - opt.stats.tout / opt.stats.tin) * 100) : 0;

console.log(`\n条目 ${catalog.stats.total}，唯一 id ${catalog.stats.ids}，错误 ${errors.length}，警告 ${warnings.length}`);
if (opt.stats.count) {
  console.log(`优化版 ${opt.stats.count} 条：${mb(opt.stats.tin)} MB → ${mb(opt.stats.tout)} MB（省 ${savedPct}%）`);
}
if (optMap.size && optMap.size < entries.filter((e) => e.status === "local").length) {
  console.log(`⚠ 有 local 条目还没优化：跑 npm run optimize`);
}
if (errors.length) {
  console.log("结论：不通过");
  process.exit(1);
}
console.log("结论：通过");
