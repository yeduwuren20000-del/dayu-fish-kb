// 静态检索页：把 index.json + 条目元数据烤进一个自包含 HTML
// 双击就能看，不需要后端；本机没原图时自动回落到上游 URL。
// 用法: node tools/gallery.mjs [--out web/index.html] [--max 500]
import fs from "node:fs";
import path from "node:path";
import { ROOT, parseArgs } from "../lib/cli.mjs";
import { loadConfig, loadTaxonomy, loadCatalog, loadOptimized, applyOptimized, buildIndex } from "../lib/kb.mjs";

const args = parseArgs(process.argv.slice(2));
const cfg = loadConfig(ROOT);
const taxo = loadTaxonomy(ROOT, cfg);
const entries = applyOptimized(loadCatalog(ROOT, cfg), loadOptimized(ROOT, cfg));
const index = buildIndex(entries, taxo, loadOptimized(ROOT, cfg));

const MAX = Number(args.max) || 500;
// 页面多半不在仓库根（web/index.html），本地图路径要按页面所在目录换算成相对路径
const outRel = args.out || "web/index.html";
const outPath = path.isAbsolute(outRel) ? outRel : path.join(ROOT, outRel);
const BASE = path.relative(path.dirname(outPath), ROOT).split(path.sep).join("/"); // web/ 下就是 ".."
const toPage = (p) => (p ? (BASE ? `${BASE}/${p}` : p) : "");

// 只带页面需要的字段，别把整条记录（含长 caption）都塞进去
const items = entries
  .slice(0, MAX)
  .map((e) => ({
    id: e.id,
    caption: e.caption || "",
    credit: e.credit || "",
    license: e.license || "",
    tags: e.tags || {},
    thumb: toPage(e.opt?.thumb || e.thumb || ""),
    file: toPage(e.file || ""),
    rawFile: toPage(e.rawFile || ""),
    url: e.url || "",
    kind: e.kind || "",
    bytes: e.bytes || 0,
    optBytes: e.opt?.optBytes || 0,
    nearDup: (index.nearDuplicates || []).some((g) => g.includes(e.id) && g[0] !== e.id),
  }));

const dims = Object.entries(taxo.raw.dimensions).map(([key, d]) => ({
  key,
  label: d.label,
  values: (d.values || []).map((v) => ({ id: v.id, label: v.label })),
}));

const data = JSON.stringify({ items, dims, generated: new Date().toISOString(), count: entries.length });

