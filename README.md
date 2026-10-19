# dayu-fish-kb · 蓝色大肥鱼配图知识库

[![update-kb](https://github.com/yeduwuren20000-del/dayu-fish-kb/actions/workflows/update.yml/badge.svg)](https://github.com/yeduwuren20000-del/dayu-fish-kb/actions/workflows/update.yml)

仓库：<https://github.com/yeduwuren20000-del/dayu-fish-kb>（每天 03:00 由 Actions 自动拉新）

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

# 2.5) 压图：原图 → 配图友好的 WebP（需要 Pillow，脚本会自动找带 Pillow 的 python）
npm run optimize

# 3) 校验（文件存在？sha 对得上？标签在词表里？优化版有没有被换？）
npm run verify

# 4) 配图
npm run pick -- --scene 封驳 --n 2

# 5) 一条命令跑完整流水线（拉新→压图→建索引→校验→报告）
npm run job
# 6) 接定时：用户态 daemon（不需要管理员）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\daemon.ps1
```

`pick` 输出可直接粘进 Markdown 回复（路径默认是压过的 WebP）：

```
![大肥鱼 · 封驳：缺验收口径，退回重拟](data/opt/fx-02-fengbo.webp "menxia-fengbo / yihuo / qban")
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
| `--raw` | 返回原图路径（默认给压过的 WebP） |
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
  optimized.jsonl         压图侧车：srcSha256 / opt / optBytes / 尺寸 / 帧数
lib/
  kb.mjs                  归一 / 校验 / 打分 / 索引 / 渲染 / 优化版 overlay
  png.mjs                 最小 PNG 编码器 + 魔数识别（无依赖）
  fixture.mjs             离线 fixture 生成
  cli.mjs                 参数解析
tools/
  doctor.mjs  seed.mjs  build.mjs  verify.mjs  pick.mjs  tag.mjs  fetch.mjs
  optimize.py             Pillow 压图（保留动图）+ 缩略图 + 侧车
  report.mjs              生成 reports/status.md 体检报告
scripts/
  job.ps1                 无人值守流水线（fetch→optimize→build→verify→report→commit）
  schedule.ps1            计划任务安装/移除/查看（schtasks，需普通终端）
  daemon.ps1              用户态守护进程（-At 03:30 / -EverySeconds / -Once）
  optimize.ps1            找对 python 再调 optimize.py 的包装器
.github/workflows/update.yml  CI 侧 cron 定时任务
tests/kb.test.mjs         11 条自测（检索/校验）
tests/optimize.test.mjs   6 条自测（优化版 overlay 与篡改守门）
data/opt/                 压过的 WebP（gitignore）
data/thumb/               320px 缩略图（gitignore）
reports/                  status.md / last-run.json / daemon.pid / daemon.log / logs/
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

## 压图：为什么必须有这一步

上游是「分享原图」逻辑，直接贴进回复会把加载拖死。实测 10 个真实素材 **28.9 MB**，最长边 2666px，塞进一次对话的插画位毫无意义。`tools/optimize.py`（Pillow，随包 Python，不装 ffmpeg/magick）按用途压：

| 用途 | 长边 | 质量 |
| --- | --- | --- |
| `usage=avatar` | 512 | q74 |
| `usage=banner` | 1600 | q80 |
| `usage=reaction` | 800 | q72 |
| 动图（GIF 多帧） | 560，最多 40 帧，保留动画 | q56 |
| 其它 | 1400 | q80 |

要点：

- **保留动画**：GIF 转 animated WebP（`save_all` + 逐帧时长），不是砍成一张静图。
- **砍元数据**：重编码即丢 EXIF/ICC，顺带避开「原图带定位信息」这类隐私问题。
- **另出 320px 缩略图**（`data/thumb/`）给索引和列表用，动图缩略图只取首帧。
- **幂等**：侧车 `manifest/optimized.jsonl` 记 `srcSha256`，源图没变就跳过；`--force` 强制重压。
- **可追溯**：`catalog.jsonl` 里仍指向原图，优化版只是侧车 overlay；`pick --raw` 随时回原图。

```bash
npm run optimize                  # 压全部（含未打标草稿，先出预览）
npm run optimize -- -Force        # 全部重压
npm run optimize -- -Only dsh     # 只压 id 含 dsh 的
```

---

## 定时执行

整条链路是 `scripts/job.ps1`：拉新 → 压图 → 建索引 → 校验 → 报告 →（可选）commit。定时只是「谁来喊它」，三种任选：

**1) 用户态守护进程（推荐，不用管理员）**

```powershell
# 每天 03:30 跑；Ctrl+C 停
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\daemon.ps1
# 换时间 / 立刻跑一次 / 自测每 5 秒跑一次
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\daemon.ps1 -At 09:00
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\daemon.ps1 -Once
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\daemon.ps1 -EverySeconds 5 -MaxRuns 2
```

它写 `reports/daemon.pid` 和 `reports/daemon.log`，每次运行前会把「下次运行时间」记进日志。想开机自启，把上面第一行丢进 `shell:startup` 的快捷方式即可。

**2) Windows 计划任务（时间更稳，但要在普通终端装）**

