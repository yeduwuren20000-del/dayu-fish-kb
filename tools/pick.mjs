// 配图检索：给场景/情绪/形态，吐出可直接贴进回复的 markdown
// 用法:
//   node tools/pick.mjs --scene 封驳 --n 2
//   node tools/pick.mjs --scene 门下封驳 --mood 疑惑 --format html
//   node tools/pick.mjs --usage banner --format list
//   node tools/pick.mjs --for 门下封驳            # 场景别名，同 --scene
//   node tools/pick.mjs --node 封驳              # 读 manifest/node-map.json，一次给全套条件
import { ROOT, parseArgs, multi } from "../lib/cli.mjs";
import { loadConfig, loadTaxonomy, loadCatalog, loadOptimized, applyOptimized, loadNodeMap, resolveNode, pick, render } from "../lib/kb.mjs";

const args = parseArgs(process.argv.slice(2));
const cfg = loadConfig(ROOT);
const taxo = loadTaxonomy(ROOT, cfg);
// 默认用压缩后的 WebP（体积小一个数量级）；要看原图加 --raw
const entries = applyOptimized(loadCatalog(ROOT, cfg), loadOptimized(ROOT, cfg), { raw: Boolean(args.raw) });

// --node 把节点表里的一组默认条件展开；显式写的 --scene/--mood/... 覆盖表里的默认值
let node = null;
if (args.node) {
  node = resolveNode(taxo, loadNodeMap(ROOT, cfg), args.node);
  if (!node) {
    const table = loadNodeMap(ROOT, cfg);
    console.error(`✗ 节点表里没有「${args.node}」。可选：${Object.keys(table).join("、")}（表在 manifest/node-map.json，加一行就行）`);
    process.exit(1);
  }
  console.error(node.note ? `ℹ 节点「${args.node}」→ ${node.node}：${node.note}` : `ℹ 节点「${args.node}」→ ${node.node}`);
}
const cond = (explicit, dim) => {
  const list = multi(explicit);
  return list.length ? list : node && node[dim] ? node[dim] : [];
};

const query = {
  scene: cond(args.scene ?? args.for, "scene"),
  mood: cond(args.mood, "mood"),
  form: cond(args.form, "form"),
  usage: cond(args.usage, "usage"),
  keyword: typeof args.keyword === "string" ? args.keyword : typeof args.q === "string" ? args.q : "",
};

const { picks, fallback, droppedDuplicates, unknownTags, query: normalized } = pick(entries, taxo, query, {
  n: Number(args.n) || cfg.pick.defaultCount,
  strict: Boolean(args.strict),
  allowRemote: Boolean(args["allow-remote"]) || cfg.pick.allowRemote,
  keepNearDups: Boolean(args["keep-near-dups"]),
});

if (unknownTags.length) console.error(`⚠ 词表未收录，已忽略：${unknownTags.join(", ")}`);
// 全部查询词都不认识，等于没给条件——这时候别装作匹配成功
if (unknownTags.length && !normalized.keyword && ["scene", "mood", "form", "usage"].every((d) => normalized[d].length === 0)) {
  console.error("✗ 查询词一个都没命中词表。看 manifest/taxonomy.json，或先 npm run tag 补词条。");
  process.exit(1);
}
if (fallback) console.error("⚠ 没有命中任何标签，已退回全量候选（配图前请人工过一眼）");
if (droppedDuplicates.length) console.error(`ℹ 去重跳过：${droppedDuplicates.join(", ")}`);

if (!picks.length) {
  console.error("✗ 没有可用条目。先 npm run seed，或 npm run fetch 拉取上游素材后 npm run tag");
  process.exit(1);
}

const format = typeof args.format === "string" ? args.format : "md";
if (format === "json") {
  console.log(JSON.stringify({ picks, fallback, droppedDuplicates }, null, 2));
} else if (format === "list") {
  for (const p of picks) console.log(`${p.id}\t${p._score}\t${p.file}\t${p.caption || ""}`);
} else {
  for (const p of picks) console.log(render(p, format) + "\n");
}
