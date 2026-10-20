// 自测：在临时目录里起一个完整 KB，验证归一、打分、去重、校验
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedFixture, SPECS } from "../lib/fixture.mjs";
import {
  loadConfig,
  loadTaxonomy,
  loadCatalog,
  normalizeTag,
  normalizeQuery,
  validateCatalog,
  buildIndex,
  pick,
  render,
  hamming,
  nearDuplicateGroups,
  applyOptimized,
  loadNodeMap,
  resolveNode,
  validateNodeMap,
} from "../lib/kb.mjs";

const REPO = path.resolve(import.meta.dirname, "..");

function makeKb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dayu-kb-"));
  fs.writeFileSync(path.join(root, "kb.config.json"), fs.readFileSync(path.join(REPO, "kb.config.json")));
  fs.mkdirSync(path.join(root, "manifest"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "manifest", "taxonomy.json"), path.join(root, "manifest", "taxonomy.json"));
  seedFixture(root);
  const cfg = loadConfig(root);
  const taxo = loadTaxonomy(root, cfg);
  return { root, cfg, taxo };
}

test("别名归一到规范 id", () => {
  const { taxo } = makeKb();
  assert.equal(normalizeTag(taxo, "scene", "封驳"), "menxia-fengbo");
  assert.equal(normalizeTag(taxo, "scene", "门下省"), "menxia-fengbo");
  assert.equal(normalizeTag(taxo, "mood", "问号"), "yihuo");
  assert.equal(normalizeTag(taxo, "form", "chibi"), "qban");
  assert.equal(normalizeTag(taxo, "scene", "不存在的场景"), null);
});

test("未收录查询词被如实报告，不静默丢弃", () => {
  const { taxo } = makeKb();
  const { query, unknown } = normalizeQuery(taxo, { scene: ["封驳", "瞎编的"], mood: ["疑惑"] });
  assert.deepEqual(query.scene, ["menxia-fengbo"]);
  assert.equal(unknown.length, 1);
  assert.match(unknown[0], /scene:/);
});

test("fixture 自洽：10 条、1 组重复、全部通过校验", () => {
  const { root, cfg, taxo } = makeKb();
  const entries = loadCatalog(root, cfg);
  assert.equal(entries.length, SPECS.length);
  const { errors, warnings } = validateCatalog(entries, taxo, root);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 0);
  const idx = buildIndex(entries, taxo);
  assert.equal(idx.duplicates.length, 1);
  assert.deepEqual(idx.duplicates[0].sort(), ["fx-03-paidan", "fx-05-dup-of-paidan"]);
});

test("篡改文件会让校验失败（sha256 守门）", () => {
  const { root, cfg, taxo } = makeKb();
  const entries = loadCatalog(root, cfg);
  const target = path.join(root, entries[0].file);
  const buf = fs.readFileSync(target);
  buf[buf.length - 1] ^= 0xff;
  fs.writeFileSync(target, buf);
  const { errors } = validateCatalog(entries, taxo, root);
  assert.ok(errors.some((e) => e.includes("sha256 不符")), errors.join("\n"));
});

test("配图检索：场景命中优先", () => {
  const { root, cfg, taxo } = makeKb();
  const entries = loadCatalog(root, cfg);
  const { picks, fallback } = pick(entries, taxo, { scene: ["封驳"] }, { n: 3 });
  assert.equal(fallback, false);
  assert.equal(picks[0].id, "fx-02-fengbo");
});

test("去重：同 sha256 只出一张，并如实报告被压掉的 id", () => {
  const { root, cfg, taxo } = makeKb();
  const entries = loadCatalog(root, cfg);
  const { picks, droppedDuplicates } = pick(entries, taxo, {}, { n: 20 });
  assert.equal(picks.length, SPECS.length - 1);
  assert.ok(!picks.some((p) => p.id === "fx-05-dup-of-paidan"), "重复项应被压掉");
  assert.deepEqual(droppedDuplicates, ["fx-05-dup-of-paidan"]);
  const shas = new Set(picks.map((p) => p.sha256));
  assert.equal(shas.size, picks.length);
});

test("多轴叠加时高分者胜出", () => {
  const { root, cfg, taxo } = makeKb();
  const entries = loadCatalog(root, cfg);
  const { picks } = pick(entries, taxo, { scene: ["派单"], mood: ["乖巧"], form: ["Q版"] }, { n: 1 });
  assert.equal(picks[0].id, "fx-03-paidan");
  assert.ok(picks[0]._score >= 6 + 4 + 2);
});

test("没有命中时退回全量并标注 fallback", () => {
  const { root, cfg, taxo } = makeKb();
  const entries = loadCatalog(root, cfg);
  const { picks, fallback } = pick(entries, taxo, { mood: ["震惊"] }, { n: 1 });
  assert.equal(fallback, true);
  assert.equal(picks.length, 1);
});

