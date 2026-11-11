import type { EtfCategory, FundProfile, TradeStatus } from "./types";

const BROAD_INDEX_NAMES = [
  "沪深300",
  "中证500",
  "中证1000",
  "中证2000",
  "中证800",
  "中证100",
  "中证A50",
  "中证A100",
  "中证A500",
  "中证A800",
  "上证50",
  "上证180",
  "上证380",
  "上证指数",
  "上证综指",
  "深证成指",
  "深证成份",
  "深证100",
  "创业板指",
  "创业板50",
  "创业板200",
  "科创50",
  "科创100",
  "科创综指",
  "科创创业50",
  "双创50",
  "北证50",
  "中证全指",
  "中证A股",
  "深证A指",
  "上证中盘",
  "中证200",
];

const INDUSTRY_KEYWORDS = [
  "银行",
  "证券",
  "券商",
  "保险",
  "非银",
  "房地产",
  "地产",
  "钢铁",
  "煤炭",
  "有色金属",
  "有色",
  "化工",
  "石油石化",
  "石化",
  "石油",
  "建材",
  "建筑",
  "机械",
  "电力设备",
  "电网",
  "电力",
  "公用事业",
  "汽车",
  "家用电器",
  "家电",
  "食品饮料",
  "饮料",
  "白酒",
  "调味发酵",
  "医药卫生",
  "医药生物",
  "全指医药",
  "中证医药",
  "医药",
  "医疗器械",
  "医疗服务",
  "生物医药",
  "电子",
  "半导体",
  "芯片",
  "计算机",
  "软件",
  "通信",
  "传媒",
  "国防军工",
  "军工",
  "交通运输",
  "物流",
  "航空运输",
  "机场",
  "港口",
  "公路",
  "农林牧渔",
  "农业",
  "养殖",
  "畜牧",
  "环保",
  "纺织服装",
  "纺织",
  "商贸零售",
  "零售",
  "全指信息",
  "全指消费",
  "全指金融",
  "全指能源",
  "全指材料",
  "全指工业",
  "全指公用",
  "中证能源",
  "中证材料",
  "中证工业",
  "中证可选",
  "中证消费",
  "中证金融地产",
  "中证金融",
  "中证信息",
  "中证电信",
  "中证公用",
];

const CROSS_BORDER_KEYWORDS = [
  "qdii",
  "恒生",
  "恒指",
  "恒生科技",
  "国企指数",
  "h股",
  "港股",
  "香港",
  "中概",
  "纳斯达克",
  "纳指",
  "标普500",
  "标普",
  "道琼斯",
  "日经",
  "德国",
  "法国",
  "欧洲",
  "印度",
  "越南",
  "沙特",
  "美债",
  "美国",
  "日本",
  "韩国",
  "亚洲",
  "全球",
  "海外",
  "跨境",
];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/指数/g, "");
}

function textBlob(profile: FundProfile | null): string {
  if (!profile) return "";
  return [profile.fundType, profile.level2Class, profile.indexName, profile.benchmark, profile.indexCode]
    .filter(Boolean)
    .join(" ");
}

function isBroadIndex(indexName: string | null, benchmark: string | null): boolean {
  const candidates = [indexName, benchmark].filter(Boolean) as string[];
  for (const raw of candidates) {
    const n = norm(raw);
    for (const broad of BROAD_INDEX_NAMES) {
      const b = norm(broad);
      if (n === b || n === `${b}全收益` || n === `${b}净收益`) return true;
    }
  }
  return false;
}

function isIndustryIndex(indexName: string | null, benchmark: string | null): boolean {
  const candidates = [indexName, benchmark].filter(Boolean) as string[];
  for (const raw of candidates) {
    const n = norm(raw);
    if (INDUSTRY_KEYWORDS.some((k) => n.includes(norm(k)))) return true;
  }
  return false;
}

function isCrossBorder(profile: FundProfile | null): boolean {
  const blob = norm(textBlob(profile));
  if (!blob) return false;
  if (blob.includes("qdii")) return true;
  return CROSS_BORDER_KEYWORDS.some((k) => blob.includes(norm(k)));
}

export function classifyEtf(profile: FundProfile | null): EtfCategory {
  if (!profile) return "其他";
  const fundType = (profile.fundType ?? "") + (profile.level2Class ?? "");
  if (fundType.includes("货币")) return "货币";
  if (fundType.includes("债券")) return "债券";
  if (fundType.includes("商品")) return "商品";
  if (fundType.includes("QDII") || fundType.includes("qdii") || fundType.includes("境外")) return "跨境";
  if (isCrossBorder(profile)) return "跨境";

  if (isBroadIndex(profile.indexName, profile.benchmark)) return "宽基";
  if (isIndustryIndex(profile.indexName, profile.benchmark)) return "行业";

  const looksEquity =
    fundType.includes("股票") ||
    fundType.includes("指数") ||
    Boolean(profile.indexName) ||
    Boolean(profile.benchmark);
  if (looksEquity) return "主题";
  return "其他";
}

export function detectStatus(name: string, last: number | null): TradeStatus {
  if (/退市|摘牌/.test(name)) return "终止上市";
  if (/暂停/.test(name)) return "暂停交易";
  if (last === null) return "无行情";
  return "正常上市";
}

export function extractTrackingErrorTarget(strategy: string | null | undefined): string | null {
  if (!strategy) return null;
  const m = strategy.match(/年化跟踪误差[^。；;]{0,24}/);
  if (m) return m[0].trim();
  const m2 = strategy.match(/跟踪误差[^。；;]{0,20}/);
  return m2 ? m2[0].trim() : null;
}
