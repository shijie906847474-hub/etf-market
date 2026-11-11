const SHANGHAI = "Asia/Shanghai";

export function formatShanghai(tsSec: number | null | undefined, withSeconds = true): string {
  if (!tsSec || !Number.isFinite(tsSec)) return "—";
  const d = new Date(tsSec * 1000);
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  });
  return fmt.format(d).replace(/\//g, "-") + " (Asia/Shanghai)";
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const s = value.replace("T", " ").slice(0, 10);
  return s || "—";
}

export function listedDateFromF26(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const s = String(v).replace(/\D/g, "");
  if (s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseFeePercent(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/%/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatNumber(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPrice(v: number | null | undefined, digits = 3): string {
  return formatNumber(v, digits);
}

export function formatPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export function formatMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return v.toFixed(0);
}

export function formatAum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(v / 1e8).toFixed(2)}亿`;
}

export function formatVolumeHands(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(2)}万手`;
  return `${v.toFixed(0)}手`;
}

export function changeClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "text-flat";
  return v > 0 ? "text-up" : "text-down";
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 运作费率 = 管理费率 + 托管费率；任一项缺失则无法给出完整总费率。销售服务费未接入时按 0。 */
export function operatingFeeOf(managementFee: number | null, custodyFee: number | null, salesServiceFee: number | null = 0): number | null {
  if (managementFee === null || custodyFee === null) return null;
  const sales = salesServiceFee ?? 0;
  return Number((managementFee + custodyFee + sales).toFixed(4));
}

/** 量比达到该阈值视为明显放大，用于放量上涨/下跌榜。 */
export const VOLUME_RATIO_SURGE = 1.5;
