import type { EtfRow } from "./types";

/** 热点主题至少纳入的 ETF 只数，避免两三个微盘品种主导排行。 */
export const THEME_MIN_COUNT = 5;
export const THEME_HOTSPOT_LIMIT = 6;

export type ThemeInput = {
  name?: string | null;
  indexName?: string | null;
  indexCode?: string | null;
  benchmark?: string | null;
  fundType?: string | null;
  level2Class?: string | null;
  category?: string | null;
};

export interface ThemeStat {
  theme: string;
  count: number;
  up: number;
  down: number;
  flat: number;
  turnover: number;
  weightedReturn: number | null;
  equalReturn: number | null;
  representatives: { code: string; name: string; changePct: number | null; turnover: number | null }[];
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/指数/g, "")
    .replace(/etf/g, "")
    .replace(/基金/g, "");
}

function blobOf(input: ThemeInput): string {
  return norm([input.indexName, input.benchmark, input.name, input.fundType, input.level2Class].filter(Boolean).join(" "));
}

function hasAny(blob: string, keys: string[]): boolean {
  return keys.some((k) => containsToken(blob, norm(k)));
}

/** 关键字以数字结尾时，不匹配更长的数字（避免「中证A50」命中「中证A500」）。 */
function containsToken(blob: string, key: string): boolean {
  let from = 0;
  while (from <= blob.length - key.length) {
    const i = blob.indexOf(key, from);
    if (i < 0) return false;
    const after = blob[i + key.length];
    if (/\d$/.test(key) && after && /\d/.test(after)) {
      from = i + 1;
      continue;
    }
    return true;
  }
  return false;
}

function isHk(blob: string): boolean {
  // 恒生 A 股系列跟踪的是内地公司，不归入港股主题。
  if (blob.includes("恒生a股")) return false;
  return hasAny(blob, ["港股通", "港股", "恒生", "恒指", "香港"]);
}

function isUs(blob: string): boolean {
  if (hasAny(blob, ["标普港股", "标普中国"])) return false;
  return hasAny(blob, ["纳斯达克", "纳指", "标普500", "道琼斯", "msciusa", "msci usa"]);
}

/**
 * 按跟踪指数 / 基准 / 名称归入更细的投资主题。
 * 规则按「更具体优先」排列；无法归类时退回大类或「其他主题」。
 */
