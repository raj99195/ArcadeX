const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const DEPLOYED_ADDRESSES_PATH = path.join(__dirname, "..", "src", "config", "deployedAddresses.json");

// ── Per-chain config ──────────────────────────────────────────────────────────
const CHAIN_CONFIG = {
  botchain: {
    isNativeToken:     false,
    rewardPool:        "",
    rewardTokenSymbol: "ARCADE",
    chainDisplayName:  "BOTChain",
    minRewardRate:     10,
    maxRewardRate:     500,
  },
  somnia: {
    isNativeToken:     false,
    rewardPool:        "",
    rewardTokenSymbol: "ARCADE",
    chainDisplayName:  "Somnia",
    minRewardRate:     10,
    maxRewardRate:     500,
  },
  mst_testnet: {
    isNativeToken:     true,
    rewardPool:        process.env.MST_REWARD_POOL_ADDRESS || "",
    rewardTokenSymbol: "MSTC",
    chainDisplayName:  "MST Blockchain",
    minRewardRate:     5,
    maxRewardRate:     200,
  },
  mst: {
    isNativeToken:     true,
    rewardPool:        process.env.MST_REWARD_POOL_ADDRESS || "",
    rewardTokenSymbol: "MSTC",
    chainDisplayName:  "MST Blockchain",
    minRewardRate:     5,
    maxRewardRate:     200,
  },
};

// ── Avatar styles (for Marketplace re-add) ────────────────────────────────────
const SKIN_ITEM_TYPE = 3;
const E18 = ethers.parseEther;
const AVATAR_STYLES = [
  { name: "Style: Adventurer", desc: "Unlock Adventurer avatar style — gamer cartoon look",   price: E18("100"), supply: 0 },
  { name: "Style: Lorelei",    desc: "Unlock Lorelei avatar style — anime-inspired character", price: E18("100"), supply: 0 },
  { name: "Style: Notionists", desc: "Unlock Notionists avatar style — minimal line art",      price: E18("300"), supply: 0 },
  { name: "Style: Micah",      desc: "Unlock Micah avatar style — modern illustration",        price: E18("300"), supply: 0 },
  { name: "Style: Rings",      desc: "Unlock Rings avatar style — abstract geometric design",  price: E18("500"), supply: 0 },
  { name: "Style: Shapes",     desc: "Unlock Shapes avatar style — bold abstract art",         price: E18("500"), supply: 0 },
  { name: "Style: Thumbs",     desc: "Unlock Thumbs avatar style — ultra rare character",      price: E18("800"), supply: 0 },
  { name: "Style: Croodles",   desc: "Unlock Croodles avatar style — hand-drawn exclusive",    price: E18("800"), supply: 0 },
];

