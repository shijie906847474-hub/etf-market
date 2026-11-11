"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { QuoteChart } from "@/components/QuoteChart";
import { changeClass, formatAum, formatDateOnly, formatMoney, formatNumber, formatPct, formatPrice, formatShanghai, formatVolumeHands } from "@/lib/format";
import type { EtfDetailPayload, KlineBar, TrendPoint } from "@/lib/types";
import { isWatched, loadWatchlist, saveWatchlist, toggleWatch } from "@/lib/watchlist";
import { cn } from "@/lib/cn";

type Period = "intraday" | "101" | "102" | "103";

export function EtfDetail({ code, market }: { code: string; market?: string }) {
  const [detail, setDetail] = useState<EtfDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("intraday");
  const [bars, setBars] = useState<KlineBar[]>([]);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [preClose, setPreClose] = useState<number | null>(null);
  const [indicators, setIndicators] = useState<any>(null);
  const [vwap, setVwap] = useState<{ time: string; value: number }[]>([]);
  const [showMA, setShowMA] = useState(true);
  const [showBOLL, setShowBOLL] = useState(false);
  const [showMACD, setShowMACD] = useState(true);
  const [showRSI, setShowRSI] = useState(false);
  const [showVWAP, setShowVWAP] = useState(true);
  const [watched, setWatched] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const qs = market ? `?market=${market}` : "";

  useEffect(() => {
    setWatched(isWatched(loadWatchlist(), code));
    (async () => {
      try {
        const res = await fetch(`/api/etf/${code}${qs}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "详情加载失败");
        setDetail(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "详情加载失败");
      }
    })();
  }, [code, qs]);

  useEffect(() => {
    (async () => {
      setChartError(null);
      try {
        if (period === "intraday") {
          const res = await fetch(`/api/etf/${code}/trends${qs}`, { cache: "no-store" });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "分时加载失败");
          setTrends(json.points ?? []);
          setPreClose(json.preClose ?? null);
          setVwap(json.vwap ?? []);
          setIndicators(null);
        } else {
          const res = await fetch(`/api/etf/${code}/kline${qs}&period=${period}`.replace("&", qs ? "&" : "?"), {
            cache: "no-store",
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "K线加载失败");
          setBars(json.bars ?? []);
          setIndicators(json.indicators);
          setVwap(json.indicators?.vwap ?? []);
        }
      } catch (err) {
        setChartError(err instanceof Error ? err.message : "图表加载失败");
      }
    })();
  }, [code, period, qs]);

  const row = detail?.row;
  const kurl = (p: Period) => `/api/etf/${code}/kline${qs}${qs ? "&" : "?"}period=${p}`;
  void kurl;

  return (
    <div className="min-h-screen">
      <header className="border-b border-terminal-border bg-terminal-header px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-terminal-muted hover:text-terminal-text">
              ← 全市场
            </Link>
            <Link href="/watchlist" className="text-sm text-terminal-muted hover:text-terminal-text">
              我的自选
            </Link>
          </div>
          <div className="text-[11px] text-terminal-muted">
            数据来源：{detail?.source ?? "东方财富公开行情"} · {detail?.freshness} ·
            行情时间 {formatShanghai(row?.quoteTime ?? detail?.iopvQuoteTime ?? null)}
          </div>
        </div>
      </header>

      {error ? <div className="m-3 border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">{error}</div> : null}
      {!detail && !error ? <div className="px-3 py-10 text-sm text-terminal-muted">正在加载 ETF 详情…</div> : null}

      {row ? (
        <>
          <section className="border-b border-terminal-border px-3 py-3">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <div className="text-xs text-terminal-muted">
                  {row.exchange} · {row.code} · {row.category} · {row.status}
                </div>
                <h1 className="text-xl font-medium">{row.name}</h1>
              </div>
              <div className={cn("font-mono text-3xl tabular-nums", changeClass(row.changePct))}>{formatPrice(row.last)}</div>
              <div className={cn("font-mono text-lg", changeClass(row.changePct))}>
                {formatPrice(row.change)} {formatPct(row.changePct)}
              </div>
              <button
                type="button"
                className="border border-terminal-border px-2 py-1 text-sm"
                onClick={() => {
                  const next = toggleWatch(loadWatchlist(), code);
                  saveWatchlist(next);
                  setWatched(isWatched(next, code));
                }}
              >
                {watched ? "★ 已加自选" : "☆ 加自选"}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4 lg:grid-cols-7">
              <Metric label="成交额" value={formatMoney(row.turnover)} />
              <Metric label="成交量" value={formatVolumeHands(row.volume)} />
              <Metric label="换手率" value={formatPct(row.turnoverRate)} />
              <Metric label="IOPV" value={formatPrice(row.iopv)} hint="stock/get f71" />
              <Metric label="折溢价率" value={formatPct(row.premiumPct)} colored={row.premiumPct} hint="(最新价-IOPV)/IOPV" />
              <Metric label="基金规模" value={formatAum(row.aum)} hint={row.aumDate ? `披露 ${row.aumDate}` : "缺失"} />
              <Metric label="量比" value={formatNumber(row.volumeRatio, 2)} />
            </div>
            {row.nav !== null ? (
              <div className="mt-2 text-[11px] text-terminal-muted">
                基金份额净值 NAV = {formatPrice(row.nav)}（stock/get f131，不用于折溢价，也不是 IOPV）
              </div>
            ) : null}
          </section>

          {detail.warnings.length > 0 ? (
            <section className="border-b border-terminal-border px-3 py-2">
              <div className="mb-1 text-xs text-terminal-muted">风险提示</div>
              {detail.warnings.map((w) => (
                <div key={w.text} className={cn("text-sm", w.level === "warn" ? "text-[#f0c674]" : "text-terminal-muted")}>
                  · {w.text}
                </div>
              ))}
            </section>
          ) : null}

          <section className="border-b border-terminal-border px-3 py-2">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              {(
                [
                  ["intraday", "分时"],
                  ["101", "日K"],
                  ["102", "周K"],
                  ["103", "月K"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPeriod(k)}
                  className={cn("border border-terminal-border px-2 py-1", period === k && "bg-white/10")}
                >
                  {label}
                </button>
              ))}
              <label className="ml-3">
                <input type="checkbox" checked={showMA} onChange={(e) => setShowMA(e.target.checked)} /> MA5/10/20/60
              </label>
              <label>
                <input type="checkbox" checked={showBOLL} onChange={(e) => setShowBOLL(e.target.checked)} /> BOLL
              </label>
              <label>
                <input type="checkbox" checked={showMACD} onChange={(e) => setShowMACD(e.target.checked)} /> MACD
              </label>
              <label>
                <input type="checkbox" checked={showRSI} onChange={(e) => { setShowRSI(e.target.checked); if (e.target.checked) setShowMACD(false); }} /> RSI
              </label>
              <label>
                <input type="checkbox" checked={showVWAP} onChange={(e) => setShowVWAP(e.target.checked)} /> VWAP
              </label>
              <span className="text-terminal-muted">指标均由 K 线/分时计算，不向行情源索取现成值</span>
            </div>
            {chartError ? <div className="text-sm text-up">{chartError}</div> : null}
            <QuoteChart
              mode={period === "intraday" ? "intraday" : "kline"}
              bars={bars}
              trends={trends}
              preClose={preClose}
              vwap={vwap}
              ma5={indicators?.ma5}
              ma10={indicators?.ma10}
              ma20={indicators?.ma20}
              ma60={indicators?.ma60}
              boll={indicators?.boll}
              macd={indicators?.macd}
              rsi={indicators?.rsi}
              showMA={showMA && period !== "intraday"}
              showBOLL={showBOLL && period !== "intraday"}
              showMACD={showMACD && period !== "intraday"}
              showRSI={showRSI && period !== "intraday"}
              showVWAP={showVWAP}
            />
          </section>

          <section className="grid grid-cols-1 gap-0 md:grid-cols-2">
            <div className="border-b border-terminal-border px-3 py-3 md:border-r">
              <div className="mb-2 text-xs text-terminal-muted">基金信息</div>
              <Info label="基金管理人" value={row.orgName ?? "—"} />
              <Info label="基金经理" value={row.fundManager ?? "—"} />
              <Info label="托管人" value={row.trustee ?? "—"} />
              <Info label="基金类型" value={[row.fundType, row.level2Class].filter(Boolean).join(" / ") || "—"} />
              <Info label="跟踪指数" value={row.indexName ?? "—"} />
              <Info label="业绩比较基准" value={row.benchmark ?? "—"} />
              <Info label="管理费率" value={row.managementFee === null ? "—" : `${row.managementFee.toFixed(2)}%`} />
              <Info label="托管费率" value={row.custodyFee === null ? "—" : `${row.custodyFee.toFixed(2)}%`} />
              <Info
                label="跟踪误差"
                value={row.trackingErrorTarget ? `${row.trackingErrorTarget}（合同目标，非已实现）` : "暂无已实现跟踪误差，公开 F10 仅可能含合同目标"}
              />
              <Info label="成立日期" value={formatDateOnly(row.foundDate)} />
              <Info label="上市日期" value={formatDateOnly(row.listedDate)} />
              <Info label="规模披露日" value={formatDateOnly(row.aumDate)} />
            </div>
            <div className="border-b border-terminal-border px-3 py-3">
              <div className="mb-2 text-xs text-terminal-muted">历史表现（行情源区间涨跌幅）</div>
              <Info label="近 5 日" value={formatPct(row.ret5d)} colored={row.ret5d} />
              <Info label="近 20 日" value={formatPct(row.ret20d)} colored={row.ret20d} />
              <Info label="近 60 日" value={formatPct(row.ret60d)} colored={row.ret60d} />
              <Info label="近一年" value={formatPct(row.ret1y)} colored={row.ret1y} />
              <div className="mt-3 text-[11px] text-terminal-muted">
                买一 {formatPrice(row.bid1)} / 卖一 {formatPrice(row.ask1)} / 价差 {formatPrice(row.spread)}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value, hint, colored }: { label: string; value: string; hint?: string; colored?: number | null }) {
  return (
    <div>
      <div className="text-[11px] text-terminal-muted">{label}</div>
      <div className={cn("font-mono", colored !== undefined && changeClass(colored ?? null))}>{value}</div>
      {hint ? <div className="text-[10px] text-terminal-muted">{hint}</div> : null}
    </div>
  );
}

function Info({ label, value, colored }: { label: string; value: string; colored?: number | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-terminal-border/60 py-1 text-sm">
      <span className="text-terminal-muted">{label}</span>
      <span className={cn("text-right", colored !== undefined && changeClass(colored ?? null))}>{value}</span>
    </div>
  );
}
