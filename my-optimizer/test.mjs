// 本家のデータパッケージを読み込む
import { SkillCards, Idols, Stages } from "gakumas-data";

console.log("=== データ読み込みテスト ===");
console.log("登録アイドル数:", Idols.getAll().length);
console.log("登録スキルカード数:", SkillCards.getAll().length);

// 例として最初のスキルカードを1件だけ表示してみる
const sampleCard = SkillCards.getAll()[0];
console.log("サンプルカード:", sampleCard.id, sampleCard.name);