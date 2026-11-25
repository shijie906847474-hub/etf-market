import catalogJson from "@/data/index-handbook-catalog.json";

/** 编制方案与 typelist 名单的检索日期，时区 Asia/Shanghai。 */
export const INDEX_HANDBOOK_RETRIEVED_AT = catalogJson.retrievedAt;
export const INDEX_HANDBOOK_TIMEZONE = catalogJson.timezone;

export type CompilerGroup =
  | "中证"
  | "上证"
  | "国证"
  | "恒生"
  | "标普"
  | "纳斯达克"
  | "日经"
  | "MSCI"
  | "中债"
  | "上金所"
  | "其他";

export type HandbookStatus = "documented" | "partial" | "pending";

export type OfficialSourceKind = "编制方案" | "指数单张" | "官网" | "公告";

export interface OfficialSource {
  title: string;
  url: string;
  retrievedAt: string;
  kind: OfficialSourceKind;
}

export interface IndexMethodologyBrief {
  universe?: string;
  selection?: string;
  weighting?: string;
  capRule?: string;
  review?: string;
  specialRules?: string;
  currency?: string;
  baseDate?: string;
  baseValue?: string;
  sampleCount?: string;
}

export interface IndexHandbookEntry {
  id: string;
  indexCode: string;
  deriveCode: string;
  name: string;
  officialName: string | null;
  compiler: CompilerGroup;
  compilerName: string;
  etfCount: number;
  status: HandbookStatus;
  methodology: IndexMethodologyBrief | null;
  sources: OfficialSource[];
  notes: string | null;
}

export interface IndexHandbookCatalog {
  retrievedAt: string;
  timezone: string;
  universeSource: string;
  etfCountInSnapshot: number;
  indexCountInSnapshot: number;
  etfsMissingIndexInSnapshot: number;
  disclaimer: string;
  indexes: IndexHandbookEntry[];
}

export const INDEX_HANDBOOK_CATALOG = catalogJson as IndexHandbookCatalog;
export const INDEX_HANDBOOK = INDEX_HANDBOOK_CATALOG.indexes;

export const COMPILER_ORDER: CompilerGroup[] = [
  "中证",
  "上证",
  "国证",
  "恒生",
  "标普",
  "纳斯达克",
  "日经",
  "MSCI",
  "中债",
  "上金所",
  "其他",
];

export const STATUS_LABEL: Record<HandbookStatus, string> = {
  documented: "已收录编制方案",
  partial: "要点已摘录，完整方案待核",
  pending: "编制方案待收录",
};

function normCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function codeBare(raw: string): string {
  const n = normCode(raw);
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(0, i) : n;
}

export function displayIndexName(entry: IndexHandbookEntry): string {
  return entry.officialName?.trim() || entry.name;
}

export function findIndexHandbookEntry(
  indexCode?: string | null,
  indexName?: string | null,
): IndexHandbookEntry | null {
  const code = indexCode ? normCode(indexCode) : "";
  const bare = code ? codeBare(code) : "";
  const name = (indexName ?? "").trim();

  if (code) {
    const exact = INDEX_HANDBOOK.find(
      (e) => normCode(e.id) === code || normCode(e.deriveCode) === code || normCode(e.indexCode) === code,
    );
    if (exact) return exact;
  }
  if (bare) {
    const byBare = INDEX_HANDBOOK.filter((e) => codeBare(e.id) === bare || codeBare(e.indexCode) === bare);
    if (byBare.length === 1) return byBare[0];
    const preferred = byBare.find((e) => e.status !== "pending") ?? byBare[0];
    if (preferred && !name) return preferred;
    if (preferred && name) {
      const named = byBare.find((e) => e.name === name || e.officialName === name);
      if (named) return named;
    }
    if (preferred) return preferred;
  }
  if (!name) return null;
  const exactName = INDEX_HANDBOOK.filter((e) => e.name === name || e.officialName === name);
  if (exactName.length === 1) return exactName[0];
  if (exactName.length > 1) {
    return exactName.find((e) => e.status !== "pending") ?? exactName[0];
  }
  return null;
}

export function handbookPath(indexCode?: string | null, indexName?: string | null): string {
  const entry = findIndexHandbookEntry(indexCode, indexName);
  return entry ? `/indexes#${encodeURIComponent(entry.id)}` : "/indexes";
}

export function handbookCounts() {
  const documented = INDEX_HANDBOOK.filter((e) => e.status === "documented").length;
  const partial = INDEX_HANDBOOK.filter((e) => e.status === "partial").length;
  const pending = INDEX_HANDBOOK.filter((e) => e.status === "pending").length;
  return { documented, partial, pending, total: INDEX_HANDBOOK.length };
}