export function classifyTheme(input: ThemeInput): string {
  const blob = blobOf(input);
  const category = input.category ?? "";
  const fundType = input.fundType ?? "";

  if (category === "货币" || fundType.includes("货币") || hasAny(blob, ["活期存款", "通知存款", "货币市场"])) {
    return "货币";
  }
  if (hasAny(blob, ["科创债"])) return "科创债";
  if (hasAny(blob, ["转债", "可交换债"])) return "可转债";
  if (
    category === "债券" ||
    fundType.includes("债券") ||
    hasAny(blob, ["国债", "政金债", "地债", "城投债", "短融", "公司债", "信用债", "国开行"])
  ) {
    return "债券";
  }

  if (hasAny(blob, ["黄金", "上海金"])) return "黄金";
  if (hasAny(blob, ["油气", "原油", "oil&gas", "oilexploration"])) return "油气";
  if (hasAny(blob, ["豆粕"])) return "农产品";
  if (category === "商品" && hasAny(blob, ["能化", "有色金属", "商品"])) return hasAny(blob, ["有色"]) ? "有色金属" : "商品";

  if (isHk(blob)) {
    if (hasAny(blob, ["创新药", "医药", "医疗", "生物科技", "生物", "保健"])) return "港股医药";
    if (hasAny(blob, ["科技", "互联网", "信息"])) return "港股科技";
    if (hasAny(blob, ["汽车"])) return "港股汽车";
    if (hasAny(blob, ["红利", "高股息", "高息", "股息"])) return "港股红利";
    if (hasAny(blob, ["银行", "证券", "非银", "金融"])) return "港股金融";
    if (hasAny(blob, ["消费"])) return "港股消费";
    return "港股/恒生";
  }

  if (isUs(blob)) return "美股";
  if (hasAny(blob, ["日经", "东证"])) return "日本";
  if (hasAny(blob, ["德国", "dax", "法国", "cac", "巴西", "bovespa", "阿拉伯", "东南亚", "iedge", "亚太低碳"])) {
    return "海外其他";
  }

  if (hasAny(blob, ["芯片", "半导体", "集成电路"])) return "半导体";
  if (hasAny(blob, ["人工智能", "人工智", "科创ai", "科创创业ai"])) return "人工智能";
  if (hasAny(blob, ["算力"])) return "算力";
  if (hasAny(blob, ["机器人"])) return "机器人";
  if (hasAny(blob, ["金融科技"])) return "金融科技";
  if (hasAny(blob, ["云计算"])) return "云计算";
  if (hasAny(blob, ["软件", "信创", "工业互联"])) return "软件/信创";
  if (hasAny(blob, ["计算机"])) return "计算机";
  if (hasAny(blob, ["通信", "5g", "中证电信", "电信"])) return "通信";
  if (hasAny(blob, ["物联网"])) return "物联网";
  if (hasAny(blob, ["卫星", "航天", "航空航天", "通用航空", "全指航空"])) return "航天航空";
  if (hasAny(blob, ["军工", "国防"])) return "军工";
  if (hasAny(blob, ["电池", "储能"])) return "电池/储能";
  if (hasAny(blob, ["光伏"])) return "光伏";
  if (hasAny(blob, ["新能车", "新能源车", "智能电车", "智汽车", "汽车", "车联网", "汽车零部件"])) return "汽车";
  if (hasAny(blob, ["新能源", "创新能源", "绿色能源", "中证新能", "科创新能"])) return "新能源";
  if (hasAny(blob, ["电力", "电网", "绿色电力", "全指公用"])) return "电力";
  if (hasAny(blob, ["有色", "稀金属", "稀土"])) return "有色金属";
  if (hasAny(blob, ["煤炭", "钢铁", "全指能源", "中证能源", "800能源", "上证资源"])) return "周期资源";
  if (hasAny(blob, ["化工", "石化产业"])) return "化工";
  if (hasAny(blob, ["工程机械", "机床", "装备", "智能制造", "科创机械", "细分机械", "船舶"])) return "机械装备";
  if (hasAny(blob, ["基建", "建筑材料", "建材"])) return "基建";
  if (hasAny(blob, ["消费电子", "电子50", "cs电子"])) return "消费电子";
  if (hasAny(blob, ["创新药", "生物医药", "生物", "医药", "医疗", "中药", "疫苗", "制药", "生科", "器械", "保健"])) {
    return "医药";
  }
  if (hasAny(blob, ["家电", "家用电器", "家居家电"])) return "家电";
  if (
    hasAny(blob, [
      "食品",
      "饮料",
      "白酒",
      "中证酒",
      "消费龙头",
      "品牌消费",
      "800消费",
      "上证消费",
      "全指消费",
      "中证消费",
      "cs消费",
      "线上消费",
      "在线消费",
      "消费80",
      "消费服务",
      "智消费",
    ])
  ) {
    return "消费";
  }
  if (hasAny(blob, ["传媒", "影视", "动漫", "游戏", "文娱"])) return "传媒/游戏";
  if (hasAny(blob, ["粮食", "畜牧", "农业", "农牧", "养殖", "现代农", "大农业"])) return "农业";
  if (hasAny(blob, ["银行"])) return "银行";
  if (hasAny(blob, ["证券", "非银", "保险", "证保"])) return "券商/非银";
  if (hasAny(blob, ["地产", "房地产"])) return "地产";
  if (hasAny(blob, ["红利", "高股息", "高息", "股息"])) return "红利";
  if (hasAny(blob, ["现金流"])) return "现金流";
  if (hasAny(blob, ["央企", "国企"])) return "央企/国企";
  if (hasAny(blob, ["碳中和", "低碳", "环保", "长江保护"])) return "碳中和/环保";
  if (hasAny(blob, ["新材料", "科创材料"])) return "新材料";
  if (hasAny(blob, ["物流", "交运", "运输"])) return "运输物流";
  if (hasAny(blob, ["旅游"])) return "旅游";
  if (hasAny(blob, ["数字经济"])) return "数字经济";
  if (hasAny(blob, ["全指信息"])) return "计算机";
  if (hasAny(blob, ["互联网"])) return "互联网";
  if (hasAny(blob, ["中证数据", "数据要素"])) return "数据";
  if (hasAny(blob, ["信息安全"])) return "软件/信创";
  if (hasAny(blob, ["全指可选"])) return "消费";
  if (hasAny(blob, ["全指材料"])) return "新材料";
  if (hasAny(blob, ["浙江国资"])) return "央企/国企";
  if (hasAny(blob, ["esg", "持续发展"])) return "ESG";
  if (hasAny(blob, ["成渝", "湖北", "长三角", "杭州湾", "大湾区", "张江", "湾创", "g60"])) return "区域";
  if (hasAny(blob, ["中证vr"])) return "科技";
  if (hasAny(blob, ["科技龙头", "中证科技", "科技50", "科技100", "科技先锋", "创科技", "新兴科技", "tmt", "新经济"])) {
    return "科技";
  }

  // 宽基与市场风格：放在行业主题之后，避免「科创芯片」被收到科创。
  if (
    hasAny(blob, ["科创50", "科创100", "科创200", "科创综", "科创创业50", "科创成长", "科创价格", "科创信息", "智选科创"])
  ) {
    return "科创";
  }
  if (
    hasAny(blob, ["创业板指", "创业板50", "创业板综", "创业200", "创业300", "创业大盘", "创精选", "创价值", "创成长", "创业成长"])
  ) {
    return "创业板";
  }
  if (hasAny(blob, ["价值", "价值稳健"])) return "价值风格";
  if (hasAny(blob, ["成长", "成长创新"])) return "成长风格";
  if (
    hasAny(blob, [
      "沪深300",
      "上证50",
      "中证a50",
      "中证a100",
      "上证180",
      "富时中国a50",
      "msci中国a50",
      "超大盘",
      "上证指数",
      "上证综指",
      "深证成指",
      "深证成份",
      "深证50",
      "深主板50",
      "基本面50",
      "央视50",
    ])
  ) {
    return "大盘宽基";
  }
  if (
    hasAny(blob, [
      "中证a500",
      "中证800",
      "中证500",
      "沪港深500",
      "沪港深300",
      "上证380",
      "上证580",
      "上证中盘",
      "中证a股",
      "msci中国a股",
      "深证100",
      "深证300",
      "深证f120",
      "深证f60",
      "新兴成指",
      "小康指数",
    ])
  ) {
    return "中盘宽基";
  }
  if (hasAny(blob, ["中证1000", "中证2000", "国证2000", "中小100", "中创400"])) return "小盘宽基";

  if (category === "商品") return "商品";
  if (category === "跨境") return "海外其他";
  if (category === "宽基") return "宽基";
  return "其他主题";
}

