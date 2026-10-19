// 优化侧车的接入逻辑：配图默认吃优化版，校验能抓出「优化版被换过」
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyOptimized, validateOptimized, sha256File } from "../lib/kb.mjs";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dayu-opt-"));
}

function makeOpt(root, id, bytes, { srcBytes = 1_000_000, animated = false } = {}) {
  const rel = `data/opt/${id.replace(/\//g, "__")}.webp`;
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  const thumbRel = `data/thumb/${id.replace(/\//g, "__")}.webp`;
  fs.mkdirSync(path.dirname(path.join(root, thumbRel)), { recursive: true });
  fs.writeFileSync(path.join(root, thumbRel), bytes);
  return {
    id,
    src: "data/raw/x.png",
    srcBytes,
    opt: rel,
    optBytes: bytes.length,
    optSha256: sha256File(abs),
    thumb: thumbRel,
    thumbBytes: bytes.length,
    width: 800,
    height: 800,
    frames: animated ? 10 : 1,
    animated,
  };
}

test("applyOptimized 把 file 换成优化版，并保留 rawFile", () => {
  const root = tmpRoot();
  const rec = makeOpt(root, "owner/pic", Buffer.from("webp-bytes"));
  const map = new Map([[rec.id, rec]]);
  const [e] = applyOptimized([{ id: "owner/pic", file: "data/raw/x.png" }], map);
  assert.equal(e.file, rec.opt);
  assert.equal(e.rawFile, "data/raw/x.png");
  assert.equal(e.opt.optBytes, rec.optBytes);
});

test("applyOptimized raw=true 不动路径（要看原图时用）", () => {
  const root = tmpRoot();
  const map = new Map([["owner/pic", makeOpt(root, "owner/pic", Buffer.from("x"))]]);
  const [e] = applyOptimized([{ id: "owner/pic", file: "data/raw/x.png" }], map, { raw: true });
  assert.equal(e.file, "data/raw/x.png");
});

test("applyOptimized 对没有优化记录的条目原样返回", () => {
  const [e] = applyOptimized([{ id: "nope", file: "data/raw/x.png" }], new Map());
  assert.equal(e.file, "data/raw/x.png");
});

test("validateOptimized 通过正常侧车", () => {
  const root = tmpRoot();
  const rec = makeOpt(root, "owner/pic", Buffer.from("ok-bytes"));
  const r = validateOptimized(new Map([[rec.id, rec]]), root);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.count, 1);
});

test("validateOptimized 抓得住被替换的优化文件（sha 不符）", () => {
  const root = tmpRoot();
  const rec = makeOpt(root, "owner/pic", Buffer.from("orig"));
  fs.writeFileSync(path.join(root, rec.opt), Buffer.from("tampered"));
  const r = validateOptimized(new Map([[rec.id, rec]]), root);
  // 字节数和 sha 都会不符，两条都该报出来
  assert.ok(r.errors.length >= 1);
  assert.ok(r.errors.some((e) => /sha256 不符/.test(e)));
});

test("validateOptimized 对缺失文件报错，对「优化后更大」只告警", () => {
  const root = tmpRoot();
  const missing = makeOpt(root, "a/b", Buffer.from("x"));
  fs.rmSync(path.join(root, missing.opt));
  const bigger = makeOpt(root, "c/d", Buffer.from("0123456789"), { srcBytes: 5 });
  const r = validateOptimized(new Map([["a/b", missing], ["c/d", bigger]]), root);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /不存在/);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /反而变大/);
});