test("strict 场景过滤：宁可只给场景对的，也不混入别的部门", () => {
  const { root, cfg, taxo } = makeKb();
  const entries = loadCatalog(root, cfg);
  const { picks } = pick(entries, taxo, { scene: ["庆祝"], mood: ["委屈"] }, { n: 5, strict: true });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].id, "fx-09-qingzhu");
  assert.ok(picks.every((p) => p.tags.scene.includes("qingzhu")));
});

test("markdown 渲染带 caption 与标签标题", () => {
  const { root, cfg, taxo } = makeKb();
  const entries = loadCatalog(root, cfg);
  const md = render(entries[0], "md");
  assert.match(md, /^!\[大肥鱼 · /);
  assert.match(md, /\.png "/);
  assert.match(render(entries[0], "html"), /^<img /);
});

test("索引倒排可用：场景桶指向正确条目", () => {
  const { root, cfg, taxo } = makeKb();
  const entries = loadCatalog(root, cfg);
  const idx = buildIndex(entries, taxo);
  assert.deepEqual(idx.byTag["scene:menxia-fengbo"], ["fx-02-fengbo"]);
  assert.equal(idx.untagged.length, 0);
  assert.equal(idx.local, SPECS.length);
});

test("节点表：--node 展开成一组条件，写错词表会被 verify 拦下", () => {
  const { root, cfg, taxo } = makeKb();
  fs.writeFileSync(
    path.join(root, "manifest", "node-map.json"),
    JSON.stringify({
      nodes: {
        封驳: { node: "门下封驳", scene: "封驳", usage: ["表情"], form: ["Q版"], note: "小图" },
        瞎写: { node: "不存在节点", scene: "这个场景没有", usage: ["没这个用法"] },
      },
    })
  );
  const map = loadNodeMap(root, cfg);
  const node = resolveNode(taxo, map, "封驳");
  assert.equal(node.node, "门下封驳");
  assert.deepEqual(node.scene, ["menxia-fengbo"], "别名应归一成 id");
  assert.deepEqual(node.usage, ["reaction"]);
  assert.equal(resolveNode(taxo, map, "查无此节点"), null);
  // loadNodeMap 只认外壳里的 nodes，不把 version/note 当节点
  assert.ok(!("version" in map) && !("note" in map));
  const errs = validateNodeMap(taxo, map);
  assert.equal(errs.length, 2, errs.join("\n"));
  assert.ok(errs.some((e) => e.includes("scene:这个场景没有")));
});

test("hamming：只数不同的 bit，坏输入返回 null", () => {
  assert.equal(hamming("0000000000000000", "0000000000000000"), 0);
  assert.equal(hamming("0000000000000000", "0000000000000003"), 2);
  assert.equal(hamming("ffffffffffffffff", "0000000000000000"), 64);
  assert.equal(hamming(null, "0000000000000000"), null);
  assert.equal(hamming("zz", "0000000000000000"), null);
});

test("近似去重：dHash 距离 ≤6 算同一组；内容不同但 sha 相同的另算", () => {
  const { root, cfg, taxo } = makeKb();
  const entries = loadCatalog(root, cfg);
  // fx-02 与 fx-09 字节不同（sha 不同）但指纹只差 3bit → 近似重复
  // fx-03 与 fx-05 字节相同（sha 相同）→ 走原有的完全重复分支
  const optMap = new Map([
    ["fx-02-fengbo", { dhash: "0000000000000000", opt: "data/opt/a.webp" }],
    ["fx-09-qingzhu", { dhash: "0000000000000007", opt: "data/opt/b.webp" }],
    ["fx-03-paidan", { dhash: "ffffffffffffffff", opt: "data/opt/c.webp" }],
  ]);
  const groups = nearDuplicateGroups(entries, optMap);
  assert.equal(groups.length, 1, JSON.stringify(groups));
  assert.deepEqual(groups[0].slice().sort(), ["fx-02-fengbo", "fx-09-qingzhu"]);
  const idx = buildIndex(entries, taxo, optMap);
  assert.deepEqual(idx.nearDuplicates, groups);

  const eOpt = applyOptimized(entries, optMap);
  const { picks, droppedDuplicates } = pick(eOpt, taxo, {}, { n: 20 });
  assert.ok(droppedDuplicates.includes("fx-09-qingzhu"), "近似重复应被压掉");
  assert.ok(!picks.some((p) => p.id === "fx-09-qingzhu"));
  assert.ok(picks.some((p) => p.id === "fx-02-fengbo"), "同组里要留下先命中的那张");
  const { picks: keep } = pick(eOpt, taxo, {}, { n: 20, keepNearDups: true });
  assert.ok(keep.some((p) => p.id === "fx-09-qingzhu"), "keepNearDups 应放行近似重复");
  assert.ok(!keep.some((p) => p.id === "fx-05-dup-of-paidan"), "字节级重复任何情况下都不放行");
});
