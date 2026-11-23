/**
 * Offline checks for typelist / Sina universe parsers. No network.
 */
import { looksLikeEtf, marketFromEtfSecuCode, parseTypeListPage, parseTypeListRow } from "../src/lib/providers/eastmoney";
import { decodeSinaBytes, parseSinaNodeBody, parseSinaNodeCount } from "../src/lib/providers/sina";

function assertEqual(label: string, actual: unknown, want: unknown) {
  if (actual !== want) {
    throw new Error(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
  }
}

function main() {
  assertEqual("158000.SZ", marketFromEtfSecuCode("158000.SZ", "158000"), 0);
  assertEqual("510300.SH", marketFromEtfSecuCode("510300.SH", "510300"), 1);
  assertEqual("588140.SH", marketFromEtfSecuCode("588140.SH", "588140"), 1);
  assertEqual("suffix beats 51 prefix? 159915.SZ", marketFromEtfSecuCode("159915.SZ", "159915"), 0);
  assertEqual("51xxxx no suffix", marketFromEtfSecuCode(null, "511880"), 1);
  assertEqual("15xxxx no suffix", marketFromEtfSecuCode("", "159915"), 0);
  assertEqual("588xxx no suffix still SH", marketFromEtfSecuCode(undefined, "588140"), 1);

  assertEqual("ETF kept", looksLikeEtf("沪深300ETF华泰柏瑞"), true);
  assertEqual("LOF without ETF dropped", looksLikeEtf("某LOF基金"), false);
  assertEqual("REIT without ETF dropped", looksLikeEtf("某REITs"), false);
  assertEqual("name with both ETF and LOF kept", looksLikeEtf("某ETF-LOF"), true);

  const row = parseTypeListRow({
    SECUCODE: "518880.SH",
    SECURITY_CODE: "518880",
    SECURITY_NAME_ABBR: "黄金ETF",
  });
  assertEqual("typelist 518880 code", row?.code, "518880");
  assertEqual("typelist 518880 market", row?.market, 1);
  assertEqual("typelist 518880 name", row?.name, "黄金ETF");
  assertEqual("typelist drops LOF", parseTypeListRow({ SECUCODE: "160000.SZ", SECURITY_CODE: "160000", SECURITY_NAME_ABBR: "某LOF" }), null);

  const page = parseTypeListPage({
    success: true,
    result: {
      count: 2,
      pages: 1,
      data: [
        { SECUCODE: "159915.SZ", SECURITY_CODE: "159915", SECURITY_NAME_ABBR: "创业板ETF易方达" },
        { SECUCODE: "510300.SH", SECURITY_CODE: "510300", SECURITY_NAME_ABBR: "沪深300ETF华泰柏瑞" },
      ],
    },
  });
  assertEqual("typelist page count", page.count, 2);
  assertEqual("typelist page size", page.items.length, 2);
  assertEqual("typelist 159915 market", page.items[0]?.market, 0);
  assertEqual("typelist 510300 market", page.items[1]?.market, 1);

  const sina = parseSinaNodeBody(
    JSON.stringify([
      { symbol: "sh510300", code: "510300", name: "沪深300ETF华泰柏瑞", trade: "3.985" },
      { symbol: "sz159915", code: "159915", name: "创业板ETF易方达" },
      { symbol: "sh511880", code: "511880", name: "银华日利ETF" },
      { symbol: "sz160000", code: "160000", name: "某LOF基金" },
    ]),
  );
  assertEqual("sina drops LOF and keeps 3", sina.length, 3);
  assertEqual("sina 510300 market", sina[0]?.market, 1);
  assertEqual("sina 159915 market", sina[1]?.market, 0);
  assertEqual("sina 511880 name", sina[2]?.name, "银华日利ETF");
  assertEqual("sina count quoted", parseSinaNodeCount('"938"'), 938);
  const gbkLike = new TextEncoder().encode('[{"symbol":"sh510010","code":"510010","name":"180\\u6cbb\\u7406ETF\\u4ea4\\u94f6"}]');
  const decoded = decodeSinaBytes(gbkLike);
  assertEqual("sina decode utf-8 escapes", parseSinaNodeBody(decoded)[0]?.code, "510010");

  console.log("parse-universe-fallback: ok");
}

main();
