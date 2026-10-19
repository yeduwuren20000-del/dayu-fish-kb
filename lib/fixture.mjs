// 生成离线 fixture：没有网络也能把「建索引 → 检索 → 出 markdown」整条链路跑通。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { makePng } from "./png.mjs";

/** 每个 fixture 的确定性色相，保证同一 index 每次生成字节一致 */
function pixelFor(seed) {
  return (x, y) => {
    const r = (seed * 37 + x * 3) & 0xff;
    const g = (seed * 91 + y * 5) & 0xff;
    const b = (200 + seed * 7 + ((x * y) % 40)) & 0xff;
    return [r, g, b];
  };
}

const SPECS = [
  { id: "fx-01-niling", w: 320, h: 200, seed: 1, caption: "拟令：先划范围、验收、预算", tags: { scene: ["zhongshu-niling"], mood: ["renzhen"], form: ["default"], usage: ["inline"] } },
  { id: "fx-02-fengbo", w: 240, h: 240, seed: 2, caption: "封驳：缺验收口径，退回重拟", tags: { scene: ["menxia-fengbo"], mood: ["yihuo"], form: ["qban"], usage: ["reaction"] } },
  { id: "fx-03-paidan", w: 320, h: 180, seed: 3, caption: "派单：礼部查源，工部落仓", tags: { scene: ["shangshu-paidan"], mood: ["guaiqiao"], form: ["qban"], usage: ["inline"] } },
  { id: "fx-04-zhixing", w: 320, h: 220, seed: 4, caption: "六部施工：脚本、词表、测试一起落", tags: { scene: ["liubu-zhixing"], mood: ["renzhen"], form: ["nvpu"], usage: ["inline"] } },
  // 与 fx-03 字节完全相同：用来验证 sha256 去重
  { id: "fx-05-dup-of-paidan", w: 320, h: 180, seed: 3, caption: "重复素材（去重样例）", tags: { scene: ["liubu-zhixing"], mood: ["bailan"], form: ["qban"], usage: ["inline"] } },
  { id: "fx-06-baogao", w: 300, h: 200, seed: 6, caption: "报错：三条路由全挂，翻车现场", tags: { scene: ["baogao-cuowu"], mood: ["zhuakuang"], form: ["qban"], usage: ["inline"] } },
  { id: "fx-07-jiean", w: 640, h: 200, seed: 7, caption: "结案：证据齐了，交付清单", tags: { scene: ["shouwei-jiean"], mood: ["deyi"], form: ["default"], usage: ["banner"] } },
  { id: "fx-08-dengdai", w: 240, h: 240, seed: 8, caption: "等待：鲸鱼本体已经睡着", tags: { scene: ["dengdai"], mood: ["shui"], form: ["jingyu"], usage: ["reaction"] } },
  { id: "fx-09-qingzhu", w: 240, h: 240, seed: 9, caption: "通过：撒花，可以下班了", tags: { scene: ["qingzhu"], mood: ["deyi"], form: ["qban"], usage: ["reaction"] } },
  { id: "fx-10-wenzheng", w: 320, h: 180, seed: 10, caption: "问政：只问一次，选哪个方案", tags: { scene: ["wenzheng"], mood: ["yihuo"], form: ["qban"], usage: ["inline"] } },
];

/**
 * 在 root 下写入 data/fixtures/*.png 并覆盖 manifest/catalog.jsonl
 * @returns {{ entries: object[], dir: string }}
 */
export function seedFixture(root) {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, "kb.config.json"), "utf8"));
  const dir = path.join(root, cfg.dataDir, "fixtures");
  fs.mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const s of SPECS) {
    const buf = makePng(s.w, s.h, pixelFor(s.seed));
    const file = path.posix.join(cfg.dataDir, "fixtures", `${s.id}.png`);
    fs.writeFileSync(path.join(root, ...file.split("/")), buf);
    entries.push({
      id: s.id,
      kind: "image",
      status: "local",
      file,
      url: "",
      w: s.w,
      h: s.h,
      bytes: buf.length,
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      tags: s.tags,
      caption: s.caption,
      credit: "fixture（自动生成，可删）",
      license: "demo-only",
    });
  }
  const catalog = path.join(root, cfg.catalog);
  fs.mkdirSync(path.dirname(catalog), { recursive: true });
  fs.writeFileSync(catalog, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return { entries, dir };
}

export { SPECS };
