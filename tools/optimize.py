#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把入库的原图压成配图友好尺寸。

为什么要它：上游素材是「分享原图」逻辑（PNG 动辄 5MB、GIF 8MB），
直接贴进回复/UI 会拖慢加载；而配图真正需要的长边是 800~1600，够了。

策略（按用途优先，其次形态）：
  usage=avatar   -> 长边 512   q74
  usage=banner   -> 长边 1600  q80
  usage=reaction -> 长边 800   q72   （表情，小一点更好贴）
  form=qban/dongtai -> 长边 800 q74
  其它           -> 长边 1400  q80
动图保留动画（animated WebP，最多 60 帧），静态图转 WebP；EXIF/元数据全部丢弃。
另出 320px 缩略图给索引/预览用。

输出：
  data/opt/<owner>__<name>.webp
  data/thumb/<owner>__<name>.webp
  manifest/optimized.jsonl        （侧车，一行一个源条目；catalog 保持人工可读）
用法：
  python tools/optimize.py [--force] [--only <id 子串>] [--max-edge N]
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageSequence
except ImportError:  # pragma: no cover
    sys.exit("缺少 Pillow：本仓用随包 Python（含 Pillow 12.x），不要用系统 python")

ROOT = Path(__file__).resolve().parent.parent
# Windows 控制台默认 GBK，直接 print 会炸在 ✓ 上；统一按 UTF-8 输出
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
DEFAULTS = {
    "catalog": "manifest/catalog.jsonl",
    "optimized": "manifest/optimized.jsonl",
    "optimizeDir": "data/opt",
    "thumbDir": "data/thumb",
}
THUMB_EDGE = 320
THUMB_Q = 68
MAX_FRAMES = 40


def load_cfg():
    p = ROOT / "kb.config.json"
    cfg = dict(DEFAULTS)
    if p.exists():
        cfg.update(json.loads(p.read_text(encoding="utf-8")))
    for k in ("catalog", "optimized", "optimizeDir", "thumbDir"):
        if k in cfg and cfg[k]:
            continue
        cfg[k] = DEFAULTS[k]
    return cfg


def read_jsonl(p):
    if not p.exists():
        return []
    out = []
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError as e:
            raise SystemExit(f"{p.name} 第 {i} 行不是合法 JSON: {e}")
    return out


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def slug_of(entry_id):
    s = entry_id.replace("\\", "/").strip("/")
    s = s.replace("../", "").replace("/", "__")
    safe = "".join(ch if (ch.isalnum() or ch in "-_.") else "_" for ch in s)
    return safe[:150] or "unnamed"


def policy_for(entry, cap):
    tags = entry.get("tags") or {}
    usage = set(tags.get("usage") or [])
    form = set(tags.get("form") or [])
    if "avatar" in usage:
        edge, q = 512, 74
    elif "banner" in usage:
        edge, q = 1600, 80
    elif "reaction" in usage:
        edge, q = 800, 72
    elif form & {"qban", "dongtai"}:
        edge, q = 800, 74
    else:
        edge, q = 1400, 80
    return min(edge, cap), q


def fit(im, edge):
    w, h = im.size
    long_edge = max(w, h)
    if long_edge <= edge:
        return im
    scale = edge / float(long_edge)
    return im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)


def flatten(im):
    """统一成 WebP 能稳定吃下的模式，同时清掉 ICC/EXIF 等元数据。"""
    mode = im.mode
    if mode in ("P", "LA", "PA"):
        return im.convert("RGBA")
    if mode == "L":
        return im.convert("RGB")
    if mode == "CMYK":
        return im.convert("RGB")
    return im


