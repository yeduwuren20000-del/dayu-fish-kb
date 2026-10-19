// 环境体检：工具链 + 到 GitHub / jsDelivr 的连通性。抓取前先跑这个。
import net from "node:net";
import { execFileSync } from "node:child_process";
import { ROOT } from "../lib/cli.mjs";

function tcp(host, port, ms = 4000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(ms);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
  });
}

async function http(url, ms = 8000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, err: String(e?.cause?.code || e?.name || e) };
  }
}

function ver(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0];
  } catch {
    return null;
  }
}

const rows = [];
rows.push(["node", process.version, "必需"]);
rows.push(["git", ver("git", ["--version"]) || "不可用（子进程被沙箱禁用，不代表没装）", "可选：git 稀疏拉取路由"]);
rows.push(["proxy HTTPS_PROXY", process.env.HTTPS_PROXY || process.env.https_proxy || "(未设置)", "仅 PowerShell/curl 会走它；Node fetch 默认直连"]);

const net1 = await tcp("github.com", 443);
const net2 = await tcp("data.jsdelivr.com", 443);
const api = await http("https://api.github.com/zen", 8000);
const cdn = await http("https://data.jsdelivr.com/v1/packages/gh/EDMOK/blue-fish-archive", 8000);

for (const r of rows) console.log(`${r[0].padEnd(22)} ${r[1].padEnd(34)} ${r[2]}`);
console.log("");
console.log(`${"github.com:443 (TCP)".padEnd(22)} ${String(net1).padEnd(34)} 仅供参考，沙箱下 TCP 探测不可靠`);
console.log(`${"jsdelivr:443 (TCP)".padEnd(22)} ${String(net2).padEnd(34)} 仅供参考`);
console.log(`${"api.github.com/zen".padEnd(22)} ${String(api.ok).padEnd(34)} HTTP ${api.status}${api.err ? " " + api.err : ""}`);
console.log(`${"jsdelivr 包元数据".padEnd(22)} ${String(cdn.ok).padEnd(34)} HTTP ${cdn.status}${cdn.err ? " " + cdn.err : ""}`);

// 判定只看真实 HTTP 能力，不看 TCP / 环境变量
const canGithub = api.ok;
const canCdn = cdn.ok;
console.log("");
if (!canGithub && !canCdn) {
  console.log("结论：离线。抓取层不可用，但 seed → build → pick → verify 与测试全部可离线跑。");
  console.log("修复建议：检查网络；Node fetch 直连，不受 HTTPS_PROXY 影响。");
} else if (canGithub && canCdn) {
  console.log("结论：在线（jsDelivr + GitHub API 都通），可以 `npm run fetch -- --upstream <id>`。");
  console.log("提示：匿名 GitHub API 限 60 次/小时，批量下载走 jsDelivr。");
} else {
  console.log(`结论：部分在线（jsDelivr=${canCdn} / GitHub API=${canGithub}），fetch 会按路由链降级。`);
}
console.log(`仓库根目录：${ROOT}`);