// --data-only：只吐内嵌数据（给冒烟测试用，省得去正则解析 HTML）
if (args["data-only"]) {
  process.stdout.write(data + "\n");
  process.exit(0);
}
const dataInlined = data
  // 内联 <script> 里不能出现 </script>，转义掉（元数据来自上游，得防一手）
  .replace(/<\//g, "<\\/");

function pageHtml(data) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>大肥鱼配图知识库</title>
<style>
:root{--bg:#0f1420;--fg:#e8ecf4;--mut:#8a94a8;--card:#171e2c;--line:#243049;--hit:#4da3ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,"PingFang SC","Microsoft YaHei",sans-serif}
header{position:sticky;top:0;background:rgba(15,20,32,.95);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);padding:12px 16px;z-index:5}
h1{margin:0 0 6px;font-size:16px}
#q{width:min(420px,100%);padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:#0b1018;color:var(--fg)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.group{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-right:10px}
.group b{color:var(--mut);font-weight:600;font-size:12px}
button{cursor:pointer;border:1px solid var(--line);background:#121a28;color:var(--fg);border-radius:999px;padding:3px 10px;font-size:12px}
button[aria-pressed=true]{background:var(--hit);color:#04101e;border-color:var(--hit);font-weight:600}
#stat{color:var(--mut);font-size:12px;margin-top:8px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.card img{width:100%;height:150px;object-fit:contain;background:#0b1018;cursor:zoom-in}
.card .body{padding:8px;display:flex;flex-direction:column;gap:6px;flex:1}
.cap{font-size:13px;min-height:2.6em}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:auto}
.t{font-size:11px;color:var(--mut);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.t.hit{color:var(--hit);border-color:var(--hit)}
.meta{font-size:11px;color:var(--mut);word-break:break-all}
.dup{opacity:.55;border-color:#3a4560}
.card.dup .cap::before{content:"近似重复 · ";color:#e8b23a}
.card.noimg img{display:none}
.card.noimg .cap::before{content:"本机无图 · ";color:#8a94a8}
.badge{font-size:11px;color:#e8b23a}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:20}
#lb.on{display:flex}
#lb img{max-width:92vw;max-height:88vh;object-fit:contain}
</style></head>
<body>
<header>
  <h1>大肥鱼配图知识库 <span class="badge">静态检索页</span></h1>
  <input id="q" placeholder="搜 caption / id / 来源，支持多个词">
  <div class="chips" id="chips"></div>
  <div id="stat"></div>
</header>
<main id="grid"></main>
<div id="lb"><img alt=""></div>
<script>
const DB = ${data};
const state = { q: "", sel: {}, hideDup: true };
const grid = document.getElementById("grid"), chips = document.getElementById("chips"), stat = document.getElementById("stat");

function renderChips() {
  chips.innerHTML = "";
  // 近似重复默认折叠，要对照两个版本时点开
  const t = document.createElement("button");
  t.textContent = state.hideDup ? "已折叠近似重复（点开显示）" : "显示近似重复中（点开折叠）";
  t.setAttribute("aria-pressed", String(!state.hideDup));
  t.onclick = () => { state.hideDup = !state.hideDup; draw(); };
  chips.appendChild(t);
  for (const d of DB.dims) {
    const g = document.createElement("div"); g.className = "group";
    const b = document.createElement("b"); b.textContent = d.label; g.appendChild(b);
    for (const v of d.values) {
      const btn = document.createElement("button");
      btn.textContent = v.label;
      btn.dataset.dim = d.key; btn.dataset.val = v.id;
      btn.setAttribute("aria-pressed", String(!!(state.sel[d.key] || []).includes(v.id)));
      btn.onclick = () => {
        const cur = state.sel[d.key] || (state.sel[d.key] = []);
        const i = cur.indexOf(v.id);
        i < 0 ? cur.push(v.id) : cur.splice(i, 1);
        if (!cur.length) delete state.sel[d.key];
        draw();
      };
      g.appendChild(btn);
    }
    chips.appendChild(g);
  }
}

function match(it) {
  for (const [dim, vals] of Object.entries(state.sel)) {
    const own = it.tags[dim] || [];
    if (!vals.some(v => own.includes(v))) return false;
  }
  if (state.q) {
    const hay = (it.id + " " + it.caption + " " + it.credit + " " + it.license).toLowerCase();
    if (!state.q.toLowerCase().split(/\\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

function draw() {
  renderChips();
  grid.innerHTML = "";
  let n = 0, dup = 0;
  for (const it of DB.items) {
    if (!match(it)) continue;
    if (it.nearDup && state.hideDup) { dup++; continue; }
    n++;
    const card = document.createElement("div"); card.className = "card" + (it.nearDup ? " dup" : "");
    const img = document.createElement("img"); img.loading = "lazy"; img.alt = it.caption || it.id;
    // 列表用 320px 缩略图，灯箱放大时换优化版/原图，省流量也快
    const local = it.thumb || it.file;
    img.dataset.full = it.file || it.url;
    if (local || it.url) {
      img.src = local || it.url;
      // 本机没有图（data/ 不入库）就回落到上游 URL
      if (it.url) img.onerror = () => { img.onerror = null; img.src = it.url; };
      else img.onerror = () => { img.onerror = null; card.classList.add("noimg"); };
    } else {
      card.classList.add("noimg");
    }
    img.onclick = () => { const lb = document.getElementById("lb"); lb.firstElementChild.src = img.dataset.full || img.src; lb.classList.add("on"); };
    const body = document.createElement("div"); body.className = "body";
    const cap = document.createElement("div"); cap.className = "cap"; cap.textContent = it.caption || "（未写说明）";
    const tg = document.createElement("div"); tg.className = "tags";
    for (const d of DB.dims) for (const v of (it.tags[d.key] || [])) {
      const s = document.createElement("span");
      s.className = "t" + ((state.sel[d.key] || []).includes(v) ? " hit" : "");
      s.textContent = label(d.key, v); tg.appendChild(s);
    }
    const meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = it.id + (it.optBytes ? " · " + kb(it.optBytes) : it.bytes ? " · " + kb(it.bytes) : "");
    const cr = document.createElement("div"); cr.className = "meta";
    cr.textContent = [it.credit, it.license].filter(Boolean).join(" / ");
    body.append(cap, tg, meta, cr); card.append(img, body); grid.appendChild(card);
  }
  stat.textContent = "生成于 " + DB.generated.slice(0, 16).replace("T", " ") + " UTC　显示 " + n + " / " + DB.count + " 条"
    + (dup ? "　近似重复折叠 " + dup + " 张（点上方按钮切换）" : "");
}

function label(dim, id) {
  const d = DB.dims.find(x => x.key === dim);
  const v = d && d.values.find(x => x.id === id);
  return v ? v.label : id;
}
function kb(b) { return b > 1048576 ? (b / 1048576).toFixed(2) + " MB" : Math.round(b / 1024) + " KB"; }

document.getElementById("q").addEventListener("input", e => { state.q = e.target.value; draw(); });
document.getElementById("lb").onclick = e => e.currentTarget.classList.remove("on");
addEventListener("keydown", e => { if (e.key === "Escape") document.getElementById("lb").classList.remove("on"); });
draw();
</script>
</body></html>
`;
}

const html = pageHtml(dataInlined);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
const dupCount = items.filter((i) => i.nearDup).length;
console.log(`✓ 检索页已生成 → ${path.relative(ROOT, outPath)}（${items.length} 条，其中近似重复 ${dupCount} 条默认折叠）`);
console.log("  直接双击打开即可筛选；本机没有的图会自动回落到上游 URL。");
