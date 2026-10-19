// 知识库核心：词表归一、条目校验、索引构建、配图打分。
// 无第三方依赖，Node >= 20 的 ESM 直接跑。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { imageKind, EXT_OF_KIND } from "./png.mjs";

export const AXES = ["scene", "mood", "form", "usage"];
export const WEIGHT = { scene: 6, mood: 4, usage: 3, form: 2 };
export const DIMS = ["scene", "mood", "form", "usage"];

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function loadConfig(root) {
  return readJson(path.join(root, "kb.config.json"));
}

export function loadTaxonomy(root, cfg) {
  const raw = readJson(path.join(root, cfg.taxonomy));
  const alias = new Map(); // "dim:alias" -> canonical id
  const labels = new Map(); // "dim:id" -> label
  for (const [dim, d] of Object.entries(raw.dimensions)) {
    for (const v of d.values) {
      labels.set(`${dim}:${v.id}`, v.label);
      for (const a of [v.id, v.label, ...(v.aliases || [])]) {
        alias.set(`${dim}:${String(a).trim().toLowerCase()}`, v.id);
      }
    }
  }
  return { raw, alias, labels, dims: Object.keys(raw.dimensions) };
}

/** 把口语/别名归一成规范 id；不认识就返回 null，让调用方报错而不是静默吞掉 */
export function normalizeTag(taxo, dim, raw) {
  if (raw == null) return null;
  const key = `${dim}:${String(raw).trim().toLowerCase()}`;
  return taxo.alias.get(key) ?? null;
}

export function normalizeQuery(taxo, query) {
  const out = { keyword: query.keyword ? String(query.keyword).trim() : "" };
  const unknown = [];
  for (const dim of DIMS) {
    const raw = query[dim];
    const list = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    const ids = [];
    for (const r of list) {
      if (r === "" || r == null) continue;
      const id = normalizeTag(taxo, dim, r);
      if (id) ids.push(id);
      else unknown.push(`${dim}:${r}`);
    }
    out[dim] = [...new Set(ids)];
  }
  return { query: out, unknown };
}

export function loadCatalog(root, cfg) {
  const p = path.join(root, cfg.catalog);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  const entries = [];
  lines.forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    try {
      entries.push(JSON.parse(line));
    } catch (e) {
      throw new Error(`catalog 第 ${i + 1} 行不是合法 JSON: ${e.message}`);
    }
  });
  return entries;
}

export function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

