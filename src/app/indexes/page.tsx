import type { Metadata } from "next";
import { IndexHandbook } from "@/components/IndexHandbook";

export const metadata: Metadata = {
  title: "跟踪指数手册 — ETF Market",
  description: "中国场内 ETF 跟踪指数的官方编制方案要点：编制机构、样本空间、加权方法、审核调样与官方文件入口。",
};

export default function IndexHandbookPage() {
  return <IndexHandbook />;
}
