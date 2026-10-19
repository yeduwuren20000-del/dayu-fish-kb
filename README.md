# dayu-fish-kb · 蓝色大肥鱼配图知识库

把「蓝色大肥鱼」（DeepSeek 娘 / 鲸鱼娘）散落在各个仓库里的**二次元插画与表情包**，收成一份**可检索、可追溯、可直接贴进回复**的知识库。目标不是再做一个图包，而是让「该配哪张图」变成一次查询。

> 结论先说：GitHub 上**已经有**专门收集大肥鱼的仓库，但都停在「一堆文件 + 一个预览页」。缺的是标签、去重、来源账本和检索接口——这个仓补的就是这一层。上游清单见 [上游仓库](#上游仓库现状)。

---

## 它解决什么

配图的真实痛点是三件事，不是缺图：

| 痛点 | 本仓的做法 |
| --- | --- |
| 图多但不知道哪张对 | 四维受控词表（场景 / 情绪 / 形态 / 用途位），口语别名自动归一（`封驳`→`menxia-fengbo`） |
| 同一个梗存了八遍 | sha256 去重，重复项保留最匹配的一张并如实报告被压掉的 id |
| 素材来源说不清、不敢用 | 每条记录带 `credit` / `license` / 上游 `url`，`manifest/upstreams.json` 就是来源账本 |
| 换个人接手就废 | 纯 JSONL + 无依赖 Node 脚本，`verify` 会抓出文件丢失、哈希不符、词表外标签 |

设计上的两个硬决定：

1. **仓库默认不存原图**，只存元数据 + 上游 URL（`status: remote`），需要本地缓存时再 `fetch` 到 `data/raw/`（已 gitignore）。这样既避免二次分发，也避免仓库被 GIF 撑爆。
2. **抓进来的素材不自动入册**。`fetch` 只写 `manifest/catalog.draft.jsonl` 草稿；没打标就不参与配图（打分恒为 0，只在兜底里出现）。质量靠人工/模型过一眼，不靠猜。

---

## 快速开始

```bash
# 0) 体检：先看能不能连上 GitHub / jsDelivr
npm run doctor

# 1) 离线也能跑通全链路：生成 10 张 fixture（自动生成，可随时删）
npm run seed

# 2) 建索引（标签倒排 + 去重报告）
npm run build

# 3) 校验（文件存在？sha 对得上？标签在词表里？）
npm run verify

# 4) 配图
npm run pick -- --scene 封驳 --n 2
```

`pick` 输出可直接粘进 Markdown 回复：

```
![大肥鱼 · 封驳：缺验收口径，退回重拟](data/fixtures/fx-02-fengbo.png "menxia-fengbo / yihuo / qban")
```

### pick 参数

| 参数 | 说明 |
| --- | --- |
| `--scene` / `--for` | 使用场景，支持别名与逗号分隔：`--scene 封驳,拟令` |
| `--mood` `--form` `--usage` | 其余三维，同样支持别名 |
| `--keyword` / `-q` | 在 caption + 标签里做子串匹配 |
| `--n` | 返回条数，默认 1 |
| `--strict` | 给了场景就硬过滤，宁可少给也不混入别的部门 |
| `--allow-remote` | 允许返回只有 URL、没有本地文件的条目 |
| `--format` | `md`（默认）/ `html` / `json` / `list` |

打分权重 `scene 6 > mood 4 > usage 3 > form 2`，关键词 +2；同分按 id 升序，保证可复现。全部不命中时**退回全量并在 stderr 标 `fallback`**，让 UI 有兜底图，但不假装匹配成功。

---

## 三省六部场景表（本仓的默认配图约定）

| 场景 id | 触发节点 | 建议用法 |
| --- | --- | --- |
| `zhongshu-niling` | 中书省 · 拟令 | 正文顶部横幅或首图，`usage=inline` |
| `menxia-fengbo` | 门下封驳 / 退回 | 小图 + `usage=reaction`，别占版面 |
| `shangshu-paidan` | 尚书派单 | `usage=inline` |
| `liubu-zhixing` | 六部执行、跑命令 | `usage=inline` |
| `baogao-cuowu` | 报错、翻车 | `reaction`，语气要轻 |
| `dengdai` | 等待、思考中 | `reaction` |
| `qingzhu` | 通过、撒花 | `reaction` |
| `shouwei-jiean` | 结案交付 | `banner` |
| `wenzheng` | 问政司 · 一次性提问 | `inline` |

词表全量在 [`manifest/taxonomy.json`](manifest/taxonomy.json)。改词表不需要改代码；`verify` 会拦下词表外的标签。

---

## 仓库结构

```
kb.config.json            路径与默认参数
manifest/
  taxonomy.json           四维受控词表（唯一真源）
  upstreams.json          上游来源账本（含核实状态）
  catalog.jsonl           已入库条目，一行一条
  catalog.draft.jsonl     fetch 下来的待打标草稿（gitignore 可选）
lib/
  kb.mjs                  归一 / 校验 / 打分 / 索引 / 渲染
  png.mjs                 最小 PNG 编码器 + 魔数识别（无依赖）
  fixture.mjs             离线 fixture 生成
  cli.mjs                 参数解析
tools/
  doctor.mjs  seed.mjs  build.mjs  verify.mjs  pick.mjs  tag.mjs  fetch.mjs
tests/kb.test.mjs         11 条自测，全离线
index/index.json          构建产物：标签倒排 + byId + 去重组
```

### 条目格式

```json
{
  "id": "brickaz-emotes/001",
  "kind": "gif",
  "status": "local",
  "file": "data/raw/brickaz-emotes/001.gif",
  "url": "https://cdn.jsdelivr.net/gh/BrickAZ/deepseek-chan-emotes@latest/001.gif",
  "bytes": 812343,
  "sha256": "…",
  "tags": { "scene": ["menxia-fengbo"], "mood": ["yihuo"], "form": ["qban", "dongtai"], "usage": ["reaction"] },
  "caption": "封驳：材料不全，给你打回去",
  "credit": "BrickAZ",
  "license": "未标注（需向作者确认）"
}
```

`status: remote` 用于只登记来源、暂不下载的条目；`pick` 默认不给它出场机会。

---

## 接真实素材

```bash
npm run doctor                                  # 先确认在线
npm run fetch -- --upstream brickaz-emotes --dry-run   # 只列文件，不下载
npm run fetch -- --upstream brickaz-emotes --limit 40  # 下载到 data/raw/，写草稿
npm run tag -- --id brickaz-emotes/001 \
  --scene 封驳 --mood 疑惑 --form Q版,动图 --usage reaction \
  --caption "封驳：材料不全，给你打回去" --credit BrickAZ
npm run build && npm run verify
```

手动加一张本地图（会自动纠正扩展名与真实格式不符的情况）：

```bash
npm run tag -- --id local/0001 --new --file data/manual/0001.gif \
  --scene 庆祝 --mood 得意 --usage reaction --caption "通过，撒花"
```

`fetch` 的路由链：**jsDelivr 包清单 → GitHub Git Trees → 失败即报错**。下载时按魔数识别真实格式（png/gif/webp/jpg），认不出的直接跳过，不信扩展名。

---

## 上游仓库现状

以下条目**已用 GitHub Trees API 实测拉取文件清单**（2026-10-19，直连 Node fetch），数量为仓内真实可下载的图片/GIF 个数：

| 仓库 | 实测素材数 | 内容 | 备注 |
| --- | --- | --- | --- |
| [lmy414/ai-girl-stickers](https://github.com/lmy414/ai-girl-stickers) | 3026（其中 `blue-fish-originals/` 59） | AI 娘二创表情包开放档案 | **首选**：`blue-fish-originals/` 是大肥鱼原档 |
| [EDMOK/blue-fish-archive](https://github.com/EDMOK/blue-fish-archive) | 826 | 「蓝色大肥鱼档案馆」 | 量大，但混有 QR 码 / og-card 等非素材 |
| [the-beating-light-of-the-nail/deepseek-chan-meme-pack](https://github.com/the-beating-light-of-the-nail/deepseek-chan-meme-pack) | 20 | meme 合辑 | 全是 `previews/*.webp` |
| [5V1A-afk/dsh-sticker-pack](https://github.com/5V1A-afk/dsh-sticker-pack) | 15 | 提供 `sticker_pick` 的贴图包 | 与配图场景最贴，单张常 > 8MB（会被上限跳过） |
| [zhouwu97/ds-pet](https://github.com/zhouwu97/ds-pet) | 7 | 若叶睦形态大肥鱼 | 对应 `form=ruoyemu` |
| [BrickAZ/deepseek-chan-emotes](https://github.com/BrickAZ/deepseek-chan-emotes) | 3（`previews/` 下） | 宣称 161 个 GIF | 主体可能放在 release / 其他分支，未核实完 |
| [zhaoolee/ChineseBQB #167](https://github.com/zhaoolee/ChineseBQB/issues/167) | —（Issue） | 鲸鱼娘合集 128 张的收录提案 | 可当外部去重对照 |
| [roseion/dsh-dayu-fish-skin](https://github.com/roseion/dsh-dayu-fish-skin) | —（皮肤仓） | 皮肤项目，内含 `SOURCES.md` | 来源账本，交叉引用价值高 |

如果只想「马上有图用」，`dsh-sticker-pack` 或 `lmy414/ai-girl-stickers` 直接拿；要**按场景检索 + 可追溯 + 可扩**，再叠这个仓。

### 实测记录（本仓已跑通，不是设想）

```text
$ npm run fetch -- --upstream lmy414-ai-girl-stickers --contains blue-fish-originals/ --limit 6
  按 --contains "blue-fish-originals/" 过滤：3026 → 59
✓ 入盘 6 个，跳过/失败 1 个            # 跳过的是 LFS 403
$ npm run fetch -- --upstream dsh-sticker-pack --limit 4
✓ 入盘 4 个，跳过/失败 1 个            # 跳过的是 >8MB 的 GIF

$ npm run build
  条目 12（local 12 / remote 0）  标签桶 23  未打标 0  词表外标签 0
$ npm run verify
  条目 12，唯一 id 12，错误 0，警告 0   结论：通过
$ npm run pick -- --scene 结案 --n 2
![大肥鱼 · 都怪我是只可爱的小肥鱼，太有魅力了](data/raw/dsh-sticker-pack/stickers/2d1017a0….jpg "shouwei-jiean / deyi / qban")
![大肥鱼 · 结案：证据齐了，交付清单](data/fixtures/fx-07-jiean.png "shouwei-jiean / deyi / default")
```

还有一道守门值得知道：`tag` 入库时会按**魔数**核对真实格式，与扩展名不符就自动改名并留档；`verify` 也会对这类「扩展名骗人」发警告。原因是 jsDelivr 按扩展名发 `Content-Type`，不改名贴进渲染器会解码失败。本次 10 个样本魔数与扩展名全部一致（`.png` 确为 PNG、`.jpg` 确为 JPEG），没触发这条——但守卫先备好了，因为上游仓是众包的，混格式是迟早的事。

---

## 版权与署名

- 本仓**不主张**任何上游素材的版权，`license` 字段只记录上游声明；标 `未标注` 的条目在商用前必须向原作者确认。
- 默认 `status: remote`、仓库不存原图，就是为了避免二次分发。
- 投稿请保留作者名与原链接；`credit` 为空会被 `verify` 记警告。

## 已知限制

- **网络只有一半通路**：Node 的 `fetch` 直连 GitHub / jsDelivr 正常（已实测 200），但本机 `HTTPS_PROXY=127.0.0.1:7890` 指向一个没起来的代理，PowerShell / curl / `github_*` 工具走它都会失败。于是 `fetch` 特意只用 Node fetch 直连、不读代理环境变量。
- **`git` 稀疏拉取路由用不了**：沙箱禁用了 Node 的子进程（`spawn EPERM`），`child_process` 起不来，所以 `node --test <目录>` 也会挂——测试脚本改成直接 `node tests/kb.test.mjs` 跑在进程内。当前 `fetch` 的两条路由都不依赖 git。
- 上游有 LFS / 大文件：实测遇到 1 个 403（LFS 指针）和 1 个 > 8MB 的 GIF，前者需要 `git lfs`（当前不可用），后者被 `MAX_BYTES` 主动跳过。
- `BrickAZ/deepseek-chan-emotes` 声明的 161 个 GIF 在默认分支树上只有 3 个，主体未定位。
- 压缩包内素材（`*.zip` / `*.7z`）不解包，需人工解到 `data/raw/<upstream>/` 后 `tag --new`。
- 未做图片内容理解（自动打标），标签靠人工或模型逐条过；已入库的 2 张真图是看图后手打的标签。
- 未做 GIF 帧级去重 / 近似去重，只按整文件 sha256。

## 下一步

- [ ] 网络恢复后逐仓 `fetch --dry-run` 核对路径，把 `upstreams.json` 的 `metadata-only` 改成 `verified`
- [ ] 加 `phash` 近似去重（同图不同压缩/尺寸）
- [ ] `pick --for 报错` 这类「节点 → 场景」映射固化成配置，省掉每次查表
- [ ] 导出 `index.json` 的静态检索页（纯前端，无后端）
- [ ] 与 DSH 侧 `sticker_pick` 对齐参数，避免两套调用约定

## License

脚本与文档 MIT。素材版权归各原作者，见 `manifest/upstreams.json`。
