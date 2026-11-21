import { IdolConfig, IdolStageConfig, StageConfig, resetRand } from "gakumas-engine";
import { Stages } from "gakumas-data";
import { createSimulation } from "@/simulator";
import { loadSuite, loadoutFromQuery, silenceConsole } from "../tests/lib.mjs";

// 1. 本家のテストデータから1編成だけサンプルを取得
const sample = loadSuite()[0];
const loadout = loadoutFromQuery(sample.query);

console.log("=== 編成データの中身（一部） ===");
console.log("ステージID:", loadout.stageId);
console.log("スキルカードID一覧:", loadout.skillCardIdGroups);
console.log("PアイテムID一覧:", loadout.pItemIds);

// 2. シミュレーション設定を作成（100回実行）
const RUNS = 100;
const t0 = performance.now();
const restore = silenceConsole(); // 途中の細かいログを非表示にする

let result;
try {
  resetRand(1);
  const config = new IdolStageConfig(
    new IdolConfig(loadout),
    new StageConfig(Stages.getById(loadout.stageId)),
    loadout.enterPercents,
  );
  const simulation = createSimulation(config, null, "HeuristicStrategy");
  await simulation.run(RUNS);
  result = simulation.result();
} finally {
  restore();
}

const ms = (performance.now() - t0).toFixed(0);
console.log(`\n=== シミュレーション結果 (${RUNS}回 / ${ms}ms) ===`);
console.log("平均スコア:", Math.round(result.average));
console.log("結果オブジェクトの項目:", Object.keys(result));