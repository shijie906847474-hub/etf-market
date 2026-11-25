"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  COMPILER_ORDER,
  INDEX_HANDBOOK,
  INDEX_HANDBOOK_CATALOG,
  STATUS_LABEL,
  displayIndexName,
  handbookCounts,
  type CompilerGroup,
  type HandbookStatus,
  type IndexHandbookEntry,
} from "@/lib/index-handbook";
import { cn } from "@/lib/cn";

type StatusFilter = "all" | HandbookStatus;
type CompilerFilter = "all" | CompilerGroup;

const STATUS_FILTERS: Array<[StatusFilter, string]> = [
  ["all", "全部"],
  ["documented", "已收录编制方案"],
  ["partial", "要点已摘录"],
  ["pending", "编制方案待收录"],
];

const METHOD_FIELDS: Array<[keyof NonNullable<IndexHandbookEntry["methodology"]>, string]> = [
  ["universe", "样本空间"],
  ["selection", "选样方法"],
  ["weighting", "加权方法"],
  ["capRule", "权重上限"],
  ["review", "定期审核与调样"],
  ["specialRules", "特别规则"],
  ["currency", "计价货币"],
  ["baseDate", "基日"],
  ["baseValue", "基点"],
  ["sampleCount", "样本数量"],
];

function statusRank(status: HandbookStatus): number {
  if (status === "documented") return 0;
  if (status === "partial") return 1;
  return 2;
}

export function IndexHandbook() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [compiler, setCompiler] = useState<CompilerFilter>("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const counts = handbookCounts();

  useEffect(() => {
    const applyHash = () => {
      const raw = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!raw) return;
      setActiveId(raw);
      const el = document.getElementById(raw);
      if (el) el.scrollIntoView({ block: "start" });
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s+/g, "");
    return INDEX_HANDBOOK.filter((entry) => {
      if (status !== "all" && entry.status !== status) return false;
      if (compiler !== "all" && entry.compiler !== compiler) return false;
      if (!needle) return true;
      const hay = [
        entry.name,
        entry.officialName ?? "",
        entry.indexCode,
        entry.deriveCode,
        entry.compiler,
        entry.compilerName,
      ]
        .join(" ")
        .toLowerCase()
        .replace(/\s+/g, "");
      return hay.includes(needle);
    }).sort((a, b) => {
      const s = statusRank(a.status) - statusRank(b.status);
      if (s !== 0) return s;
      return b.etfCount - a.etfCount;
    });
  }, [q, status, compiler]);

  const grouped = useMemo(() => {
    const map = new Map<CompilerGroup, IndexHandbookEntry[]>();
    for (const entry of filtered) {
      const list = map.get(entry.compiler) ?? [];
      list.push(entry);
      map.set(entry.compiler, list);
    }
    return COMPILER_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)!] as const);
  }, [filtered]);

  const compilerCounts = useMemo(() => {
    const map = new Map<CompilerGroup, number>();
    for (const entry of INDEX_HANDBOOK) {
      map.set(entry.compiler, (map.get(entry.compiler) ?? 0) + 1);
    }
    return map;
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-terminal-border bg-terminal-header/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-terminal-muted hover:text-terminal-text">
              ← 全市场
            </Link>
            <h1 className="text-sm font-semibold tracking-wide">跟踪指数手册</h1>
          </div>
          <div className="font-mono text-[11px] text-terminal-muted">
            已收录 {counts.documented} · 要点摘录 {counts.partial} · 待收录 {counts.pending} · 合计 {counts.total}
          </div>
        </div>
        <div className="border-t border-terminal-border px-3 py-2 text-[11px] leading-relaxed text-terminal-muted">
          {INDEX_HANDBOOK_CATALOG.disclaimer}
          名单来自{INDEX_HANDBOOK_CATALOG.universeSource}，检索日期 {INDEX_HANDBOOK_CATALOG.retrievedAt}（
          {INDEX_HANDBOOK_CATALOG.timezone}），当时覆盖 {INDEX_HANDBOOK_CATALOG.etfCountInSnapshot} 只场内 ETF、
          {INDEX_HANDBOOK_CATALOG.indexCountInSnapshot} 只跟踪指数；另有 {INDEX_HANDBOOK_CATALOG.etfsMissingIndexInSnapshot}{" "}
          只未披露跟踪指数，不列入本手册。后续 F10 更新可能出现未收录代码，将按待收录处理，不会编造规则。
        </div>
      </header>

      <section className="border-b border-terminal-border px-3 py-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-terminal-muted">搜索指数名称或代码</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 w-56 border border-terminal-border bg-terminal-panel px-2 font-mono text-sm"
              placeholder="如 沪深300 / 000300 / HSTECH"
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {STATUS_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={cn(
                "border px-2 py-0.5 text-[11px]",
                status === value
                  ? "border-terminal-text text-terminal-text"
                  : "border-terminal-border text-terminal-muted hover:text-terminal-text",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setCompiler("all")}
            className={cn(
              "border px-2 py-0.5 text-[11px]",
              compiler === "all"
                ? "border-terminal-text text-terminal-text"
                : "border-terminal-border text-terminal-muted hover:text-terminal-text",
            )}
          >
            全部编制机构
          </button>
          {COMPILER_ORDER.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setCompiler(g)}
              className={cn(
                "border px-2 py-0.5 text-[11px]",
                compiler === g
                  ? "border-terminal-text text-terminal-text"
                  : "border-terminal-border text-terminal-muted hover:text-terminal-text",
              )}
            >
              {g} {compilerCounts.get(g) ?? 0}
            </button>
          ))}
        </div>
      </section>

      <div className="px-3 py-2 text-[11px] text-terminal-muted">
        当前显示 {filtered.length} 只
        {filtered.length === 0 ? "。可清空搜索或改筛选条件。" : "。已收录条目按跟踪 ETF 只数排序；待收录条目仅列官方文件入口（如有），不补写规则。"}
      </div>

      {grouped.map(([group, entries]) => (
        <section key={group} className="border-t border-terminal-border">
          <h2 className="sticky top-[7.5rem] z-20 border-b border-terminal-border bg-terminal-header px-3 py-1.5 text-xs font-medium">
            {group}
            <span className="ml-2 font-normal text-terminal-muted">{entries.length} 只</span>
          </h2>
          {entries.map((entry) => (
            <IndexCard key={entry.id} entry={entry} highlight={activeId === entry.id} />
          ))}
        </section>
      ))}
    </div>
  );
}