export function scoreEntry(entry, q) {
  let score = 0;
  const hitDims = [];
  for (const dim of DIMS) {
    const want = q[dim] || [];
    if (!want.length) continue;
    const have = new Set(entry.tags?.[dim] || []);
    const hits = want.filter((w) => have.has(w));
    if (hits.length) {
      score += WEIGHT[dim] * hits.length;
      hitDims.push(dim);
    }
  }
  if (q.keyword) {
    const hay = [
      entry.caption,
      entry.id,
      ...(entry.tags?.scene || []),
      ...(entry.tags?.mood || []),
      ...(entry.tags?.form || []),
      ...(entry.tags?.usage || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (hay.includes(q.keyword.toLowerCase())) {
      score += 2;
      hitDims.push("keyword");
    }
  }
  return { score, hitDims };
}

/**
 * 配图检索。
 * - 默认只用 status=local 的条目（remote 素材未验证，不当配图用）
 * - strict+scene 时硬过滤，适合「必须对得上部门」的场合
 * - 全都不匹配时返回 fallback，而不是空结果，方便 UI 兜底
 */
export function pick(entries, taxo, query, opts = {}) {
  const allowRemote = opts.allowRemote ?? false;
  const n = Math.max(1, Number(opts.n) || 1);
  const strict = Boolean(opts.strict);
  const { query: q, unknown } = normalizeQuery(taxo, query);

  const pool = entries.filter((e) => allowRemote || e.status === "local");
  let scored = pool.map((e) => ({ entry: e, ...scoreEntry(e, q) }));

  if (strict && q.scene.length) {
    scored = scored.filter((s) => (s.entry.tags?.scene || []).some((t) => q.scene.includes(t)));
  }
  const anyAxis = DIMS.some((d) => q[d].length) || Boolean(q.keyword);
  const matched = anyAxis ? scored.filter((s) => s.score > 0) : scored;

  let fallback = false;
  let ranked = matched;
  if (anyAxis && matched.length === 0 && !strict) {
    fallback = true;
    ranked = scored;
  }
  ranked = [...ranked].sort((a, b) => b.score - a.score || String(a.entry.id).localeCompare(String(b.entry.id)));

  const seen = new Set();
  const droppedDuplicates = [];
  const picks = [];
  for (const s of ranked) {
    const key = s.entry.sha256 || s.entry.id;
    if (seen.has(key)) {
      droppedDuplicates.push(s.entry.id);
      continue;
    }
    seen.add(key);
    picks.push({ ...s.entry, _score: s.score, _hitDims: s.hitDims });
    if (picks.length >= n) break;
  }
  return { picks, fallback, droppedDuplicates, unknownTags: unknown, query: q };
}

export function buildIndex(entries, taxo) {
  const byTag = {};
  const byId = {};
  const untagged = [];
  const unknownTags = [];
  for (const e of entries) {
    byId[e.id] = { file: e.file, url: e.url || "", caption: e.caption || "", status: e.status, sha256: e.sha256 };
    let tagged = false;
    for (const dim of DIMS) {
      for (const t of e.tags?.[dim] || []) {
        tagged = true;
        const k = `${dim}:${t}`;
        if (!taxo.labels.has(k)) {
          unknownTags.push({ id: e.id, tag: k });
          continue;
        }
        (byTag[k] ||= []).push(e.id);
      }
    }
    if (!tagged) untagged.push(e.id);
  }
  const groups = new Map();
  for (const e of entries) {
    if (!e.sha256) continue;
    (groups.get(e.sha256) || groups.set(e.sha256, []).get(e.sha256)).push(e.id);
  }
  const duplicates = [...groups.values()].filter((g) => g.length > 1);
  return {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    local: entries.filter((e) => e.status === "local").length,
    remote: entries.filter((e) => e.status === "remote").length,
    byTag,
    byId,
    untagged,
    unknownTags,
    duplicates,
  };
}

/** 校验：文件存在、sha 对得上、标签在词表里、id 不重复 */
export function validateCatalog(entries, taxo, root) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  for (const e of entries) {
    const tag = e.id ? `[${e.id}]` : "[<无 id>]";
    if (!e.id) errors.push(`${tag} 缺少 id`);
    else if (ids.has(e.id)) errors.push(`${tag} id 重复`);
    else ids.add(e.id);
    if (!["local", "remote"].includes(e.status)) errors.push(`${tag} status 必须是 local 或 remote，实际 ${e.status}`);
    if (!e.caption) warnings.push(`${tag} 没有 caption，配图时只能靠标签`);
    if (e.status === "local") {
      if (!e.file) {
        errors.push(`${tag} local 条目缺 file`);
      } else {
        const abs = path.join(root, e.file);
        if (!fs.existsSync(abs)) errors.push(`${tag} 文件不存在: ${e.file}`);
        else {
          const bytes = fs.statSync(abs).size;
          if (e.bytes != null && e.bytes !== bytes) errors.push(`${tag} bytes 不符: 记录 ${e.bytes} / 实际 ${bytes}`);
          if (e.sha256) {
            const real = sha256File(abs);
            if (real !== e.sha256) errors.push(`${tag} sha256 不符: 记录 ${e.sha256.slice(0, 8)}… / 实际 ${real.slice(0, 8)}…`);
          } else errors.push(`${tag} local 条目缺 sha256`);
          // 扩展名骗人的最多：上游常把 jpg 存成 .png，CDN 会按扩展名发错 Content-Type
          const head = fs.readFileSync(abs).subarray(0, 12);
          const expect = EXT_OF_KIND[imageKind(head)];
          const ext = path.extname(e.file).toLowerCase();
          if (expect && ext !== expect && !(expect === ".jpg" && ext === ".jpeg")) {
            warnings.push(`${tag} 扩展名 ${ext} 与真实格式 ${expect} 不符，跑 npm run tag 会自动改名`);
          }
        }
      }
    } else if (!e.url) {
      warnings.push(`${tag} remote 条目没有 url，无法直接引用`);
    }
    for (const dim of Object.keys(e.tags || {})) {
      if (!DIMS.includes(dim)) errors.push(`${tag} 未知维度 ${dim}`);
      for (const t of e.tags[dim] || []) {
        if (!taxo.labels.has(`${dim}:${t}`)) errors.push(`${tag} 词表外标签 ${dim}:${t}`);
      }
    }
  }
  return { errors, warnings, stats: { total: entries.length, ids: ids.size } };
}

/** 生成可直接粘进回复的 markdown / html */
export function render(entry, format = "md") {
  const alt = `大肥鱼 · ${entry.caption || entry.id}`;
  const title = [
    ...(entry.tags?.scene || []),
    ...(entry.tags?.mood || []),
    ...(entry.tags?.form || []),
  ].join(" / ");
  if (format === "html") return `<img src="${entry.file}" alt="${alt}" title="${title}" width="240" />`;
  if (format === "url") return entry.file;
  return `![${alt}](${entry.file} "${title}")`;
}
