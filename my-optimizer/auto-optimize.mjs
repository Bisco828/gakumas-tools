import { readFileSync, existsSync } from "node:fs";
import { IdolConfig, IdolStageConfig, StageConfig, resetRand } from "gakumas-engine";
import { Stages, SkillCards, PItems, PIdols, Idols, Customizations } from "gakumas-data";
import { createSimulation } from "@/simulator";
import { loadoutFromQuery, silenceConsole } from "../tests/lib.mjs";

// キャラごとの得意属性順 [流1, 流2, 流3]
const IDOL_AFFINITY = {
  花海咲季: ["vi", "da", "vo"],
  月村手毬: ["vo", "da", "vi"],
  藤田ことね: ["da", "vi", "vo"],
  雨夜燕: ["da", "vo", "vi"],
  有村麻央: ["vo", "vi", "da"],
  葛城リーリヤ: ["vi", "da", "vo"],
  倉本千奈: ["da", "vi", "vo"],
  紫雲清夏: ["da", "vi", "vo"],
  篠澤広: ["vo", "da", "vi"],
  十王星南: ["vi", "vo", "da"],
  秦谷美鈴: ["vo", "vi", "da"],
  花海佑芽: ["da", "vo", "vi"],
  姫崎莉波: ["vi", "da", "vo"],
  氷渡香名江: ["vi", "vo", "da"], // ※必要に応じて流1→流2→流3に合わせて変更
};

const allCards = SkillCards.getAll();
const allItems = PItems.getAll();
const allCustoms = Customizations.getAll();
const cardById = new Map(allCards.map((c) => [c.id, c]));
const itemById = new Map(allItems.map((p) => [p.id, p]));
const idolById = new Map(Idols.getAll().map((i) => [i.id, i]));
const customById = new Map(allCustoms.map((c) => [String(c.id), c]));

const randPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isSupportCard = (card) => card?.sourceType === "support";

function getMaxCustomForCard(card) {
  if (!card) return 0;
  if (card.rarity === "R") return 3;
  if (card.rarity === "SR") return 2;
  if (card.rarity === "SSR") return 1;
  return 1;
}

function loadOwnedSet(onlyOwned) {
  if (!onlyOwned || !existsSync("my-optimizer/owned.json")) return null;
  const raw = JSON.parse(readFileSync("my-optimizer/owned.json", "utf8"));
  return new Set(raw.map((v) => String(v)));
}

// キャラの得意属性に合わせて [Vo, Da, Vi, 体力] を組み立てる
function buildParamsForIdol(idolName, baseParams, paramMode) {
  if (paramMode !== "idol") return [...baseParams];
  const key = (idolName || "").replace(/\s+/g, "");
  const order = IDOL_AFFINITY[key] || ["vo", "da", "vi"];
  const mapped = { vo: baseParams[0], da: baseParams[1], vi: baseParams[2] };
  mapped[order[0]] = baseParams[0];
  mapped[order[1]] = baseParams[1];
  mapped[order[2]] = baseParams[2];
  return [mapped.vo, mapped.da, mapped.vi, baseParams[3]];
}