function statsOf(theme: string, items: Pick<EtfRow, "code" | "name" | "changePct" | "turnover">[]): ThemeStat {
  const withPx = items.filter((x) => x.changePct !== null);
  const up = withPx.filter((x) => (x.changePct ?? 0) > 0).length;
  const down = withPx.filter((x) => (x.changePct ?? 0) < 0).length;
  const flat = withPx.filter((x) => (x.changePct ?? 0) === 0).length;
  const turnover = items.reduce((s, x) => s + (x.turnover ?? 0), 0);
  let weightedNum = 0;
  let weightedDen = 0;
  let eq = 0;
  let eqN = 0;
  for (const x of items) {
    if (x.changePct === null) continue;
    eq += x.changePct;
    eqN += 1;
    if (x.turnover && x.turnover > 0) {
      weightedNum += x.changePct * x.turnover;
      weightedDen += x.turnover;
    }
  }
  const representatives = [...items]
    .sort((a, b) => (b.turnover ?? -1) - (a.turnover ?? -1))
    .slice(0, 3)
    .map((x) => ({
      code: x.code,
      name: x.name,
      changePct: x.changePct,
      turnover: x.turnover,
    }));
  return {
    theme,
    count: items.length,
    up,
    down,
    flat,
    turnover,
    weightedReturn: weightedDen > 0 ? weightedNum / weightedDen : null,
    equalReturn: eqN > 0 ? eq / eqN : null,
    representatives,
  };
}

export function buildThemeStats(list: Array<ThemeInput & Pick<EtfRow, "code" | "name" | "changePct" | "turnover" | "status">>): ThemeStat[] {
  const groups = new Map<string, (ThemeInput & Pick<EtfRow, "code" | "name" | "changePct" | "turnover">)[]>();
  for (const row of list) {
    const theme = classifyTheme(row);
    const arr = groups.get(theme) ?? [];
    arr.push(row);
    groups.set(theme, arr);
  }
  return [...groups.entries()].map(([theme, items]) => statsOf(theme, items));
}

const HIDDEN_HOTSPOT_THEMES = new Set(["其他主题", "其他", "宽基"]);

export function buildThemeHotspots(
  list: Array<ThemeInput & Pick<EtfRow, "code" | "name" | "changePct" | "turnover" | "status">>,
  limit = THEME_HOTSPOT_LIMIT,
): ThemeStat[] {
  const active = list.filter((x) => x.status !== "终止上市");
  const qualified = buildThemeStats(active).filter(
    (s) => s.count >= THEME_MIN_COUNT && s.weightedReturn !== null && !HIDDEN_HOTSPOT_THEMES.has(s.theme),
  );
  return [...qualified].sort((a, b) => (b.weightedReturn ?? -999) - (a.weightedReturn ?? -999)).slice(0, limit);
}
