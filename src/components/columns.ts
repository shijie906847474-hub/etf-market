export type ColumnKey =
  | "code"
  | "name"
  | "exchange"
  | "indexName"
  | "category"
  | "last"
  | "change"
  | "changePct"
  | "turnover"
  | "volume"
  | "turnoverRate"
  | "volumeRatio"
  | "bid1"
  | "ask1"
  | "spread"
  | "iopv"
  | "premiumPct"
  | "aum"
  | "managementFee"
  | "custodyFee"
  | "foundDate"
  | "ret5d"
  | "ret20d"
  | "ret60d"
  | "ret1y"
  | "status";

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
  align?: "left" | "right";
  numeric?: boolean;
}

export const COLUMNS: ColumnDef[] = [
  { key: "code", label: "代码", defaultVisible: true },
  { key: "name", label: "名称", defaultVisible: true },
  { key: "last", label: "最新价", defaultVisible: true, align: "right", numeric: true },
  { key: "changePct", label: "涨跌幅", defaultVisible: true, align: "right", numeric: true },
  { key: "turnover", label: "成交额", defaultVisible: true, align: "right", numeric: true },
  { key: "turnoverRate", label: "换手率", defaultVisible: true, align: "right", numeric: true },
  { key: "volumeRatio", label: "量比", defaultVisible: true, align: "right", numeric: true },
  { key: "premiumPct", label: "折溢价率", defaultVisible: true, align: "right", numeric: true },
  { key: "aum", label: "基金规模", defaultVisible: true, align: "right", numeric: true },
  { key: "indexName", label: "跟踪指数", defaultVisible: true },
  { key: "exchange", label: "交易所", defaultVisible: false },
  { key: "category", label: "ETF类型", defaultVisible: false },
  { key: "change", label: "涨跌额", defaultVisible: false, align: "right", numeric: true },
  { key: "volume", label: "成交量", defaultVisible: false, align: "right", numeric: true },
  { key: "bid1", label: "买一价", defaultVisible: false, align: "right", numeric: true },
  { key: "ask1", label: "卖一价", defaultVisible: false, align: "right", numeric: true },
  { key: "spread", label: "买卖价差", defaultVisible: false, align: "right", numeric: true },
  { key: "iopv", label: "IOPV", defaultVisible: false, align: "right", numeric: true },
  { key: "managementFee", label: "管理费率", defaultVisible: false, align: "right", numeric: true },
  { key: "custodyFee", label: "托管费率", defaultVisible: false, align: "right", numeric: true },
  { key: "foundDate", label: "基金成立日期", defaultVisible: false },
  { key: "ret5d", label: "近5日涨跌幅", defaultVisible: false, align: "right", numeric: true },
  { key: "ret20d", label: "近20日涨跌幅", defaultVisible: false, align: "right", numeric: true },
  { key: "ret60d", label: "近60日涨跌幅", defaultVisible: false, align: "right", numeric: true },
  { key: "ret1y", label: "近一年涨跌幅", defaultVisible: false, align: "right", numeric: true },
  { key: "status", label: "交易状态", defaultVisible: false },
];

export const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
