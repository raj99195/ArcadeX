/**
 * scripts/deployMainnet.js
 * Smart deploy/redeploy script — reuses any contract that's already
 * deployed for this chain and hasn't changed, and only deploys fresh
 * copies of the contracts that actually changed this round (Platform +
 * Tournament). This avoids orphaning existing Leaderboard/CreatorNFT/
 * CampaignBadge/GameItems state (registered creators, minted badges,
 * purchased skins, score history) on every run.
 *
 * Usage:
 *   MIN_REWARD_RATE=1 MAX_REWARD_RATE=2 npx hardhat run scripts/deployMainnet.js --network mst
 *
 * Flags (all optional):
 *   FORCE_REDEPLOY_ALL=true   Deploy every contract fresh — use this ONLY
 *                             for a brand-new chain that has nothing
 *                             deployed yet. On an existing chain this
 *                             orphans all current state (see warning above).
 *   MIGRATE_GAMES=true        After deploying, also re-register every
 *                             Firestore-approved game onto the new Platform
 *                             (same logic as migrateGames.js, run inline).
 *   FORCE_REWARD_RATE=<n>     Used with MIGRATE_GAMES — overrides every
 *                             migrated game's rate to a fixed safe value
 *                             (required on native-token chains — see
 *                             migrateGames.js's own docs for why).
 *
 * Reads:  deployedAddresses.json (existing addresses to reuse, rewardPool)
 * Writes: deployedAddresses.json (one atomic write at the end)
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const DEPLOYED_ADDRESSES_PATH = path.join(__dirname, "..", "src", "config", "deployedAddresses.json");

const NATIVE_TOKEN_CHAINS = ["mst"];
const REWARD_SYMBOLS = { mst: "MSTC", botchain: "ARCADE", botchain_mainnet: "ARCADE", somnia: "ARCADE" };

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
const BADGE_TYPES = [
  { name: "Genesis Badge", maxSupply: 5000, cid: "bafybeibhag5qletlincnrhgdclslvp5kfxvvzad3hqeepgxm3bhm5g2lpa" },
  { name: "Pioneer Badge", maxSupply: 500,  cid: "bafybeifr5wrcrcie4rdi2ivkfk6h2dpyy24vu3qojc57ohfffeqckptgte" },
  { name: "Legend Badge",  maxSupply: 50,   cid: "bafybeicglxyoruen7mmaxyvsccrfvcpzniv4ro3pduozzw2vuydaxf4nhq" },
  { name: "Creator Badge", maxSupply: 100,  cid: "bafybeifnoimsaejey6qihipatzbcpor3f6qgtxswgcktbrl4k2wynic4r4" },
  { name: "Builder Badge", maxSupply: 10,   cid: "bafybeifnmwfh5yxkbudxb7lu35s5vcqm3m5argpcs52deaa3oiflfv57la" },
];

const E18 = ethers.parseEther;
const SKIN_ITEM_TYPE = 3;
const AVATAR_STYLES = [
  { name: "Style: Adventurer", desc: "Unlock Adventurer avatar style — gamer cartoon look",   price: E18("100"), supply: 0 },
  { name: "Style: Lorelei",    desc: "Unlock Lorelei avatar style — anime-inspired character", price: E18("100"), supply: 0 },
  { name: "Style: Notionists", desc: "Unlock Notionists avatar style — minimal line art",       price: E18("300"), supply: 0 },
  { name: "Style: Micah",      desc: "Unlock Micah avatar style — modern illustration",         price: E18("300"), supply: 0 },
  { name: "Style: Rings",      desc: "Unlock Rings avatar style — abstract geometric design",   price: E18("500"), supply: 0 },
  { name: "Style: Shapes",     desc: "Unlock Shapes avatar style — bold abstract art",          price: E18("500"), supply: 0 },
  { name: "Style: Thumbs",     desc: "Unlock Thumbs avatar style — ultra rare character",       price: E18("800"), supply: 0 },
  { name: "Style: Croodles",   desc: "Unlock Croodles avatar style — hand-drawn exclusive",     price: E18("800"), supply: 0 },
];

const FORCE_REDEPLOY_ALL = process.env.FORCE_REDEPLOY_ALL === "true";
const MIGRATE_GAMES = process.env.MIGRATE_GAMES === "true";
const FORCE_REWARD_RATE = process.env.FORCE_REWARD_RATE ? parseInt(process.env.FORCE_REWARD_RATE) : null;

async function fetchApprovedGamesFromFirestore() {
  const admin = require("firebase-admin");
  const serviceAccount = require("./serviceAccountKey.json");
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();
  const snap = await db.collection("games").where("status", "==", "approved").get();
  return snap.docs.map(d => {
    const data = d.data();
    return { gameId: data.gameId, name: data.name, creator: data.creator, iframeUrl: data.iframeUrl || "", rewardRate: data.rewardRate || 50 };
  }).sort((a, b) => a.gameId - b.gameId);
}

async function main() {
  const chainKey = hre.network.name;
  const isNativeToken = NATIVE_TOKEN_CHAINS.includes(chainKey);
  const rewardTokenSymbol = process.env.REWARD_TOKEN_SYMBOL || REWARD_SYMBOLS[chainKey] || "ARCADE";
  const minRewardRate = parseInt(process.env.MIN_REWARD_RATE ?? (isNativeToken ? "1" : "5"));
  const maxRewardRate = parseInt(process.env.MAX_REWARD_RATE ?? (isNativeToken ? "2" : "500"));

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🚀 ArcadeX DEPLOY — chain: ${chainKey}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`isNativeToken: ${isNativeToken}  |  reward token: ${rewardTokenSymbol}`);
  console.log(`Platform reward rate limits: ${minRewardRate}–${maxRewardRate}`);
  console.log(`FORCE_REDEPLOY_ALL: ${FORCE_REDEPLOY_ALL}  |  MIGRATE_GAMES: ${MIGRATE_GAMES}`);
  if (isNativeToken && maxRewardRate > 10) {
    console.warn(`⚠️  WARNING: native-token chain with maxRewardRate ${maxRewardRate} — this pays REAL tokens per play.`);
  }
  if (FORCE_REDEPLOY_ALL) {
    console.warn(`\n⚠️  FORCE_REDEPLOY_ALL=true — every contract will be deployed FRESH, including`);
    console.warn(`   Leaderboard, CreatorNFT, CampaignBadge, GameItems. This ORPHANS all existing`);
    console.warn(`   state on those contracts (scores, creator profiles, minted badges/items).`);
    console.warn(`   Only use this for a brand-new chain with nothing deployed yet.\n`);
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  let allAddresses = {};
  try { allAddresses = JSON.parse(fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8")); } catch { /* fresh file is fine */ }
  const existing = allAddresses[chainKey] || {};
  const addrs = { ...existing }; // start from what's already there, overwrite only what we (re)deploy

  // ── Helper: reuse an existing address unless forced to redeploy ──
  const shouldReuse = (key) => !FORCE_REDEPLOY_ALL && !!existing[key];

  // ════════════════════════════════════════════════════════════
  // 1. ArcadeToken — ERC-20 chains only, reused if it already exists
  // ════════════════════════════════════════════════════════════
  let arcadeTokenAddress = ethers.ZeroAddress;
  if (!isNativeToken) {
    if (shouldReuse("token")) {
      arcadeTokenAddress = existing.token;
      console.log("\n♻️  [1/8] Reusing existing ArcadeToken:", arcadeTokenAddress);
    } else {
      console.log("\n📦 [1/8] Deploying ArcadeToken...");
      const ArcadeToken = await ethers.getContractFactory("ArcadeToken");
      const arcadeToken = await ArcadeToken.deploy(deployer.address);
      await arcadeToken.waitForDeployment();
      arcadeTokenAddress = await arcadeToken.getAddress();
      addrs.token = arcadeTokenAddress;
      console.log("✅ ArcadeToken:", arcadeTokenAddress);
    }
  } else {
    console.log("\n⏭️  [1/8] Skipping ArcadeToken — native-token chain.");
  }

  // ════════════════════════════════════════════════════════════
  // 2. Leaderboard — reused if it already exists
  // ════════════════════════════════════════════════════════════
  let leaderboardAddress;
  if (shouldReuse("leaderboard")) {
    leaderboardAddress = existing.leaderboard;
    console.log("♻️  [2/8] Reusing existing Leaderboard:", leaderboardAddress);
  } else {
    console.log("\n📦 [2/8] Deploying Leaderboard...");
    const Leaderboard = await ethers.getContractFactory("Leaderboard");
    const leaderboard = await Leaderboard.deploy(deployer.address);
    await leaderboard.waitForDeployment();
    leaderboardAddress = await leaderboard.getAddress();
    addrs.leaderboard = leaderboardAddress;
    console.log("✅ Leaderboard:", leaderboardAddress);
  }
  const leaderboard = await ethers.getContractAt("Leaderboard", leaderboardAddress);

  // ════════════════════════════════════════════════════════════
  // 3. Platform — ALWAYS deployed fresh (this is what changed this round)
  // ════════════════════════════════════════════════════════════
  console.log("\n📦 [3/8] Deploying Platform (always fresh — this changed this round)...");
  const rewardPool = isNativeToken ? (existing.rewardPool || deployer.address) : ethers.ZeroAddress;
  if (isNativeToken && !existing.rewardPool) {
    console.warn(`⚠️  No pre-set "rewardPool" for ${chainKey} — defaulting to deployer address.`);
  }
  const Platform = await ethers.getContractFactory("Platform");
  const platform = await Platform.deploy(
    deployer.address,
    isNativeToken ? ethers.ZeroAddress : arcadeTokenAddress,
    leaderboardAddress,
    isNativeToken,
    rewardPool,
    rewardTokenSymbol,
    minRewardRate,
    maxRewardRate
  );
  await platform.waitForDeployment();
  const platformAddress = await platform.getAddress();
  addrs.platform = platformAddress;
  if (isNativeToken) addrs.rewardPool = rewardPool;
  console.log("✅ Platform:", platformAddress);

  // ════════════════════════════════════════════════════════════
  // 4. CreatorNFT — reused if it already exists
  // ════════════════════════════════════════════════════════════
  let creatorNFTAddress;
  if (shouldReuse("creatorNft")) {
    creatorNFTAddress = existing.creatorNft;
    console.log("♻️  [4/8] Reusing existing CreatorNFT:", creatorNFTAddress);
  } else {
    console.log("\n📦 [4/8] Deploying CreatorNFT...");
    const CreatorNFT = await ethers.getContractFactory("CreatorNFT");
    const creatorNFT = await CreatorNFT.deploy(deployer.address);
    await creatorNFT.waitForDeployment();
    creatorNFTAddress = await creatorNFT.getAddress();
    addrs.creatorNft = creatorNFTAddress;
    console.log("✅ CreatorNFT:", creatorNFTAddress);
  }

  // ════════════════════════════════════════════════════════════
  // 5. Tournament — ALWAYS deployed fresh (this changed this round too)
  // ════════════════════════════════════════════════════════════
  console.log("\n📦 [5/8] Deploying Tournament (always fresh — this changed this round)...");
  const Tournament = await ethers.getContractFactory("Tournament");
  const tournament = await Tournament.deploy(
    deployer.address,
    isNativeToken ? ethers.ZeroAddress : arcadeTokenAddress,
    isNativeToken,
    rewardTokenSymbol
  );
  await tournament.waitForDeployment();
  const tournamentAddress = await tournament.getAddress();
  addrs.tournament = tournamentAddress;
  console.log("✅ Tournament:", tournamentAddress);
  console.log("   ⚠️  Any tournaments on the OLD Tournament contract are now unreachable from the app.");

  // ════════════════════════════════════════════════════════════
  // 6. ArcadeMarketplace — reused if it already exists
  // ════════════════════════════════════════════════════════════
  let marketplaceAddress;
  let marketplace;
  let marketplaceIsFresh = false;
  const chainDisplayName = { mst: "MST Blockchain", botchain: "BOTChain", botchain_mainnet: "BOTChain", somnia: "Somnia" }[chainKey] || chainKey;
  if (shouldReuse("marketplace")) {
    marketplaceAddress = existing.marketplace;
    console.log("♻️  [6/8] Reusing existing ArcadeMarketplace:", marketplaceAddress);
    marketplace = await ethers.getContractAt("ArcadeMarketplace", marketplaceAddress);
  } else {
    console.log("\n📦 [6/8] Deploying ArcadeMarketplace...");
    const ArcadeMarketplace = await ethers.getContractFactory("ArcadeMarketplace");
    marketplace = await ArcadeMarketplace.deploy(
      deployer.address,
      isNativeToken ? ethers.ZeroAddress : arcadeTokenAddress,
      isNativeToken,
      rewardTokenSymbol,
      chainDisplayName
    );
    await marketplace.waitForDeployment();
    marketplaceAddress = await marketplace.getAddress();
    addrs.marketplace = marketplaceAddress;
    marketplaceIsFresh = true;
    console.log("✅ ArcadeMarketplace:", marketplaceAddress);
  }

  // ════════════════════════════════════════════════════════════
  // 7. CampaignBadge — reused if it already exists (badge types only
  //    created when the contract is genuinely fresh, to avoid duplicates)
  // ════════════════════════════════════════════════════════════
  let campaignBadgeAddress;
  let campaignBadgeIsFresh = false;
  const badgeTypeIds = {};
  if (shouldReuse("campaignBadge")) {
    campaignBadgeAddress = existing.campaignBadge;
    console.log("♻️  [7/8] Reusing existing CampaignBadge:", campaignBadgeAddress);
  } else {
    console.log("\n📦 [7/8] Deploying CampaignBadge...");
    const CampaignBadge = await ethers.getContractFactory("CampaignBadge");
    const campaignBadge = await CampaignBadge.deploy(deployer.address);
    await campaignBadge.waitForDeployment();
    campaignBadgeAddress = await campaignBadge.getAddress();
    addrs.campaignBadge = campaignBadgeAddress;
    campaignBadgeIsFresh = true;
    console.log("✅ CampaignBadge:", campaignBadgeAddress);

    console.log("\n🏷️  Creating campaign badge types...");
    for (const b of BADGE_TYPES) {
      const imageURI = IPFS_GATEWAY + b.cid;
      try {
        const tx = await campaignBadge.createBadgeType(b.name, b.maxSupply, imageURI, { gasLimit: 500000 });
        const receipt = await tx.wait();
        const event = receipt.logs
          .map(log => { try { return campaignBadge.interface.parseLog(log); } catch { return null; } })
          .find(e => e?.name === "BadgeTypeCreated");
        badgeTypeIds[b.name] = event ? event.args.badgeTypeId.toString() : "?";
        console.log(`   ✅ ${b.name} → badgeTypeId ${badgeTypeIds[b.name]}`);
      } catch (err) {
        console.error(`   ❌ ${b.name} failed: ${err.shortMessage || err.message}`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 8. GameItems — reused if it already exists
  // ════════════════════════════════════════════════════════════
  let gameItemsAddress;
  if (shouldReuse("gameItems")) {
    gameItemsAddress = existing.gameItems;
    console.log("♻️  [8/8] Reusing existing GameItems:", gameItemsAddress);
  } else {
    console.log("\n📦 [8/8] Deploying GameItems...");
    const GameItems = await ethers.getContractFactory("GameItems");
    const gameItems = await GameItems.deploy(
      deployer.address,
      isNativeToken ? ethers.ZeroAddress : arcadeTokenAddress,
      isNativeToken
    );
    await gameItems.waitForDeployment();
    gameItemsAddress = await gameItems.getAddress();
    addrs.gameItems = gameItemsAddress;
    console.log("✅ GameItems:", gameItemsAddress);
  }

  // ════════════════════════════════════════════════════════════
  // 9. Roles — MUST run every time, even when Leaderboard/ArcadeToken are
  //    reused, because the new Platform/Tournament addresses still need
  //    to be granted access on whichever contract they call into.
  // ════════════════════════════════════════════════════════════
  console.log("\n⚙️  Setting up roles...");
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  await (await leaderboard.grantRole(OPERATOR_ROLE, platformAddress)).wait();
  console.log("✅ OPERATOR_ROLE → new Platform (on Leaderboard)");

  if (!isNativeToken) {
    const PLATFORM_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ROLE"));
    const arcadeToken = await ethers.getContractAt("ArcadeToken", arcadeTokenAddress);
    await (await arcadeToken.grantRole(PLATFORM_ROLE, platformAddress)).wait();
    console.log("✅ PLATFORM_ROLE → new Platform (on ArcadeToken)");
    await (await arcadeToken.grantRole(PLATFORM_ROLE, tournamentAddress)).wait();
    console.log("✅ PLATFORM_ROLE → new Tournament (on ArcadeToken)");
    if (marketplaceAddress) {
      await (await arcadeToken.grantRole(PLATFORM_ROLE, marketplaceAddress)).wait();
      console.log("✅ PLATFORM_ROLE → Marketplace (on ArcadeToken)");
    }

    if (marketplaceIsFresh) {
      console.log(`\n🎨 Adding ${AVATAR_STYLES.length} avatar style items to Marketplace...`);
      for (const style of AVATAR_STYLES) {
        try {
          const tx = await marketplace.addItem(style.name, style.desc, "", SKIN_ITEM_TYPE, style.price, 0, style.supply, { gasLimit: 300000 });
          await tx.wait();
          console.log(`   ✅ ${style.name}`);
        } catch (err) {
          console.error(`   ❌ ${style.name} failed: ${err.shortMessage || err.message}`);
        }
      }
    } else {
      console.log("⏭️  Marketplace reused, not fresh — skipping avatar-style item creation (already exist there).");
    }
  } else {
    console.log("⏭️  Skipping ArcadeToken-related roles + avatar styles — native chain.");
  }

  // ════════════════════════════════════════════════════════════
  // 10. Optional: migrate existing games onto the new Platform
  // ════════════════════════════════════════════════════════════
  if (MIGRATE_GAMES) {
    console.log(`\n📡 MIGRATE_GAMES=true — fetching approved games from Firestore...`);
    if (isNativeToken && FORCE_REWARD_RATE === null) {
      console.warn(`⚠️  Native-token chain but FORCE_REWARD_RATE not set — games will migrate with`);
      console.warn(`   their stored (likely ARCADE-context) rewardRate, which may exceed this`);
      console.warn(`   contract's maxRewardRate (${maxRewardRate}). Strongly recommend setting`);
      console.warn(`   FORCE_REWARD_RATE explicitly for native chains.`);
    }
    try {
      const gamesToMigrate = await fetchApprovedGamesFromFirestore();
      console.log(`Found ${gamesToMigrate.length} approved games.`);
      for (const game of gamesToMigrate) {
        const rate = FORCE_REWARD_RATE !== null ? FORCE_REWARD_RATE : game.rewardRate;
        try {
          const tx = await platform.adminRegisterAndApprove(game.gameId, game.creator, game.name, game.iframeUrl, rate, { gasLimit: 500000 });
          await tx.wait();
          console.log(`   ✅ #${game.gameId} — ${game.name} | rate ${rate}`);
        } catch (err) {
          console.error(`   ❌ #${game.gameId} — ${game.name} failed: ${err.shortMessage || err.message}`);
        }
      }
    } catch (err) {
      console.error("❌ Game migration failed:", err.message);
      console.log("   Run scripts/migrateGames.js separately once serviceAccountKey.json / firebase-admin are set up.");
    }
  } else {
    console.log("\n⏭️  MIGRATE_GAMES not set — skipping game migration. Run migrateGames.js separately, or re-run with MIGRATE_GAMES=true.");
  }

  // ════════════════════════════════════════════════════════════
  // WRITE — one atomic write, everything at once
  // ════════════════════════════════════════════════════════════
  console.log(`\n💾 Writing addresses to deployedAddresses.json under "${chainKey}"...`);
  try {
    allAddresses[chainKey] = { ...addrs, deployedAt: new Date().toISOString() };
    fs.writeFileSync(DEPLOYED_ADDRESSES_PATH, JSON.stringify(allAddresses, null, 2) + "\n");
    console.log(`✅ deployedAddresses.json updated for "${chainKey}"`);
  } catch (err) {
    console.error(`❌ Failed to write deployedAddresses.json: ${err.message}`);
    console.log("Copy these addresses in manually:", JSON.stringify(addrs, null, 2));
  }

  // ════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════
  console.log(`\n${"=".repeat(60)}`);
  console.log("🎉 DONE!");
  console.log(`${"=".repeat(60)}`);
  console.log("Chain:          ", chainKey);
  console.log("ArcadeToken:    ", addrs.token || "N/A (native chain)");
  console.log("Leaderboard:    ", addrs.leaderboard, shouldReuse("leaderboard") ? "(reused)" : "(fresh)");
  console.log("Platform:       ", addrs.platform, "(fresh — this round's change)");
  console.log("CreatorNFT:     ", addrs.creatorNft, shouldReuse("creatorNft") ? "(reused)" : "(fresh)");
  console.log("Tournament:     ", addrs.tournament, "(fresh — this round's change)");
  console.log("Marketplace:    ", addrs.marketplace, marketplaceIsFresh ? "(fresh)" : "(reused)");
  console.log("CampaignBadge:  ", addrs.campaignBadge, campaignBadgeIsFresh ? "(fresh)" : "(reused)");
  console.log("GameItems:      ", addrs.gameItems, shouldReuse("gameItems") ? "(reused)" : "(fresh)");
  if (isNativeToken) console.log("RewardPool:     ", addrs.rewardPool);
  console.log(`${"=".repeat(60)}`);

  console.log("\n📝 Next steps:");
  if (isNativeToken) {
    console.log(`   1. Fund the NEW Platform contract itself (${platformAddress}) with native tokens.`);
    console.log(`      (Balance check is against address(this) now, not a separate rewardPool wallet.)`);
  }
  if (!MIGRATE_GAMES) {
    console.log(`   2. Run: MIGRATE_GAMES=true ${isNativeToken ? "FORCE_REWARD_RATE=<n> " : ""}npx hardhat run scripts/deployMainnet.js --network ${chainKey}`);
    console.log(`      or scripts/migrateGames.js separately, to bring existing games onto the new Platform.`);
  }
  console.log(`   3. If MST admin panel needs a scoreSigner or tighter caps, call those setters`);
  console.log(`      on the new Platform (${platformAddress}) — see AdminMST.jsx.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