function IndexCard({ entry, highlight }: { entry: IndexHandbookEntry; highlight: boolean }) {
  const meth = entry.methodology;
  const filled = meth
    ? METHOD_FIELDS.filter(([key]) => {
        const v = meth[key];
        return typeof v === "string" && v.trim();
      })
    : [];

  return (
    <article
      id={entry.id}
      className={cn(
        "scroll-mt-36 border-b border-terminal-border px-3 py-3",
        highlight && "bg-white/5",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{displayIndexName(entry)}</div>
          <div className="mt-0.5 font-mono text-[11px] text-terminal-muted">
            {entry.deriveCode}
            {entry.indexCode && entry.indexCode !== entry.deriveCode.split(".")[0] ? ` · typelist ${entry.indexCode}` : ""}
            {entry.name && entry.name !== displayIndexName(entry) ? ` · 行情简称 ${entry.name}` : ""}
            {` · ${entry.compilerName} · typelist 中跟踪 ETF ${entry.etfCount} 只`}
          </div>
        </div>
        <div
          className={cn(
            "shrink-0 border px-1.5 py-0.5 text-[11px]",
            entry.status === "documented"
              ? "border-terminal-text text-terminal-text"
              : "border-terminal-border text-terminal-muted",
          )}
        >
          {STATUS_LABEL[entry.status]}
        </div>
      </div>

      {filled.length > 0 ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
          {filled.map(([key, label]) => (
            <div key={key} className={cn(key === "specialRules" || key === "selection" || key === "universe" || key === "review" ? "md:col-span-2" : "")}>
              <dt className="text-[11px] text-terminal-muted">{label}</dt>
              <dd className="mt-0.5 leading-relaxed text-terminal-text">{meth![key]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-terminal-muted">
          {entry.notes ?? "编制方案待收录。未检索到可核验的官方文件时，本手册不编造样本空间、加权方法或调样规则。"}
        </p>
      )}

      {entry.notes && filled.length > 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-terminal-muted">{entry.notes}</p>
      ) : null}

      {entry.sources.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <span className="text-terminal-muted">官方文件</span>
          {entry.sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="text-terminal-text underline decoration-terminal-border underline-offset-2 hover:decoration-terminal-text"
            >
              {s.kind} · {s.title}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}
