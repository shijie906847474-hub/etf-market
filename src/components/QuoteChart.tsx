"use client";

import { useEffect, useRef } from "react";
import { ColorType, createChart, CrosshairMode, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import type { KlineBar, TrendPoint } from "@/lib/types";

interface Props {
  mode: "intraday" | "kline";
  bars?: KlineBar[];
  trends?: TrendPoint[];
  preClose?: number | null;
  vwap?: { time: string; value: number }[];
  ma5?: { time: string; value: number }[];
  ma10?: { time: string; value: number }[];
  ma20?: { time: string; value: number }[];
  ma60?: { time: string; value: number }[];
  boll?: {
    mid: { time: string; value: number }[];
    upper: { time: string; value: number }[];
    lower: { time: string; value: number }[];
  };
  macd?: { time: string; dif: number | null; dea: number | null; hist: number | null }[];
  rsi?: { time: string; value: number }[];
  showMA: boolean;
  showBOLL: boolean;
  showMACD: boolean;
  showRSI: boolean;
  showVWAP: boolean;
}

function toUtc(time: string): UTCTimestamp {
  const iso = time.includes(" ") ? time.replace(" ", "T") + "+08:00" : time + "T00:00:00+08:00";
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

const UP = "#f6465d";
const DOWN = "#0ecb81";
const BG = "#0b0e11";
const GRID = "#1c2330";
const TEXT = "#8b9bb4";

export function QuoteChart(props: Props) {
  const mainRef = useRef<HTMLDivElement>(null);
  const oscRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mainRef.current) return;
    const charts: IChartApi[] = [];
    const common = {
      layout: { background: { type: ColorType.Solid, color: BG }, textColor: TEXT },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: "#2a313c" },
      timeScale: { borderColor: "#2a313c", timeVisible: props.mode === "intraday", secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "zh-CN" },
    };

    const main = createChart(mainRef.current, {
      ...common,
      width: mainRef.current.clientWidth,
      height: 360,
    });
    charts.push(main);

    if (props.mode === "intraday" && props.trends) {
      const line = main.addLineSeries({ color: "#5b8def", lineWidth: 2 });
      line.setData(props.trends.map((p) => ({ time: toUtc(p.time), value: p.close })));
      if (props.showVWAP && props.vwap?.length) {
        const vwap = main.addLineSeries({ color: "#e0b044", lineWidth: 1 });
        vwap.setData(props.vwap.map((p) => ({ time: toUtc(p.time), value: p.value })));
      }
      if (props.preClose) {
        const ref = main.addLineSeries({ color: "#666", lineWidth: 1, lineStyle: 2 });
        const t0 = toUtc(props.trends[0].time);
        const t1 = toUtc(props.trends[props.trends.length - 1].time);
        ref.setData([
          { time: t0, value: props.preClose },
          { time: t1, value: props.preClose },
        ]);
      }
    } else if (props.bars?.length) {
      const candle = main.addCandlestickSeries({
        upColor: UP,
        downColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
      });
      candle.setData(
        props.bars.map((b) => ({
          time: toUtc(b.time),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        })),
      );
      const addLine = (pts: { time: string; value: number }[] | undefined, color: string) => {
        if (!pts?.length) return;
        const s = main.addLineSeries({ color, lineWidth: 1 });
        s.setData(pts.map((p) => ({ time: toUtc(p.time), value: p.value })));
      };
      if (props.showMA) {
        addLine(props.ma5, "#e0b044");
        addLine(props.ma10, "#5b8def");
        addLine(props.ma20, "#c084fc");
        addLine(props.ma60, "#22d3ee");
      }
      if (props.showBOLL && props.boll) {
        addLine(props.boll.upper, "#94a3b8");
        addLine(props.boll.mid, "#64748b");
        addLine(props.boll.lower, "#94a3b8");
      }
      if (props.showVWAP) addLine(props.vwap, "#f59e0b");
    }

    let osc: IChartApi | null = null;
    if (oscRef.current && ((props.showMACD && props.macd?.length) || (props.showRSI && props.rsi?.length))) {
      osc = createChart(oscRef.current, {
        ...common,
        width: oscRef.current.clientWidth,
        height: 160,
      });
      charts.push(osc);
      if (props.showMACD && props.macd?.length) {
        const hist = osc.addHistogramSeries({ priceFormat: { type: "price", precision: 4, minMove: 0.0001 } });
        hist.setData(
          props.macd
            .filter((p) => p.hist !== null)
            .map((p) => ({
              time: toUtc(p.time),
              value: p.hist as number,
              color: (p.hist as number) >= 0 ? UP : DOWN,
            })),
        );
        const dif = osc.addLineSeries({ color: "#5b8def", lineWidth: 1 });
        dif.setData(props.macd.filter((p) => p.dif !== null).map((p) => ({ time: toUtc(p.time), value: p.dif as number })));
        const dea = osc.addLineSeries({ color: "#e0b044", lineWidth: 1 });
        dea.setData(props.macd.filter((p) => p.dea !== null).map((p) => ({ time: toUtc(p.time), value: p.dea as number })));
      } else if (props.showRSI && props.rsi?.length) {
        const rsi = osc.addLineSeries({ color: "#e0b044", lineWidth: 1 });
        rsi.setData(props.rsi.map((p) => ({ time: toUtc(p.time), value: p.value })));
      }
      if (charts[0] && osc) {
        charts[0].timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (range) osc?.timeScale().setVisibleLogicalRange(range);
        });
      }
    }

    const onResize = () => {
      charts.forEach((c, i) => {
        const el = i === 0 ? mainRef.current : oscRef.current;
        if (el) c.applyOptions({ width: el.clientWidth });
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      charts.forEach((c) => c.remove());
    };
  }, [props]);

  return (
    <div>
      <div ref={mainRef} />
      <div ref={oscRef} className={props.showMACD || props.showRSI ? "mt-1" : "hidden"} />
    </div>
  );
}
