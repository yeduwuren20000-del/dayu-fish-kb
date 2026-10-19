import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 极简参数解析：--key value / --flag / 重复 --key 自动收成数组 */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const val = next === undefined || next.startsWith("--") ? true : (i++, next);
      if (key in out) out[key] = [].concat(out[key], val);
      else out[key] = val;
    } else {
      out._.push(a);
    }
  }
  return out;
}

/** 逗号或重复参数都支持：--scene 封驳,拟令 */
export function multi(v) {
  if (v == null || v === true) return [];
  return []
    .concat(v)
    .flatMap((s) => String(s).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
