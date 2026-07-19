/**
 * scripts/deployPlatform.js
 * Deploys (or redeploys) Platform.sol on a given chain, with reward-rate
 * limits driven entirely by env vars — no contract code changes needed.
 *
 * Usage:
 *   MIN_REWARD_RATE=1 MAX_REWARD_RATE=2 npx hardhat run scripts/deployPlatform.js --network mst
 *   MIN_REWARD_RATE=5 MAX_REWARD_RATE=500 npx hardhat run scripts/deployPlatform.js --network botchain
 *
 * If MIN_REWARD_RATE / MAX_REWARD_RATE are not set, safe defaults kick in
 * based on whether the chain uses a native token or an ERC-20:
 *   native chain (MST)        → min 1,  max 2
 *   ERC-20 chain (BOTChain/Somnia) → min 5,  max 500
 *
 * Reads:  deployedAddresses.json  (for token/leaderboard/rewardPool on this chain)
 * Writes: deployedAddresses.json  (overwrites platform address for this chain)
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEPLOYED_ADDRESSES_PATH = path.join(
  __dirname, "..", "src", "config", "deployedAddresses.json"
);

// Which chains use native token (no ERC-20) — keep in sync with
// deployGameContracts.js's NATIVE_TOKEN_CHAINS list.
const NATIVE_TOKEN_CHAINS = ["mst"];
const REWARD_SYMBOLS = { mst: "MSTC", botchain: "ARCADE", somnia: "ARCADE" };

async function main() {
  const chainKey = hre.network.name;
  const isNativeToken = NATIVE_TOKEN_CHAINS.includes(chainKey);

  // Env vars win; otherwise fall back to a chain-type-aware safe default —
  // deploying a native-token chain without explicitly setting these still
  // lands on a tight 1–2 range instead of accidentally inheriting a
  // permissive ERC-20-style default.
  const minRewardRate = parseInt(
    process.env.MIN_REWARD_RATE ?? (isNativeToken ? "1" : "5")
  );
  const maxRewardRate = parseInt(
    process.env.MAX_REWARD_RATE ?? (isNativeToken ? "2" : "500")
  );

  console.log(`\n🔗 Deploying Platform.sol to: ${chainKey}`);
  console.log(`   isNativeToken: ${isNativeToken}`);
  console.log(`   Reward rate limits: ${minRewardRate}–${maxRewardRate}\n`);

  if (minRewardRate > maxRewardRate) {
    console.error(`❌ MIN_REWARD_RATE (${minRewardRate}) > MAX_REWARD_RATE (${maxRewardRate}) — aborting.`);
    process.exit(1);
  }
  if (isNativeToken && maxRewardRate > 10) {
    console.warn(`⚠️  WARNING: ${chainKey} is a native-token chain but maxRewardRate is ${maxRewardRate} — this pays out REAL native tokens per play. Double-check this is intentional before continuing.\n`);
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // ── Read existing deployed addresses for this chain ──────
  let allAddresses = {};
  try {
    allAddresses = JSON.parse(fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8"));
  } catch (err) {
    console.error("❌ deployedAddresses.json not found or unreadable:", err.message);
    process.exit(1);
  }

  const chainAddresses = allAddresses[chainKey];
  if (!chainAddresses) {
    console.error(`❌ No entry for "${chainKey}" in deployedAddresses.json — deploy ArcadeToken/Leaderboard first.`);
    process.exit(1);
  }
  if (!chainAddresses.leaderboard) {
    console.error(`❌ No "leaderboard" address for "${chainKey}" — deploy Leaderboard.sol first.`);
    process.exit(1);
  }
  if (!isNativeToken && !chainAddresses.token) {
    console.error(`❌ No "token" (ArcadeToken) address for "${chainKey}" — deploy ArcadeToken.sol first.`);
    process.exit(1);
  }

  const rewardPool = isNativeToken
    ? (chainAddresses.rewardPool || deployer.address)
    : hre.ethers.ZeroAddress;
  if (isNativeToken && !chainAddresses.rewardPool) {
    console.warn(`⚠️  No "rewardPool" set for ${chainKey} in deployedAddresses.json — defaulting to deployer address (${deployer.address}). Fund this wallet with native tokens before games go live, or set rewardPool explicitly and redeploy.`);
  }

  const rewardTokenSymbol = process.env.REWARD_TOKEN_SYMBOL || REWARD_SYMBOLS[chainKey] || "ARCADE";

  console.log("ArcadeToken:  ", isNativeToken ? "N/A (native chain)" : chainAddresses.token);
  console.log("Leaderboard:  ", chainAddresses.leaderboard);
  console.log("Reward pool:  ", isNativeToken ? rewardPool : "N/A (ERC-20 chain)");
  console.log("Reward symbol:", rewardTokenSymbol);

  // ── Deploy Platform ────────────────────────────────────
  console.log("\n📦 Deploying Platform...");
  const Platform = await hre.ethers.getContractFactory("Platform");
  const platform = await Platform.deploy(
    deployer.address,                                              // admin
    isNativeToken ? hre.ethers.ZeroAddress : chainAddresses.token,  // _arcadeToken
    chainAddresses.leaderboard,                                    // _leaderboard
    isNativeToken,                                                 // _isNativeToken
    rewardPool,                                                    // _rewardPool
    rewardTokenSymbol,                                             // _rewardTokenSymbol
    minRewardRate,                                                 // _minRewardRate
    maxRewardRate                                                  // _maxRewardRate
  );
  await platform.waitForDeployment();
  const platformAddress = await platform.getAddress();
  console.log("✅ Platform:", platformAddress);

  // ── Save to deployedAddresses.json ─────────────────────
  console.log(`\n💾 Writing address to deployedAddresses.json under "${chainKey}"...`);
  try {
    allAddresses[chainKey] = {
      ...chainAddresses,
      platform: platformAddress,
    };
    fs.writeFileSync(
      DEPLOYED_ADDRESSES_PATH,
      JSON.stringify(allAddresses, null, 2) + "\n"
    );
    console.log(`✅ deployedAddresses.json updated for "${chainKey}"`);
  } catch (err) {
    console.error(`❌ Failed to write deployedAddresses.json: ${err.message}`);
    console.log("Copy this address manually:");
    console.log(`  platform: "${platformAddress}"`);
  }

  console.log("\n🎉 DEPLOYMENT COMPLETE!");
  console.log("================================");
  console.log("Chain:      ", chainKey);
  console.log("Platform:   ", platformAddress);
  console.log("Rate limits:", `${minRewardRate}–${maxRewardRate}`);
  console.log("================================");
  console.log("\n📝 Next steps:");
  console.log(`   1. Update VITE_PLATFORM_ADDRESS in .env to ${platformAddress}`);
  console.log("   2. Update platform address in chains.js contracts config");
  if (isNativeToken) {
    console.log(`   3. Fund the reward pool (${rewardPool}) with native tokens if not already funded`);
  }
  console.log("   4. Migrate already-approved games:");
  console.log(`      FORCE_REWARD_RATE=<rate> node scripts/migrateGames.js --network ${chainKey}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
