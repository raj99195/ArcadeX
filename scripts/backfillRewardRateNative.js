/**
 * scripts/backfillRewardRateNative.js
 * One-time backfill: adds `rewardRateNative` to every Firestore `games`
 * document that doesn't already have it — for games submitted before the
 * dual reward-rate (ARCADE / native) split existed.
 *
 * Does NOT touch anything on-chain — this is purely a Firestore write, so
 * it's safe to run any time. The fallback logic in the frontend already
 * treats a missing field as `1`, so this is a cleanup step, not a fix for
 * a broken display.
 *
 * Usage:
 *   node scripts/backfillRewardRateNative.js
 *   node scripts/backfillRewardRateNative.js --rate=2      (use a different default)
 *   node scripts/backfillRewardRateNative.js --dry-run      (preview only, no writes)
 */

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rateArg = args.find(a => a.startsWith("--rate="));
const DEFAULT_NATIVE_RATE = rateArg ? parseInt(rateArg.split("=")[1]) : 1;

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  const db = admin.firestore();

  console.log(`\n🔎 Scanning "games" collection for missing rewardRateNative...`);
  console.log(`   Default value to backfill: ${DEFAULT_NATIVE_RATE}`);
  if (dryRun) console.log("   (DRY RUN — no writes will be made)\n");

  const snap = await db.collection("games").get();
  if (snap.empty) {
    console.log("❌ No games found in Firestore.");
    return;
  }

  let missing = [];
  snap.forEach(doc => {
    const data = doc.data();
    if (data.rewardRateNative === undefined || data.rewardRateNative === null) {
      missing.push({ id: doc.id, name: data.name, gameId: data.gameId, rewardRate: data.rewardRate });
    }
  });

  console.log(`\n📊 ${snap.size} total games | ${missing.length} missing rewardRateNative:\n`);
  missing.forEach(g => console.log(`   #${g.gameId} — ${g.name} (ARCADE rate: ${g.rewardRate})`));

  if (missing.length === 0) {
    console.log("\n✅ Nothing to backfill — every game already has rewardRateNative.");
    return;
  }

  if (dryRun) {
    console.log(`\n✅ Dry run complete — ${missing.length} games would be updated. Re-run without --dry-run to apply.`);
    return;
  }

  console.log(`\n⚙️  Backfilling ${missing.length} games...\n`);
  let updated = 0;
  for (const g of missing) {
    try {
      await db.collection("games").doc(g.id).update({ rewardRateNative: DEFAULT_NATIVE_RATE });
      console.log(`   ✅ #${g.gameId} — ${g.name} → rewardRateNative: ${DEFAULT_NATIVE_RATE}`);
      updated++;
    } catch (err) {
      console.error(`   ❌ #${g.gameId} — ${g.name} — failed: ${err.message}`);
    }
  }

  console.log(`\n🎉 Backfill complete! ${updated}/${missing.length} games updated.`);
}

main().catch(err => { console.error(err); process.exit(1); });
