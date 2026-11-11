import { readFileSync } from "node:fs";
import { classifyTheme } from "../src/lib/themes";

const expected: Record<string, string> = {
  科创芯片设计: "半导体",
  科创芯片: "半导体",
  科创创业AI: "人工智能",
  科创AI: "人工智能",
  创业板人工智能: "人工智能",
  创业板算力: "算力",
  恒生科技指数: "港股科技",
  港股通互联网: "港股科技",
  港股通创新药: "港股医药",
  恒生生物科技指数: "港股医药",
  标普港股通低波红利指数: "港股红利",
  纳斯达克100: "美股",
  标普500: "美股",
  沪深300: "大盘宽基",
  上证50: "大盘宽基",
  中证A500: "中盘宽基",
  中证500: "中盘宽基",
  中证1000: "小盘宽基",
  中证2000: "小盘宽基",
  科创50: "科创",
  科创综指: "科创",
  创业板指: "创业板",
  活期存款利率: "货币",
  AAA科创债: "科创债",
  黄金9999: "黄金",
  SSH黄金股票: "黄金",
  中证红利: "红利",
  中证现金流: "现金流",
  金融科技: "金融科技",
  恒生A股电网设备指数: "电力",
  光伏产业: "光伏",
  CS电池: "电池/储能",
  CS新能车: "汽车",
  中证银行: "银行",
  证券公司: "券商/非银",
  日经225: "日本",
};

let failed = 0;
for (const [indexName, theme] of Object.entries(expected)) {
  const got = classifyTheme({ indexName, name: indexName + "ETF" });
  if (got !== theme) {
    failed += 1;
    console.log(`FAIL  ${indexName}: expected ${theme}, got ${got}`);
  }
}

const raw = JSON.parse(readFileSync(".data/f10-cache.json", "utf8")) as Record<
  string,
  { name: string | null; indexName: string | null; benchmark: string | null; fundType: string | null; level2Class: string | null }
>;

const byTheme = new Map<string, Map<string, number>>();
for (const prof of Object.values(raw)) {
  const theme = classifyTheme(prof);
  if (!byTheme.has(theme)) byTheme.set(theme, new Map());
  const idx = prof.indexName || "(empty)";
  const m = byTheme.get(theme)!;
  m.set(idx, (m.get(idx) ?? 0) + 1);
}

const summary = [...byTheme.entries()]
  .map(([theme, idxs]) => ({ theme, count: [...idxs.values()].reduce((s, n) => s + n, 0), unique: idxs.size, idxs }))
  .sort((a, b) => b.count - a.count);

console.log("\n=== theme distribution ===");
for (const s of summary) {
  console.log(`${String(s.count).padStart(4)}  ${s.theme}  (${s.unique} 个指数)`);
}

const other = summary.find((s) => s.theme === "其他主题" || s.theme === "宽基");
if (other) {
  console.log(`\n=== ${other.theme} leftover index names ===`);
  const items = [...other.idxs.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, n] of items) console.log(`${String(n).padStart(4)}  ${name}`);
}

if (failed) {
  console.log(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nall assertions passed");
