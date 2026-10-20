// 给已有条目打标 / 改文案；新增素材走 --new
// 用法:
//   node tools/tag.mjs --id fx-01-niling --scene 拟令 --mood 认真 --usage 配图
//   node tools/tag.mjs --id new-01 --new --file data/raw/xxx.gif --caption "..." --credit BrickAZ
//   node tools/tag.mjs --id new-01 --new --url https://cdn.jsdelivr.net/gh/... --caption "..."
import fs from "node:fs";
import path from "node:path";
import { ROOT, parseArgs, multi, fail } from "../lib/cli.mjs";
import { loadConfig, loadTaxonomy, loadCatalog, normalizeTag, DIMS, sha256File } from "../lib/kb.mjs";
import { imageKind, EXT_OF_KIND } from "../lib/png.mjs";

const args = parseArgs(process.argv.slice(2));
const cfg = loadConfig(ROOT);
const taxo = loadTaxonomy(ROOT, cfg);
const entries = loadCatalog(ROOT, cfg);

if (!args.id || args.id === true) fail("缺 --id");
const id = String(args.id);
let entry = entries.find((e) => e.id === id);

if (args.new) {
  if (entry) fail(`${id} 已存在，去掉 --new 走更新`);
  // 优先从 fetch 草稿里认领：草稿已带 file / sha256 / url / credit，不用重复填
  const draftPath = path.join(ROOT, "manifest", "catalog.draft.jsonl");
  let draft = null;
  if (fs.existsSync(draftPath)) {
    draft = fs
      .readFileSync(draftPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .find((d) => d?.id === id);
  }
  if (draft) {
    const { needsTagging, ...rest } = draft;
    entry = { ...rest, tags: {} };
    console.log(`ℹ 从草稿认领：${entry.file}（${needsTagging ? "待打标" : "已打标"}）`);
  } else {
    entry = { id, status: args.url && !args.file ? "remote" : "local", url: args.url ?? "", tags: {} };
  }
  if (!entry.file && !args.file) {
    if (!entry.url && !args.url) fail("--new 需要 --file 或 --url，或给一个 catalog.draft.jsonl 里存在的 id");
  }
  entries.push(entry);
}
if (!entry) fail(`找不到 ${id}（新增请加 --new）`);

entry.tags ||= {};
for (const dim of DIMS) {
  const raw = multi(args[dim]);
  if (!raw.length) continue;
  const ids = [];
  for (const r of raw) {
    const norm = normalizeTag(taxo, dim, r);
    if (!norm) fail(`词表里没有 ${dim}:${r}（新增词条请改 manifest/taxonomy.json）`);
    ids.push(norm);
  }
  entry.tags[dim] = [...new Set([...(entry.tags[dim] || []), ...ids])];
}

if (typeof args.caption === "string") entry.caption = args.caption;
if (typeof args.credit === "string") entry.credit = args.credit;
if (typeof args.license === "string") entry.license = args.license;
if (typeof args.url === "string") entry.url = args.url;

// 无论 file 来自 --file 还是草稿，都要按魔数核对一遍真实格式
const srcFile = typeof args.file === "string" ? args.file : entry.status === "local" ? entry.file : null;
if (srcFile) {
  const abs = path.isAbsolute(srcFile) ? srcFile : path.join(ROOT, srcFile);
  if (!fs.existsSync(abs)) fail(`文件不存在: ${srcFile}`);
  let rel = path.relative(ROOT, abs).split(path.sep).join("/");
  if (rel.startsWith("..")) fail("file 必须在仓库内，便于配图时用相对路径");
  const buf = fs.readFileSync(abs);
  const kind = imageKind(buf);
  if (kind === "unknown") fail(`无法识别图片格式: ${srcFile}`);
  // 扩展名与真实格式不一致时改名，避免 CDN / 渲染器按扩展名解码失败
  if (path.extname(rel).toLowerCase() !== EXT_OF_KIND[kind]) {
    const fixed = rel.slice(0, -path.extname(rel).length) + EXT_OF_KIND[kind];
    fs.renameSync(abs, path.join(ROOT, ...fixed.split("/")));
    console.log(`ℹ 扩展名与真实格式不符，已改名 ${rel} → ${fixed}`);
    rel = fixed;
  }
  entry.status = "local";
  entry.file = rel;
  entry.kind = kind === "gif" ? "gif" : "image";
  entry.bytes = buf.length;
  entry.sha256 = sha256File(path.join(ROOT, ...rel.split("/")));
}

const catalogPath = path.join(ROOT, cfg.catalog);
fs.writeFileSync(catalogPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

// 认领成功后把该行从草稿里删掉：否则草稿永远堆积，CI 也数不清还剩几张待打标
if (args.new) {
  const draftPath = path.join(ROOT, "manifest", "catalog.draft.jsonl");
  if (fs.existsSync(draftPath)) {
    const kept = fs
      .readFileSync(draftPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((l) => {
        try {
          return JSON.parse(l).id !== id;
        } catch {
          return true;
        }
      });
    fs.writeFileSync(draftPath, kept.length ? kept.join("\n") + "\n" : "");
    console.log(`ℹ 已从草稿移除 ${id}（剩余待打标 ${kept.length}）`);
  }
}
console.log(`✓ ${id} 已更新`);
console.log(JSON.stringify(entry, null, 2));
