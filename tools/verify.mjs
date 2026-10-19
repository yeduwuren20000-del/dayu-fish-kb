// 校验：文件真实存在、sha 对得上、标签都在词表内、id 不重复
import { ROOT } from "../lib/cli.mjs";
import { loadConfig, loadTaxonomy, loadCatalog, validateCatalog } from "../lib/kb.mjs";

const cfg = loadConfig(ROOT);
const taxo = loadTaxonomy(ROOT, cfg);
const entries = loadCatalog(ROOT, cfg);
const { errors, warnings, stats } = validateCatalog(entries, taxo, ROOT);

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);

console.log(`\n条目 ${stats.total}，唯一 id ${stats.ids}，错误 ${errors.length}，警告 ${warnings.length}`);
if (errors.length) {
  console.log("结论：不通过");
  process.exit(1);
}
console.log("结论：通过");
