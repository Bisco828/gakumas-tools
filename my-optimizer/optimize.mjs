import { readFileSync } from "node:fs";
import { IdolConfig, IdolStageConfig, StageConfig, resetRand } from "gakumas-engine";
import { Stages, SkillCards, PItems } from "gakumas-data";
import { createSimulation } from "@/simulator";
import { loadoutFromQuery, silenceConsole } from "../tests/lib.mjs";

const cardByName = new Map(SkillCards.getAll().map((c) => [c.name, c.id]));
const cardById = new Map(SkillCards.getAll().map((c) => [c.id, c.name]));
const itemByName = new Map(PItems.getAll().map((p) => [p.name, p.id]));
const itemById = new Map(PItems.getAll().map((p) => [p.id, p.name]));

// 配列の直積（全組み合わせ）を生成
function cartesian(arrays) {
  return arrays.reduce(
    (acc, curr) => acc.flatMap((a) => curr.map((b) => [...a, b])),
    [[]]
  );
}

// 文字列なら[ID]、配列なら[ID1, ID2, ...]に変換
function parseSlots(slots, map, typeLabel) {
  return slots.map((entry) => {
    const names = Array.isArray(entry) ? entry : [entry];
    return names.map((name) => {
      const id = map.get(name);
      if (id === undefined) {
        throw new Error(`${typeLabel}が見つかりません: "${name}"`);
      }
      return id;
    });
  });
}

async function evaluate(loadout, runs) {
  const restore = silenceConsole();
  try {
    resetRand(1);
    const config = new IdolStageConfig(
      new IdolConfig(loadout),
      new StageConfig(Stages.getById(loadout.stageId)),
      loadout.enterPercents
    );
    const sim = createSimulation(config, null, "HeuristicStrategy");
    await sim.run(runs);
    const res = sim.result();
    const sorted = [...res.scores].sort((a, b) => a - b);
    return {
      avg: Math.round(res.averageScore),
      p20: Math.round(sorted[Math.floor(sorted.length * 0.2)]),
      p90: Math.round(sorted[Math.floor(sorted.length * 0.9)]),
    };
  } finally {
    restore();
  }
}

const cfg = JSON.parse(readFileSync("my-optimizer/config.json", "utf8"));
const summary = [];

for (const target of cfg.targets) {
  console.log(`\n▶ 探索開始: ${target.label}`);

  // ステージとステータスだけで土台を作成（本家URL不要）
  const baseQuery = `stage=${target.stageId}&support_bonus=${target.supportBonus}&params=${target.params.join("-")}`;
  const baseLoadout = loadoutFromQuery(baseQuery);

  const itemPools = parseSlots(target.pItems, itemByName, "Pアイテム");
  const mainPools = parseSlots(target.mainCards, cardByName, "メインカード");
  const subPools = parseSlots(target.subCards, cardByName, "サブカード");

  const allPools = [...itemPools, ...mainPools, ...subPools];
  const combos = cartesian(allPools);
  console.log(`  組み合わせ数: ${combos.length}通り（粗探索 ${cfg.coarseRuns}回 → 上位${cfg.topK}件を ${cfg.fineRuns}回）`);

  const nItems = itemPools.length;
  const nMain = mainPools.length;

  const buildLoadout = (combo) => {
    const clone = structuredClone(baseLoadout);
    clone.pItemIds = combo.slice(0, nItems);
    clone.skillCardIdGroups = [
      combo.slice(nItems, nItems + nMain),
      combo.slice(nItems + nMain),
    ];
    return clone;
  };

  // 第1段階：粗探索
  const coarseResults = [];
  for (const combo of combos) {
    const stats = await evaluate(buildLoadout(combo), cfg.coarseRuns);
    coarseResults.push({ combo, ...stats });
  }
  coarseResults.sort((a, b) => b.avg - a.avg);

  // 第2段階：上位K件の精密測定
  const topCandidates = coarseResults.slice(0, cfg.topK);
  const fineResults = [];
  for (const cand of topCandidates) {
    const loadout = buildLoadout(cand.combo);
    const stats = await evaluate(loadout, cfg.fineRuns);
    fineResults.push({ loadout, ...stats });
  }
  fineResults.sort((a, b) => b.avg - a.avg);

  const best = fineResults[0];
  const bestCards = best.loadout.skillCardIdGroups
    .map((g, i) => `${i === 0 ? "メイン" : "サブ"}:[${g.map((id) => cardById.get(id)).join(", ")}]`)
    .join(" / ");
  const bestItems = best.loadout.pItemIds.map((id) => itemById.get(id)).join(", ");

  summary.push({
    キャラ: target.label,
    平均スコア: best.avg,
    下振れ20: best.p20,
    上振れ90: best.p90,
    最適Pアイテム: bestItems,
    最適スキルカード: bestCards,
  });
}

summary.sort((a, b) => b.平均スコア - a.平均スコア);

console.log("\n========================================================");
console.log("  ★ 全キャラ最適編成ランキング（平均スコア順）");
console.log("========================================================");
console.table(
  summary.map((s) => ({
    キャラ: s.キャラ,
    平均スコア: s.平均スコア,
    "下振れ(20%)": s.下振れ20,
    "上振れ(90%)": s.上振れ90,
    最適Pアイテム: s.最適Pアイテム,
  }))
);

console.log("\n--- 各キャラの最適スキルカード詳細 ---");
summary.forEach((s, i) => {
  console.log(`\n[${i + 1}位] ${s.キャラ} (平均: ${s.平均スコア} / 下振れ: ${s.下振れ20})`);
  console.log(`  Pアイテム: ${s.最適Pアイテム}`);
  console.log(`  カード   : ${s.最適スキルカード}`);
});