// 检索页冒烟测试：不依赖浏览器，用最小 DOM 桩在 vm 里跑内联脚本，验证筛选/渲染逻辑
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert";
import { ROOT } from "../lib/cli.mjs";

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log("  ✓ " + name);
  } catch (e) {
    fail++;
    console.log("  ✗ " + name + "\n    " + e.message);
  }
}

const PAGE = path.join(ROOT, "web", "index.html");
const html = fs.readFileSync(PAGE, "utf8");

function el(tag) {
  const node = {
    tag,
    children: [],
    dataset: {},
    className: "",
    textContent: "",
    _html: "",
    complete: true,
    naturalWidth: 120,
    style: {},
    firstElementChild: null,
    append(...ns) { this.children.push(...ns); },
    appendChild(n) { this.children.push(n); return n; },
    setAttribute(k, v) { this["attr_" + k] = v; },
    getAttribute(k) { return this["attr_" + k] ?? null; },
    addEventListener(type, fn) { (this.handlers ||= {})[type] = fn; },
    click() { this.onclick && this.onclick(); },
    querySelectorAll(sel) { return walk(this).filter((n) => n.className.split(/\s+/).includes(sel.slice(1))); },
  };
  Object.defineProperty(node, "innerHTML", {
    get() { return this._html; },
    set(v) { this._html = v; if (v === "") this.children.length = 0; },
  });
  node.classList = { add: (c) => (node.className += " " + c), remove: () => {}, contains: () => false };
  return node;
}
function walk(node, out = []) {
  for (const c of node.children || []) { out.push(c); walk(c, out); }
  return out;
}

const byId = {};
for (const id of ["grid", "chips", "stat", "q"]) byId[id] = el(id);
byId.lb = el("lb");
byId.lb.firstElementChild = el("img");

const document = {
  getElementById: (id) => byId[id] || (byId[id] = el(id)),
  createElement: el,
};
const sandbox = {
  document,
  window: {},
  addEventListener: () => {},
  console: { log: () => {} },
  JSON,
  Math,
  Object,
  Array,
  String,
  Number,
  Date,
  RegExp,
  Boolean,
};
vm.createContext(sandbox);

const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const DBJSON = script.match(/const DB = (\{[\s\S]*?\});\nconst state/)[1];

test("内联脚本语法可解析，且 DB 里没有裸 </script>（防上游元数据截断脚本）", () => {
  new vm.Script(script, { filename: "inline.js" });
  assert.ok(!DBJSON.includes("</script>"));
});

test("DB 烤进的条目数与 count 一致，且四个维度齐全", () => {
  const db = JSON.parse(DBJSON.replace(/<\\\//g, "</"));
  assert.strictEqual(db.items.length, db.count);
  assert.ok(db.items.length > 0);
  assert.deepStrictEqual(db.dims.map((d) => d.key), ["scene", "mood", "form", "usage"]);
});

vm.runInContext(script + "\n;globalThis.__probe = { DB, state, draw, match, grid: document.getElementById('grid'), stat: document.getElementById('stat') };", sandbox);
const probe = sandbox.__probe;

function cards() {
  return probe.grid.children.filter((c) => c.className.includes("card"));
}

test("默认渲染：卡片数 = 总数 - 近似重复数，且没有 dup 卡片", () => {
  probe.draw();
  const c = cards();
  const total = probe.DB.items.length;
  const dups = probe.DB.items.filter((i) => i.nearDup).length;
  assert.strictEqual(c.length, total - dups, "卡片数 " + c.length + " vs 期望 " + (total - dups));
  assert.strictEqual(c.filter((x) => x.className.includes("dup")).length, 0, "折叠时不该出现 dup 卡片");
  assert.ok(new RegExp("显示 " + (total - dups) + " / " + total).test(probe.stat.textContent), "状态行: " + probe.stat.textContent);
  assert.ok(/近似重复折叠 \d+/.test(probe.stat.textContent), "状态行: " + probe.stat.textContent);
});

test("每条记录都至少指向一个来源（本地图路径或上游 URL）", () => {
  probe.state.hideDup = false;
  probe.draw();
  const items = probe.DB.items;
  let local = 0, remote = 0, none = 0;
  for (const it of items) {
    const src = it.thumb || it.file;
    const exists = src && fs.existsSync(path.resolve(ROOT, "web", src));
    if (exists) local++;
    else if (it.url) remote++;
    else none++;
  }
  // 本机 data/ 不入库：在 CI 上跑时 fixture 既没文件也没 URL，降级为提示不算失败
  console.log(`    本地图 ${local} 张 / 靠上游回落 ${remote} 张 / 无来源 ${none} 张`);
  if (!process.env.DAYU_ALLOW_MISSING) {
    assert.strictEqual(none, 0, `有 ${none} 条既没本地图也没上游 URL：显示会是空白`);
  }
});

// 词表里的展示名（如 qingzhu → 「庆祝通过」）不要硬编码，从 DB.dims 取
function tagLabel(dim, id) {
  const d = probe.DB.dims.find((x) => x.key === dim);
  const v = d && d.values.find((x) => x.id === id);
  return v ? v.label : id;
}

test("按场景筛选「庆祝」只剩庆祝", () => {
  probe.state.hideDup = true;
  probe.draw();
  const shown = cards().length;
  probe.state.sel = { scene: ["qingzhu"] };
  probe.draw();
  const c = cards();
  assert.ok(c.length > 0 && c.length <= shown, "命中数 " + c.length + " vs 全量 " + shown);
  const want = tagLabel("scene", "qingzhu");
  for (const card of c) {
    const tags = card.querySelectorAll(".t");
    assert.ok(tags.some((s) => s.textContent === want), "混进了非庆祝: " + tags.map((x) => x.textContent).join(","));
  }
  probe.state.sel = {};
});

test("关键词搜「女仆」按 caption 过滤，且比全量少", () => {
  probe.draw();
  const total = cards().length;
  probe.state.q = "女仆";
  probe.draw();
  const hit = cards();
  assert.ok(hit.length >= 2, "命中数 " + hit.length);
  assert.ok(hit.length < total, "没过滤掉任何东西");
  for (const card of hit) {
    const cap = card.querySelectorAll(".cap")[0].textContent;
    const meta = card.querySelectorAll(".meta")[0].textContent;
    assert.ok(/女仆/.test(cap + meta), "卡片不含关键词: " + cap);
  }
  probe.state.q = "";
  probe.draw();
});

test("无匹配时清空网格而不是报错", () => {
  probe.state.q = "zzz不可能存在的词";
  probe.draw();
  assert.strictEqual(cards().length, 0);
  probe.state.q = "";
  probe.draw();
});

console.log(`\ngallery: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
