import { EtfDetail } from "@/components/EtfDetail";

export default async function EtfPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ market?: string }>;
}) {
  const { code } = await params;
  const query = await searchParams;
  return <EtfDetail code={code} market={query.market} />;
}
