// 从上游仓拉素材到 data/raw/<upstream>/，生成待打标草稿。
// 不直接进 catalog：素材进来必须人工/模型过一眼标签，避免污染知识库。
// 用法:
//   node tools/fetch.mjs --upstream brickaz-emotes --dry-run
//   node tools/fetch.mjs --all --limit 50
//   node tools/fetch.mjs --upstream edmok-blue-fish --route github-api
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, parseArgs, fail } from "../lib/cli.mjs";
import { loadConfig, readJson } from "../lib/kb.mjs";
import { imageKind, EXT_OF_KIND } from "../lib/png.mjs";

const ASSET_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT = 20_000;

const args = parseArgs(process.argv.slice(2));
const cfg = loadConfig(ROOT);
const { upstreams } = readJson(path.join(ROOT, cfg.upstreams));

const dryRun = Boolean(args["dry-run"]);
const limit = Number(args.limit) || Infinity;
const forceRoute = typeof args.route === "string" ? args.route : null;

function isAsset(p) {
  if (p.includes("node_modules/") || p.startsWith(".git/")) return false;
  return ASSET_EXT.has(path.extname(p).toLowerCase());
}

async function getJson(url) {
  const r = await fetch(url, {
    headers: { "user-agent": "dayu-fish-kb/0.1", accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const routes = {
  // jsDelivr 只当 CDN 用：它的包清单接口对 gh 仓不稳（实测 404/403），
  // 列文件改走 GitHub Trees（拿 default_branch），下载走 jsDelivr。
  async jsdelivr(up) {
    const [owner, repo] = up.repo.split("/");
    const info = await getJson(`https://api.github.com/repos/${owner}/${repo}`);
    const branch = info.default_branch || "main";
    const tree = await getJson(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    const files = (tree.tree || []).filter((t) => t.type === "blob" && isAsset(t.path)).map((t) => t.path);
    return files.map((p) => ({
      path: p,
      url: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${p}`,
    }));
  },
  // GitHub API：无 token 时 60 次/小时，够列树，不够大量下载
  async "github-api"(up) {
    const [owner, repo] = up.repo.split("/");
    const tree = await getJson(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`);
    const files = (tree.tree || []).filter((t) => t.type === "blob" && isAsset(t.path)).map((t) => t.path);
    return files.map((p) => ({ path: p, url: `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${p}` }));
  },
};

function safeRel(p) {
  const norm = path.posix.normalize(String(p).replace(/\\/g, "/")).replace(/^\/+/, "");
  if (norm.startsWith("..") || path.posix.isAbsolute(norm)) throw new Error(`不安全的远端路径: ${p}`);
  return norm;
}

async function download(url) {
  const r = await fetch(url, {
    headers: { "user-agent": "dayu-fish-kb/0.1" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`超过 ${MAX_BYTES} 字节，跳过`);
  return buf;
}

const targets = args.all
  ? upstreams
  : upstreams.filter((u) => String(args.upstream || "") === u.id);
if (!targets.length) fail(`未知 upstream。可选：${upstreams.map((u) => u.id).join(", ")}`);

const drafts = [];
let total = 0;
let failed = 0;

for (const up of targets) {
  const chain = forceRoute ? [forceRoute] : up.routes.filter((r) => routes[r]);
  let listing = null;
  let usedRoute = null;
  for (const route of chain) {
    if (!routes[route]) continue;
    try {
      listing = await routes[route](up);
      usedRoute = route;
      break;
    } catch (e) {
      console.error(`  ${up.id} / ${route} 失败：${String(e.message || e).slice(0, 120)}`);
    }
  }
  if (!listing) {
    console.error(`✗ ${up.id} 所有路由都失败（离线？先跑 npm run doctor）`);
    failed++;
    continue;
  }
  // 只想拉某个子目录/某类文件时用 --contains，避免 3000 个候选从头排
  if (typeof args.contains === "string") {
    const before = listing.length;
    listing = listing.filter((f) => f.path.includes(args.contains));
    console.log(`  按 --contains "${args.contains}" 过滤：${before} → ${listing.length}`);
  }
  console.log(`→ ${up.id}：${listing.length} 个候选（route=${usedRoute}）`);
  if (dryRun) {
    for (const f of listing.slice(0, 10)) console.log(`   · ${f.path}`);
    if (listing.length > 10) console.log(`   … 其余 ${listing.length - 10} 个`);
    continue;
  }
  for (const f of listing) {
    if (total >= limit) break;
    let rel;
    try {
      rel = safeRel(f.path);
    } catch (e) {
      console.error(`  ✗ ${e.message}`);
      continue;
    }
    const out = path.join(ROOT, cfg.dataDir, "raw", up.id, ...rel.split("/"));
    try {
      if (!fs.existsSync(out)) {
        const buf = await download(f.url);
        const kind = imageKind(buf);
        if (kind === "unknown") {
          console.error(`  ✗ ${rel} 不是可识别图片，跳过`);
          continue;
        }
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, buf);
        drafts.push({
          id: `${up.id}/${rel.replace(/\.[^.]+$/, "")}`,
          kind: kind === "gif" ? "gif" : "image",
          status: "local",
          file: path.relative(ROOT, out).split(path.sep).join("/"),
          url: f.url,
          bytes: buf.length,
          sha256: crypto.createHash("sha256").update(buf).digest("hex"),
          tags: {},
          caption: "",
          credit: up.credit,
          license: up.license,
          needsTagging: true,
        });
      }
      total++;
    } catch (e) {
      failed++;
      console.error(`  ✗ ${rel}：${String(e.message || e).slice(0, 100)}`);
    }
  }
}

if (!dryRun) {
  const draftPath = path.join(ROOT, "manifest", "catalog.draft.jsonl");
  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  const prev = fs.existsSync(draftPath) ? fs.readFileSync(draftPath, "utf8") : "";
  if (drafts.length) fs.writeFileSync(draftPath, prev + drafts.map((d) => JSON.stringify(d)).join("\n") + "\n");
  console.log(`\n✓ 入盘 ${drafts.length} 个，跳过/失败 ${failed} 个`);
  console.log(`草稿：manifest/catalog.draft.jsonl（未打标，需 npm run tag 后才能参与配图）`);
}