```powershell
npm run schedule -- -Action install   # 每天 03:30
npm run schedule -- -Action show      # 看下次运行时间
npm run schedule -- -Action run-now   # 立刻跑一次
npm run schedule -- -Action remove
```

⚠️ 在**沙箱 / 受限账户**里这条会失败（`schtasks` 连 RPC 命名管道都开不了，报 `ERROR: The system cannot find the path specified.`）。脚本会检测到并把可直接粘贴的一行 `schtasks /Create ...` 打出来——请到普通 PowerShell 窗口执行那行，或改用上面的 daemon。这不是仓库的 bug，是权限边界。

**3) GitHub Actions cron**（`.github/workflows/update.yml`，每天 UTC 19:00 = 北京 03:00）：把这仓推到远端，让 CI 定期拉新并回写 manifest；同样只提交 manifest 和报告。

CI 里**没有原图**（`data/` 在 `.gitignore` 里），所以 workflow 设了 `DAYU_ALLOW_MISSING=1`：源文件/优化版缺失只算警告，且 `optimized.jsonl` 里已有的本地记录会原样保留——CI 跑一遍不会把你本机那 20 条侧车记录冲掉。手动复现：`DAYU_ALLOW_MISSING=1 npm run verify`。

仓已推到 [yeduwuren20000-del/dayu-fish-kb](https://github.com/yeduwuren20000-del/dayu-fish-kb)，Actions 里 `update-kb` 状态 `active`。想立刻跑一次：在 Actions 页面点 **Run workflow**（对应 API `workflow_dispatch` 需要 token 带 `Actions: write`，本机这把细粒度 token 没这个权限，会返回 403——用网页点即可）。

`scripts/job.ps1` 的行为是可预期的失败，不是「静默成功」：

- `fetch` 失败**只告警不中断**（断网/代理挂了不该让后面白跑）；
- `verify` 失败**直接退出码 3**，并写进 `reports/last-run.json`；
- 每步耗时、日志落 `reports/logs/run-<时间戳>.log`；
- `-Commit` 时只提交 `manifest/*.jsonl` 与 `reports/status.md`，**原图永远不进 git**。

**体检报告**：`reports/status.md` 每次覆盖，含总量、最重的 5 张、各场景覆盖数、词表外标签——「哪一轴还空」一眼可见。

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
$ npm run optimize
  优化 20 条：30.49 MB → 2.93 MB（省 90%）  缩略图 47 KB
$ npm run verify
  条目 12，唯一 id 12，错误 0，警告 0
  优化版 20 条：30.49 MB → 2.93 MB（省 90%）   结论：通过
$ npm run pick -- --scene 结案 --n 2
![大肥鱼 · 都怪我是只可爱的小肥鱼，太有魅力了](data/opt/dsh-sticker-pack__stickers__2d1017a0….webp "shouwei-jiean / deyi / qban")
![大肥鱼 · 结案：证据齐了，交付清单](data/opt/fx-07-jiean.webp "shouwei-jiean / deyi / default")
```

`pick` 默认给**优化后的 WebP**（配图直接能用）；要原图加 `--raw`，路径回到 `data/raw/`。

压图前后的代表值：5.41 MB PNG → 149 KB（788×1400）、5.50 MB / 40 帧 GIF → 485 KB（421×560）、2.68 MB / 19 帧 GIF → 1.0 MB（540×540，动图保帧）。动图比静图压得狠一点是有意的——单张反应图超过 1 MB，贴进聊天流会明显卡。

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
- **压图依赖 Pillow**：用的是随 DSH 分发的 Python（`D:\...\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`，Pillow 12.3.0）。系统里的 `python` 可能没装 Pillow——`scripts\optimize.ps1` 会按 `DAYU_PYTHON` 环境变量 → 随包路径 → PATH 上 `python` 的顺序找，找不到就报错退出，不会假装成功。缩略图对动图只取首帧。
- **`scripts\*.ps1` 必须存成带 UTF-8 BOM**：Windows PowerShell 5.1 读无 BOM 的 UTF-8 会按 GBK 解码，中文字符串被拆坏后报 `Unexpected token '...'`。已全部带 BOM；以后再编辑这些脚本，记得保留 BOM。
- **沙箱内装不了 Windows 计划任务**：`schtasks` 连 RPC 都开不了（`ERROR: The system cannot find the path specified.`），`Register-ScheduledTask` 报「拒绝访问」。所以 `npm run schedule` 在沙箱里会走「打印命令 + 提示用 daemon」的分支；真要装，请到普通 PowerShell 窗口跑。

## 下一步

- [ ] 网络恢复后逐仓 `fetch --dry-run` 核对路径，把 `upstreams.json` 的 `metadata-only` 改成 `verified`
- [ ] 加 `phash` 近似去重（同图不同压缩/尺寸）
- [ ] `pick --for 报错` 这类「节点 → 场景」映射固化成配置，省掉每次查表
- [ ] 导出 `index.json` 的静态检索页（纯前端，无后端）
- [ ] 与 DSH 侧 `sticker_pick` 对齐参数，避免两套调用约定

## License

脚本与文档 MIT。素材版权归各原作者，见 `manifest/upstreams.json`。