def dhash(im, size=8):
    """dHash：灰度缩到 9x8，逐行比相邻像素，得 64bit（16 个 hex 字符）。

    为什么在 Python 算：Node 侧零依赖解不了 WebP/PNG，但压图本来就要解码，
    顺手把指纹带进侧车 optimized.jsonl，Node 只做汉明距离比较。
    动图取首帧（与缩略图口径一致）。
    ⚠ 透明素材必须先合成到白底：PIL 的 convert("L") 对 RGBA 是直接丢 alpha，
    透明区残留的 RGB 值会让指纹完全不可比（实测同一张图两种留底能差到 15+ bit）。
    """
    if im.mode in ("RGBA", "LA", "PA"):
        im = im.convert("RGBA")
        base = Image.new("RGBA", im.size, (255, 255, 255, 255))
        base.alpha_composite(im)
        im = base.convert("RGB")
    g = im.convert("L").resize((size + 1, size), Image.Resampling.BILINEAR)
    px = list(g.getdata())
    bits = 0
    for row in range(size):
        base_idx = row * (size + 1)
        for col in range(size):
            bits = (bits << 1) | (1 if px[base_idx + col] > px[base_idx + col + 1] else 0)
    return format(bits, "016x")


def optimize_one(src, entry, cap):
    edge, quality = policy_for(entry, cap)
    with Image.open(src) as im:
        frames = getattr(im, "n_frames", 1) or 1
        if frames > 1:
            # 动图额外收紧：贴图场景 600KB 以上就开始拖加载，宁可掉点画质
            edge, quality = min(edge, 560), min(quality, 56)
            kept, durations = [], []
            for idx, frame in enumerate(ImageSequence.Iterator(im)):
                if idx >= MAX_FRAMES:
                    break
                kept.append(fit(flatten(frame.copy()), edge))
                durations.append(int(frame.info.get("duration") or im.info.get("duration") or 80))
            first = kept[0]
            w, h = first.size
            return {
                "animated": True,
                "frames": len(kept),
                "width": w,
                "height": h,
                "quality": quality,
                "dhash": dhash(first),
                "save": lambda out: first.save(
                    out, "WEBP", save_all=True, append_images=kept[1:], duration=durations,
                    loop=0, quality=quality, method=6,
                ),
                # 缩略图只取首帧：列表里一堆动图会拖死渲染
                "thumb_save": lambda out: fit(first, THUMB_EDGE).save(out, "WEBP", quality=THUMB_Q, method=6),
            }
        still = fit(flatten(im.copy()), edge)
        w, h = still.size
        return {
            "animated": False,
            "frames": 1,
            "width": w,
            "height": h,
            "quality": quality,
            "dhash": dhash(still),
            "save": lambda out: still.save(out, "WEBP", quality=quality, method=6),
            "thumb_save": lambda out: fit(still, THUMB_EDGE).save(out, "WEBP", quality=THUMB_Q, method=6),
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="忽略侧车记录，全部重压")
    ap.add_argument("--only", default=None, help="只处理 id 含该子串的条目")
    ap.add_argument("--max-edge", type=int, default=1920, help="全局长边上限（兜底）")
    ap.add_argument("--no-draft", action="store_true", help="只压已打标的 catalog，不碰草稿")
    ap.add_argument(
        "--allow-missing",
        action="store_true",
        help="源文件缺失只告警不报错（CI 上原图不入库；也可用 DAYU_ALLOW_MISSING=1）",
    )
    args = ap.parse_args()

    cfg = load_cfg()
    cat_path = ROOT / cfg["catalog"]
    opt_path = ROOT / cfg["optimized"]
    opt_dir = ROOT / cfg["optimizeDir"]
    thumb_dir = ROOT / cfg["thumbDir"]
    opt_dir.mkdir(parents=True, exist_ok=True)
    thumb_dir.mkdir(parents=True, exist_ok=True)

    entries = [e for e in read_jsonl(cat_path) if e.get("status") == "local" and e.get("file")]
    known = {e["id"] for e in entries}
    if not args.no_draft:
        # 草稿也压：拉下来还没打标的图先出预览版，打标后直接复用，不用重压
        draft_path = cat_path.with_name("catalog.draft.jsonl")
        for e in read_jsonl(draft_path):
            if e.get("status") == "local" and e.get("file") and e["id"] not in known:
                e = dict(e, draft=True)
                entries.append(e)
                known.add(e["id"])
    if args.only:
        entries = [e for e in entries if args.only in e["id"]]
    if not entries:
        print("没有可优化的 local 条目（先 npm run fetch / npm run tag）")
        return 1

    prev = {r["id"]: r for r in read_jsonl(opt_path) if r.get("id")}
    records, skipped, failed, missing = [], 0, [], []
    allow_missing = args.allow_missing or os.environ.get("DAYU_ALLOW_MISSING") == "1"

    for e in entries:
        src = ROOT / e["file"]
        if not src.exists():
            if allow_missing:
                missing.append(e["id"])
                # 保留上一次的侧车记录：CI 上文件不在，但本地那份记录仍然有效，
                # 不能因为 CI 跑一遍就把 12 条本地记录从 optimized.jsonl 里抹掉
                if e["id"] in prev:
                    records.append(prev[e["id"]])
            else:
                failed.append((e["id"], "源文件不存在"))
            continue
        src_sha = sha256_file(src)
        slug = slug_of(e["id"])
        out = opt_dir / f"{slug}.webp"
        thumb = thumb_dir / f"{slug}.webp"
        old = prev.get(e["id"])
        # 老记录没有 dhash 也要重压一次，否则近似去重漏掉它
        if (
            not args.force
            and old
            and old.get("srcSha256") == src_sha
            and old.get("dhash")
            and out.exists()
            and thumb.exists()
        ):
            records.append(old)
            skipped += 1
            continue
        try:
            job = optimize_one(src, e, args.max_edge)
            job["save"](out)
            job["thumb_save"](thumb)
        except Exception as exc:  # 单张失败不该拖垮整批
            failed.append((e["id"], f"{type(exc).__name__}: {exc}"))
            continue
        rec = {
            "id": e["id"],
            "src": e["file"],
            "srcBytes": src.stat().st_size,
            "srcSha256": src_sha,
            "opt": out.relative_to(ROOT).as_posix(),
            "optBytes": out.stat().st_size,
            "optSha256": sha256_file(out),
            "thumb": thumb.relative_to(ROOT).as_posix(),
            "thumbBytes": thumb.stat().st_size,
            "width": job["width"],
            "height": job["height"],
            "frames": job["frames"],
            "animated": job["animated"],
            "quality": job["quality"],
            "dhash": job["dhash"],
            "draft": bool(e.get("draft")),
        }
        records.append(rec)
        saved = 1 - rec["optBytes"] / rec["srcBytes"] if rec["srcBytes"] else 0
        print(
            f"✓ {e['id'][:58]:<58} {rec['srcBytes']/1048576:5.2f}MB -> {rec['optBytes']/1024:6.0f}KB "
            f"({saved:+.0%}) {rec['width']}x{rec['height']}"
            + (f" {rec['frames']}帧" if rec["animated"] else "")
        )

    records.sort(key=lambda r: r["id"])
    tmp = opt_path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(tmp, opt_path)

    tin = sum(r["srcBytes"] for r in records)
    tout = sum(r["optBytes"] for r in records)
    tthumb = sum(r["thumbBytes"] for r in records)
    print(
        f"\n合计 {len(records)} 条（本次压缩 {len(records)-skipped}，跳过已是最新 {skipped}，失败 {len(failed)}）"
        f"\n  原图 {tin/1048576:.2f} MB -> 优化 {tout/1048576:.2f} MB，省 "
        f"{tin-tout:,.0f} 字节（{(1-tout/tin) if tin else 0:.0%}）；缩略图另 {tthumb/1024:.0f} KB"
    )
    for i, why in failed:
        print(f"  ✗ {i}: {why}")
    if missing:
        print(f"  ⚠ 源文件缺失 {len(missing)} 条（allow-missing，跳过）：{', '.join(missing[:3])}{' …' if len(missing) > 3 else ''}")
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main())
