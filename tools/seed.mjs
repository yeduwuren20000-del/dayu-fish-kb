// 生成离线 fixture（会覆盖 manifest/catalog.jsonl）
import { ROOT } from "../lib/cli.mjs";
import { seedFixture } from "../lib/fixture.mjs";

const { entries, dir } = seedFixture(ROOT);
console.log(`✓ 写入 ${entries.length} 个 fixture → ${dir}`);
console.log(`✓ 重建 ${entries.length} 条 catalog 记录`);
console.log("下一步：npm run build && npm run pick -- --scene 封驳");
