import { writeFileSync } from "node:fs";

const WIKI_URL = "https://seesaawiki.jp/gakumasu/d/%A5%B9%A5%AD%A5%EB%A5%AB%A1%BC%A5%C9%B0%EC%CD%F7";
const OUTPUT_PATH = "my-optimizer/custom-max.json";

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

async function main() {
  console.log("Seesaa Wiki からスキルカード一覧を取得中（1リクエストのみ）...");
  const res = await fetch(WIKI_URL);
  if (!res.ok) {
    throw new Error(`HTTPエラー: ${res.status} ${res.statusText}`);
  }

  const buf = await res.arrayBuffer();
  const html = new TextDecoder("euc-jp").decode(buf);

  // 各カードのヘッダ位置を検出: <br />カード名<br />(内部ID)</th>
  const headerRegex = /<br\s*\/?>\s*([^<\r\n]+?)\s*<br\s*\/?>\s*\([A-Za-z0-9_]+\)\s*<\/th>/g;
  const headers = [];
  let match;
  while ((match = headerRegex.exec(html)) !== null) {
    const rawName = decodeHtmlEntities(match[1]).trim();
    if (rawName) {
      headers.push({ name: rawName, index: match.index });
    }
  }

  const customMaxMap = {};
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : html.length;
    const blockText = html
      .slice(start, end)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

    const capMatch = blockText.match(/カスタム\s*[（(]\s*上限\s*(\d+)\s*[）)]/);
    if (capMatch) {
      const limit = Number(capMatch[1]);
      if (Number.isInteger(limit) && limit >= 1 && limit <= 5) {
        customMaxMap[headers[i].name] = limit;
      }
    }
  }

  const count = Object.keys(customMaxMap).length;
  if (count === 0) {
    throw new Error("カスタム上限を1件も抽出できませんでした。WikiのHTML構造が変更された可能性があります。");
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(customMaxMap, null, 2) + "\n", "utf8");
  console.log(`完了: ${count} 枚のカスタム上限を ${OUTPUT_PATH} に保存しました。`);

  // 主要カードの抽出結果を検算表示
  const samples = ["シュプレヒコール", "存在感", "大胆不敵", "一発勝負"];
  console.log("サンプル確認:");
  for (const name of samples) {
    console.log(`  - ${name}: ${customMaxMap[name] ?? "未検出"}`);
  }
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});