async function main() {
  const chainKey = hre.network.name;
  const addressKey = chainKey.replace("_testnet", "");

  console.log(`\n🔗 Deploying updated contracts to: ${chainKey}\n`);
  console.log("📌 Only deploying: Platform + Tournament + ArcadeMarketplace");
  console.log("📌 Keeping existing: ArcadeToken, Leaderboard, CreatorNFT, CampaignBadge\n");

  // ── Validate ──────────────────────────────────────────────────────────────
  const cfg = CHAIN_CONFIG[chainKey];
  if (!cfg) throw new Error(`No CHAIN_CONFIG entry for "${chainKey}". Add one to deployUpdated.js.`);
  if (cfg.isNativeToken && !cfg.rewardPool) {
    throw new Error("MST_REWARD_POOL_ADDRESS not set in .env — required for native token chains.");
  }

  // ── Read existing addresses ───────────────────────────────────────────────
  const raw = fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8");
  const allAddresses = JSON.parse(raw);
  const existing = allAddresses[addressKey];

  if (!existing) throw new Error(`No existing deployment found for "${addressKey}" in deployedAddresses.json. Run deploy.js first.`);

  console.log("📋 Existing addresses (keeping these):");
  console.log("   ArcadeToken: ", existing.token);
  console.log("   Leaderboard: ", existing.leaderboard);
  console.log("   CreatorNFT:  ", existing.creatorNft);
  console.log("   CampaignBadge:", existing.campaignBadge);
  console.log("");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // Use existing ArcadeToken address for ERC-20 chains
  const arcadeTokenAddress = cfg.isNativeToken ? ethers.ZeroAddress : existing.token;
  const leaderboardAddress = existing.leaderboard;

  // ════════════════════════════════════════════════════════════════
  // DEPLOY ONLY 3 CONTRACTS
  // ════════════════════════════════════════════════════════════════

  console.log("\n📦 Deploying Platform...");
  const Platform = await ethers.getContractFactory("Platform");
  const platform = await Platform.deploy(
    deployer.address,
    arcadeTokenAddress,
    leaderboardAddress,
    cfg.isNativeToken,
    cfg.rewardPool || ethers.ZeroAddress,
    cfg.rewardTokenSymbol,
    cfg.minRewardRate,
    cfg.maxRewardRate,
  );
  await platform.waitForDeployment();
  const platformAddress = await platform.getAddress();
  console.log("✅ Platform:", platformAddress);

  console.log("\n📦 Deploying Tournament...");
  const Tournament = await ethers.getContractFactory("Tournament");
  const tournament = await Tournament.deploy(
    deployer.address,
    arcadeTokenAddress,
    cfg.isNativeToken,
    cfg.rewardTokenSymbol,
  );
  await tournament.waitForDeployment();
  const tournamentAddress = await tournament.getAddress();
  console.log("✅ Tournament:", tournamentAddress);

  console.log("\n📦 Deploying ArcadeMarketplace...");
  const ArcadeMarketplace = await ethers.getContractFactory("ArcadeMarketplace");
  const marketplace = await ArcadeMarketplace.deploy(
    deployer.address,
    arcadeTokenAddress,
    cfg.isNativeToken,
    cfg.rewardTokenSymbol,
    cfg.chainDisplayName,
  );
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("✅ ArcadeMarketplace:", marketplaceAddress);

  // ════════════════════════════════════════════════════════════════
  // ROLES SETUP
  // ════════════════════════════════════════════════════════════════
  console.log("\n⚙️  Setting up roles...");

  if (!cfg.isNativeToken) {
    const PLATFORM_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ROLE"));
    const arcadeToken = await ethers.getContractAt("ArcadeToken", arcadeTokenAddress);
    await arcadeToken.grantRole(PLATFORM_ROLE, platformAddress);
    console.log("✅ PLATFORM_ROLE → Platform (ArcadeToken)");
    await arcadeToken.grantRole(PLATFORM_ROLE, tournamentAddress);
    console.log("✅ PLATFORM_ROLE → Tournament (ArcadeToken)");
    await arcadeToken.grantRole(PLATFORM_ROLE, marketplaceAddress);
    console.log("✅ PLATFORM_ROLE → Marketplace (ArcadeToken)");
  } else {
    console.log("ℹ️  Native chain — skipping ArcadeToken role grants");
  }

  // Leaderboard operator — new Platform needs this
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const leaderboard = await ethers.getContractAt("Leaderboard", leaderboardAddress);
  await leaderboard.grantRole(OPERATOR_ROLE, platformAddress);
  console.log("✅ OPERATOR_ROLE → new Platform (Leaderboard)");

  // ════════════════════════════════════════════════════════════════
  // AVATAR STYLES — re-add to new Marketplace
  // ════════════════════════════════════════════════════════════════
  console.log(`\n🎨 Adding ${AVATAR_STYLES.length} avatar styles to new Marketplace...\n`);
  for (const style of AVATAR_STYLES) {
    console.log(`Adding: ${style.name}`);
    try {
      const tx = await marketplace.addItem(
        style.name, style.desc, "",
        SKIN_ITEM_TYPE, style.price, 0, style.supply,
        { gasLimit: 300000 }
      );
      await tx.wait();
      console.log("  ✅ Added!");
    } catch (err) {
      console.error("  ❌ Failed:", err.shortMessage || err.message);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // UPDATE deployedAddresses.json — only 3 fields change
  // ════════════════════════════════════════════════════════════════
  console.log(`\n💾 Updating deployedAddresses.json for "${addressKey}"...`);
  allAddresses[addressKey] = {
    ...existing,                          // keep token, leaderboard, creatorNft, campaignBadge
    platform:    platformAddress,         // ← updated
    tournament:  tournamentAddress,       // ← updated
    marketplace: marketplaceAddress,      // ← updated
    deployedAt:  new Date().toISOString(),
  };
  fs.writeFileSync(DEPLOYED_ADDRESSES_PATH, JSON.stringify(allAddresses, null, 2) + "\n");
  console.log("✅ deployedAddresses.json updated");

  // ════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════
  console.log("\n🎉 UPDATE COMPLETE!");
  console.log("================================");
  console.log("Chain:         ", chainKey);
  console.log("Token mode:    ", cfg.isNativeToken ? `Native (${cfg.rewardTokenSymbol})` : `ERC-20 (${cfg.rewardTokenSymbol})`);
  console.log("\n✅ Updated:");
  console.log("   Platform:    ", platformAddress);
  console.log("   Tournament:  ", tournamentAddress);
  console.log("   Marketplace: ", marketplaceAddress);
  console.log("\n📌 Unchanged:");
  console.log("   ArcadeToken: ", existing.token);
  console.log("   Leaderboard: ", existing.leaderboard);
  console.log("   CreatorNFT:  ", existing.creatorNft);
  console.log("   CampaignBadge:", existing.campaignBadge);
  console.log("================================");
  console.log("\n📝 Games data safe — Firestore mein hai, contract change se affect nahi hoga.");
  console.log("📝 Active tournaments reset honge — new contract pe fresh start.");
  if (cfg.isNativeToken) {
    console.log(`\n⚠️  Fund reward pool with ${cfg.rewardTokenSymbol} before going live:`);
    console.log(`   ${cfg.rewardPool}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