function withIdolParams(baseLoadout, idolName, baseParams, paramMode) {
  const clone = structuredClone(baseLoadout);
  clone.params = buildParamsForIdol(idolName, baseParams, paramMode);
  return clone;
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

function getOwnAssets(pIdol) {
  const ownCard =
    allCards.find((c) => c.pIdolId === pIdol.id && c.upgraded) ||
    allCards.find((c) => c.pIdolId === pIdol.id);
  // 固有Pアイテムは未強化を優先
  const ownItem =
    allItems.find((p) => p.pIdolId === pIdol.id && !p.upgraded) ||
    allItems.find((p) => p.pIdolId === pIdol.id);
  return { ownCard, ownItem };
}

// サブ用の固有カード候補（メインと同キャラ・同プランの別衣装）を取得
function getSubOwnCards(mainPIdol, ownedSet) {
  const name = idolById.get(mainPIdol.idolId)?.name || "";
  const subPIdols = PIdols.getAll().filter((p) => {
    if (p.id === mainPIdol.id) return false;
    if (p.idolId !== mainPIdol.idolId) return false;
    if (p.plan !== mainPIdol.plan) return false;
    if (!p.title) return false;
    if (p.rarity === "SSR" && ownedSet) {
      const fullLabel = `${name}【${p.title}】`;
      return ownedSet.has(String(p.id)) || ownedSet.has(fullLabel);
    }
    return p.rarity === "SSR" || p.rarity === "SR";
  });

  const subCards = [];
  const seen = new Set();
  for (const sp of subPIdols) {
    const { ownCard } = getOwnAssets(sp);
    if (ownCard && !seen.has(ownCard.id)) {
      seen.add(ownCard.id);
      subCards.push(ownCard);
    }
  }
  return subCards;
}

function buildPlanPools(plan, includeR) {
  const allowedRarities = includeR ? ["SSR", "SR", "R"] : ["SSR", "SR"];
  const cardPool = allCards.filter(
    (c) =>
      (c.plan === plan || c.plan === "free") &&
      c.upgraded === true &&
      c.pIdolId === null &&
      c.sourceType !== "default" &&
      allowedRarities.includes(c.rarity)
  );
  // 汎用Pアイテムも未強化のみ
  const itemPool = allItems.filter(
    (p) =>
      p.mode === "stage" &&
      (p.plan === plan || p.plan === "free") &&
      p.pIdolId === null &&
      p.rarity !== "N" &&
      !p.upgraded
  );
  return { cardPool, itemPool };
}

// 指定グループ（メイン0-5 / サブ6-11）の他スロットにサポカカードが既にあるか判定
function hasSupportCardInGroup(cards, slot) {
  const start = slot < 6 ? 0 : 6;
  const end = start + 6;
  for (let i = start; i < end; i++) {
    if (i === slot) continue;
    if (isSupportCard(cardById.get(cards[i]))) return true;
  }
  return false;
}

function createInitialState(ownCard, subOwnCard, ownItem, cardPool, itemPool) {
  const items = ownItem ? [ownItem.id] : [];
  while (items.length < 4) {
    const pick = randPick(itemPool);
    if (!items.includes(pick.id)) items.push(pick.id);
  }

  // メイン6枚（固有1 + 汎用5、サポカは最大1枚）
  const cards = ownCard ? [ownCard.id] : [];
  let mainHasSupport = false;
  while (cards.length < 6) {
    const pick = randPick(cardPool);
    if (pick.unique && cards.includes(pick.id)) continue;
    if (isSupportCard(pick) && mainHasSupport) continue;
    if (isSupportCard(pick)) mainHasSupport = true;
    cards.push(pick.id);
  }

  // サブ6枚（サブ固有1 + 汎用5、サポカは最大1枚）
  const subFirst = subOwnCard || ownCard;
  if (subFirst) cards.push(subFirst.id);
  let subHasSupport = false;
  while (cards.length < 12) {
    const pick = randPick(cardPool);
    if (pick.unique && cards.includes(pick.id)) continue;
    if (isSupportCard(pick) && subHasSupport) continue;
    if (isSupportCard(pick)) subHasSupport = true;
    cards.push(pick.id);
  }

  const customs = Array.from({ length: 12 }, () => ({}));
  return { items, cards, customs };
}

function toLoadout(baseLoadout, state) {
  const clone = structuredClone(baseLoadout);
  clone.pItemIds = state.items;
  clone.skillCardIdGroups = [state.cards.slice(0, 6), state.cards.slice(6, 12)];
  clone.customizationGroups = [state.customs.slice(0, 6), state.customs.slice(6, 12)];
  return clone;
}

async function optimizeDeck(
  baseLoadout,
  state,
  hasOwnCard,
  hasOwnItem,
  cardPool,
  itemPool,
  subCardPool,
  passes,
  fastRuns,
  silent = false
) {
  let current = structuredClone(state);
  let currentScore = (await evaluate(toLoadout(baseLoadout, current), fastRuns)).avg;

  for (let pass = 1; pass <= passes; pass++) {
    let improved = false;

    // Pアイテム最適化（4枠）
    const itemStart = hasOwnItem ? 1 : 0;
    for (let slot = itemStart; slot < 4; slot++) {
      let bestId = current.items[slot];
      for (const cand of itemPool) {
        if (cand.id === current.items[slot] || current.items.includes(cand.id)) continue;
        const next = structuredClone(current);
        next.items[slot] = cand.id;
        const score = (await evaluate(toLoadout(baseLoadout, next), fastRuns)).avg;
        if (score > currentScore) {
          currentScore = score;
          bestId = cand.id;
          improved = true;
        }
      }
      current.items[slot] = bestId;
    }

    // スキルカード最適化（スロット0=メイン固有固定、スロット6=サブ固有候補から選択、他=汎用）
    for (let slot = 0; slot < 12; slot++) {
      if (hasOwnCard && slot === 0) continue;

      if (hasOwnCard && slot === 6) {
        if (!subCardPool || subCardPool.length <= 1) continue;
        let bestId = current.cards[slot];
        for (const cand of subCardPool) {
          if (cand.id === current.cards[slot]) continue;
          const next = structuredClone(current);
          next.cards[slot] = cand.id;
          next.customs[slot] = {};
          const score = (await evaluate(toLoadout(baseLoadout, next), fastRuns)).avg;
          if (score > currentScore) {
            currentScore = score;
            bestId = cand.id;
            improved = true;
          }
        }
        current.cards[slot] = bestId;
        continue;
      }

      const groupAlreadyHasSupport = hasSupportCardInGroup(current.cards, slot);
      let bestId = current.cards[slot];
      for (const cand of cardPool) {
        if (cand.id === current.cards[slot]) continue;
        if (cand.unique && current.cards.some((id, idx) => idx !== slot && id === cand.id)) continue;
        // 同じメモリー（メイン/サブ）内にサポカカードは最大1枚まで
        if (isSupportCard(cand) && groupAlreadyHasSupport) continue;

        const next = structuredClone(current);
        next.cards[slot] = cand.id;
        next.customs[slot] = {};
        const score = (await evaluate(toLoadout(baseLoadout, next), fastRuns)).avg;
        if (score > currentScore) {
          currentScore = score;
          bestId = cand.id;
          improved = true;
        }
      }
      current.cards[slot] = bestId;
    }

    if (!silent) console.log(`  [デッキ第${pass}周] 暫定平均スコア: ${currentScore}`);
    if (!improved) break;
  }

  return current;
}

// メモリー1つあたり：通常カードは最大 maxNormalCards 枚まで、サポカは別枠でカスタム
// 各カードのカスタム回数上限はレアリティ準拠（R:3 / SR:2 / SSR:1）
async function optimizeCustomizations(baseLoadout, state, maxNormalCards, fastRuns) {
  if (maxNormalCards <= 0) return state;

  let current = structuredClone(state);
  let currentScore = (await evaluate(toLoadout(baseLoadout, current), fastRuns)).avg;

  const groups = [
    { name: "メイン", slots: [0, 1, 2, 3, 4, 5] },
    { name: "サブ", slots: [6, 7, 8, 9, 10, 11] },
  ];

  for (const group of groups) {
    for (let step = 0; step < 12; step++) {
      let customizedNormalCount = 0;
      for (const slot of group.slots) {
        const card = cardById.get(current.cards[slot]);
        const cnt = Object.values(current.customs[slot]).reduce((a, b) => a + b, 0);
        if (cnt > 0 && !isSupportCard(card)) customizedNormalCount++;
      }

      let bestMove = null;
      let bestScore = currentScore;

      for (const slot of group.slots) {
        const card = cardById.get(current.cards[slot]);
        const avail = card?.availableCustomizations || [];
        if (avail.length === 0) continue;

        const existingCount = Object.values(current.customs[slot]).reduce((a, b) => a + b, 0);
        const cardMax = getMaxCustomForCard(card);
        if (existingCount >= cardMax) continue;

        if (!isSupportCard(card) && existingCount === 0 && customizedNormalCount >= maxNormalCards) {
          continue;
        }

        for (const cid of avail) {
          const cObj = customById.get(String(cid));
          const maxPerType = cObj?.max ?? 1;
          const curCount = current.customs[slot][cid] || 0;
          if (curCount >= maxPerType) continue;

          const next = structuredClone(current);
          next.customs[slot][cid] = curCount + 1;
          const score = (await evaluate(toLoadout(baseLoadout, next), fastRuns)).avg;
          if (score > bestScore) {
            bestScore = score;
            bestMove = { slot, cid };
          }
        }
      }

      if (bestMove) {
        current.customs[bestMove.slot][bestMove.cid] =
          (current.customs[bestMove.slot][bestMove.cid] || 0) + 1;
        currentScore = bestScore;
      } else {
        break;
      }
    }
  }

  console.log(`  [カスタム最適化完了] 暫定平均スコア: ${currentScore}`);
  return current;
}

function formatCardWithCustom(cardId, customObj) {
  const name = cardById.get(cardId)?.name || `Card#${cardId}`;
  const entries = Object.entries(customObj || {}).filter(([, v]) => v > 0);
  if (entries.length === 0) return name;
  const cText = entries
    .map(([cid, cnt]) => {
      const cName = customById.get(String(cid))?.name || `C#${cid}`;
      return cnt > 1 ? `${cName}x${cnt}` : cName;
    })
    .join("+");
  return `${name}(${cText})`;
}

// サブの先頭カードからサブ衣装名を取得
function getSubIdolLabel(subCardId, mainPIdol) {
  const card = cardById.get(subCardId);
  if (!card?.pIdolId) return "なし";
  if (card.pIdolId === mainPIdol.id) return "メインと同じ";
  const sp = PIdols.getById(card.pIdolId);
  if (!sp) return "不明";
  const name = idolById.get(sp.idolId)?.name || "";
  return `${name}【${sp.title}】`;
}

// 全SSR（または所持SSRのみ）から予選で上位N人を自動選出する
async function selectTopSSR(stage, baseLoadout, topN, includeR, ownedSet, baseParams, paramMode) {
  const stagePlan = stage?.plan && stage.plan !== "free" ? stage.plan : null;

  const candidates = PIdols.getAll().filter((p) => {
    const name = idolById.get(p.idolId)?.name || "";
    const isPlayableSSR =
      p.rarity === "SSR" &&
      p.title &&
      !name.includes("亜紗里") &&
      (!stagePlan || p.plan === stagePlan);

    if (!isPlayableSSR) return false;
    if (ownedSet) {
      const fullLabel = `${name}【${p.title}】`;
      return ownedSet.has(String(p.id)) || ownedSet.has(fullLabel);
    }
    return true;
  });

  const modeLabel = ownedSet ? "所持SSRのみ" : "全SSR";
  console.log(`\n=== 予選開始 [${modeLabel}]: 対象 ${candidates.length}人から上位${topN}人を自動選出 ===`);

  if (candidates.length === 0) {
    console.log("  対象キャラが0人です。owned.json やステージ設定を確認してください。");
    return [];
  }

  // プランごとに共通の強いベースデッキを1回だけ作る
  const plans = [...new Set(candidates.map((p) => p.plan))];
  const planTemplates = new Map();
  for (const plan of plans) {
    console.log(`  [${plan}] 予選用ベースデッキを生成中...`);
    const { cardPool, itemPool } = buildPlanPools(plan, includeR);
    const init = createInitialState(null, null, null, cardPool, itemPool);
    const template = await optimizeDeck(baseLoadout, init, false, false, cardPool, itemPool, [], 1, 15, true);
    planTemplates.set(plan, template);
  }

  // 対象SSRの固有カード＆固有Pアイテム＋サブ固有＋得意属性ステで一斉評価
  const prelim = [];
  for (const pIdol of candidates) {
    const idolName = idolById.get(pIdol.idolId)?.name || "";
    const idolLoadout = withIdolParams(baseLoadout, idolName, baseParams, paramMode);
    const template = planTemplates.get(pIdol.plan);
    const { ownCard, ownItem } = getOwnAssets(pIdol);
    const subCards = getSubOwnCards(pIdol, ownedSet);
    const state = structuredClone(template);
    if (ownItem) state.items[0] = ownItem.id;
    if (ownCard) state.cards[0] = ownCard.id;
    if (subCards.length > 0) {
      state.cards[6] = subCards[0].id;
    } else if (ownCard) {
      state.cards[6] = ownCard.id;
    }

    const score = (await evaluate(toLoadout(idolLoadout, state), 30)).avg;
    prelim.push({ pIdol, score, initState: state });
  }

  prelim.sort((a, b) => b.score - a.score);
  const winners = prelim.slice(0, topN);

  console.log(`\n=== 予選突破 上位${winners.length}キャラ ===`);
  winners.forEach((w, i) => {
    const name = idolById.get(w.pIdol.idolId)?.name || `Idol#${w.pIdol.idolId}`;
    console.log(`  ${i + 1}位: ${name}【${w.pIdol.title}】(${w.pIdol.plan}) 予選スコア: ${w.score}`);
  });

  return winners;
}

// 1ステージ分の探索を実行
async function runForStage(stageId, stageLabel, cfg) {
  const stage = Stages.getById(stageId);
  if (!stage) {
    console.warn(`ステージID ${stageId} が見つかりません。スキップします。`);
    return null;
  }

  const paramMode = cfg.paramMode || "fixed";
  const ownedSet = loadOwnedSet(cfg.onlyOwned);
  console.log("\n########################################################");
  console.log(`  ${stageLabel} (ID: ${stageId} / プラン: ${stage.plan || "free"} / ステ割当: ${paramMode})`);
  console.log("########################################################");

  const baseQuery = `stage=${stageId}&support_bonus=${cfg.supportBonus}&params=${cfg.params.join("-")}`;
  const baseLoadout = loadoutFromQuery(baseQuery);
  const summary = [];

  const passes = cfg.search?.passes ?? 2;
  const fastRuns = cfg.search?.fastRuns ?? 20;
  const finalRuns = cfg.search?.finalRuns ?? 500;
  const includeR = cfg.search?.includeR ?? false;
  const maxCustomCards = cfg.search?.maxCustomPerCard ?? 2;

  let targetEntries = [];
  if (cfg.pIdolIds === "auto") {
    const topN = cfg.onlyOwned
      ? (cfg.autoTopNOwned ?? 5)
      : (cfg.autoTopNAll ?? 8);
    targetEntries = await selectTopSSR(stage, baseLoadout, topN, includeR, ownedSet, cfg.params, paramMode);
  } else {
    targetEntries = cfg.pIdolIds
      .map((id) => ({ pIdol: PIdols.getById(id), initState: null }))
      .filter((e) => e.pIdol);
  }

  for (const { pIdol, initState: presetState } of targetEntries) {
    const idolName = idolById.get(pIdol.idolId)?.name || `Idol#${pIdol.idolId}`;
    const label = `${idolName}【${pIdol.title}】(${pIdol.plan})`;
    const idolLoadout = withIdolParams(baseLoadout, idolName, cfg.params, paramMode);
    const [vo, da, vi] = idolLoadout.params;

    const { ownCard, ownItem } = getOwnAssets(pIdol);
    const subCardPool = getSubOwnCards(pIdol, ownedSet);
    const { cardPool, itemPool } = buildPlanPools(pIdol.plan, includeR);
    console.log(`\n▶ 本選ガチ探索: ${label} [Vo:${vo} / Da:${da} / Vi:${vi}] (サブ候補: ${subCardPool.length}種)`);

    const startState = presetState || createInitialState(ownCard, subCardPool[0] || ownCard, ownItem, cardPool, itemPool);
    const deckOptimized = await optimizeDeck(
      idolLoadout,
      startState,
      !!ownCard,
      !!ownItem,
      cardPool,
      itemPool,
      subCardPool,
      passes,
      fastRuns
    );
    const fullOptimized = await optimizeCustomizations(
      idolLoadout,
      deckOptimized,
      maxCustomCards,
      fastRuns
    );

    const finalStats = await evaluate(toLoadout(idolLoadout, fullOptimized), finalRuns);
    const subIdolLabel = getSubIdolLabel(fullOptimized.cards[6], pIdol);

    summary.push({
      キャラ: label,
      サブ衣装: subIdolLabel,
      ステ: `${vo}/${da}/${vi}`,
      平均スコア: finalStats.avg,
      下振れ20: finalStats.p20,
      上振れ90: finalStats.p90,
      最適Pアイテム: fullOptimized.items.map((id) => itemById.get(id)?.name).join(", "),
      メイン: fullOptimized.cards
        .slice(0, 6)
        .map((id, i) => formatCardWithCustom(id, fullOptimized.customs[i]))
        .join(", "),
      サブ: fullOptimized.cards
        .slice(6, 12)
        .map((id, i) => formatCardWithCustom(id, fullOptimized.customs[i + 6]))
        .join(", "),
    });
  }

  summary.sort((a, b) => b.平均スコア - a.平均スコア);

  console.log(`\n========================================================`);
  console.log(`  ★ ${stageLabel} (ID:${stageId}) 最適編成ランキング`);
  console.log(`========================================================`);
  console.table(
    summary.map((s) => ({
      キャラ: s.キャラ,
      サブ衣装: s.サブ衣装,
      "Vo/Da/Vi": s.ステ,
      平均スコア: s.平均スコア,
      "下振れ(20%)": s.下振れ20,
      "上振れ(90%)": s.上振れ90,
      最適Pアイテム: s.最適Pアイテム,
    }))
  );

  console.log(`\n--- ${stageLabel} の最適デッキ＆カスタム詳細 ---`);
  summary.forEach((s, i) => {
    console.log(`\n[${i + 1}位] ${s.キャラ} [Vo/Da/Vi: ${s.ステ}] (平均: ${s.平均スコア} / 下振れ: ${s.下振れ20})`);
    console.log(`  サブ衣装 : ${s.サブ衣装}`);
    console.log(`  Pアイテム: ${s.最適Pアイテム}`);
    console.log(`  メイン   : [${s.メイン}]`);
    console.log(`  サブ     : [${s.サブ}]`);
  });

  return { stageLabel, stageId, top: summary[0] || null };
}

// 実行対象ステージの決定（コマンド引数があれば auto-config.json より優先）
const cfg = JSON.parse(readFileSync("my-optimizer/auto-config.json", "utf8"));
const [argStage, argMode] = process.argv.slice(2);

if (argMode === "all") cfg.onlyOwned = false;
else if (argMode === "owned") cfg.onlyOwned = true;

const stageIds = cfg.stageIds || (cfg.stageId ? [cfg.stageId] : []);
const rawTarget = argStage ?? cfg.targetStage ?? "all";
const target = rawTarget === "all" ? "all" : Number(rawTarget);

let runList = [];
if (target === "all") {
  runList = stageIds.map((id, idx) => ({ id, label: `ステージ${idx + 1}` }));
} else if (typeof target === "number" && target >= 1 && target <= stageIds.length) {
  runList = [{ id: stageIds[target - 1], label: `ステージ${target}` }];
} else {
  runList = [{ id: Number(target), label: `ステージ(ID:${target})` }];
}

const allStageTops = [];
for (const item of runList) {
  const res = await runForStage(item.id, item.label, cfg);
  if (res) allStageTops.push(res);
}

// 複数ステージ実行時は、最後に全ステージの1位まとめを表示
if (allStageTops.length > 1) {
  console.log("\n========================================================");
  console.log("  ★ 全ステージ 1位まとめ");
  console.log("========================================================");
  console.table(
    allStageTops.map((r) => ({
      ステージ: `${r.stageLabel} (ID:${r.stageId})`,
      "1位キャラ": r.top ? r.top.キャラ : "なし",
      サブ衣装: r.top ? r.top.サブ衣装 : "-",
      平均スコア: r.top ? r.top.平均スコア : 0,
      "下振れ(20%)": r.top ? r.top.下振れ20 : 0,
    }))
  );
}