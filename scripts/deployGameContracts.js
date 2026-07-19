/**
 * deployGameContracts.js
 * Deploys GameItems.sol
 * Run AFTER main deploy.js (needs existing deployedAddresses.json)
 *
 * Usage:
 *   npx hardhat run scripts/deployGameContracts.js --network botchain
 *   npx hardhat run scripts/deployGameContracts.js --network mst
 *   npx hardhat run scripts/deployGameContracts.js --network somnia
 *
 * Reads:  deployedAddresses.json  (for token + platform wallet)
 * Writes: deployedAddresses.json  (adds gameItems key)
 */

const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

const DEPLOYED_ADDRESSES_PATH = path.join(
  __dirname, "..", "src", "config", "deployedAddresses.json"
);

// Which chains use native token (no ERC-20)
const NATIVE_TOKEN_CHAINS = ["mst"];

async function main() {
  const chainKey = hre.network.name;
  console.log(`\n🔗 Deploying GameItems to: ${chainKey}\n`);

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // ── Read existing deployed addresses ──────────────────────
  let allAddresses = {};
  try {
    allAddresses = JSON.parse(fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8"));
  } catch (err) {
    console.error("❌ deployedAddresses.json not found — run deploy.js first");
    process.exit(1);
  }

  const chainAddresses = allAddresses[chainKey];
  if (!chainAddresses) {
    console.error(`❌ No entry for "${chainKey}" in deployedAddresses.json — run deploy.js first`);
    process.exit(1);
  }

  const arcadeTokenAddress = chainAddresses.token;
  const platformWallet     = deployer.address;
  const isNativeToken      = NATIVE_TOKEN_CHAINS.includes(chainKey);

  console.log("ArcadeToken:    ", arcadeTokenAddress || "N/A (native chain)");
  console.log("Platform wallet:", platformWallet);
  console.log("Native token:   ", isNativeToken);

  // ── Deploy GameItems ────────────────────────────────────
  console.log("\n📦 Deploying GameItems (ERC-1155)...");
  const GameItems = await hre.ethers.getContractFactory("GameItems");
  const gameItems = await GameItems.deploy(
    platformWallet,                                              // platform wallet (20%)
    isNativeToken ? hre.ethers.ZeroAddress : arcadeTokenAddress, // token address
    isNativeToken                                                // isNativeToken flag
  );
  await gameItems.waitForDeployment();
  const gameItemsAddress = await gameItems.getAddress();
  console.log("✅ GameItems:", gameItemsAddress);

  // ── Save to deployedAddresses.json ─────────────────────
  console.log(`\n💾 Writing address to deployedAddresses.json under "${chainKey}"...`);
  try {
    allAddresses[chainKey] = {
      ...chainAddresses,
      gameItems: gameItemsAddress,
    };
    fs.writeFileSync(
      DEPLOYED_ADDRESSES_PATH,
      JSON.stringify(allAddresses, null, 2) + "\n"
    );
    console.log(`✅ deployedAddresses.json updated for "${chainKey}"`);
  } catch (err) {
    console.error(`❌ Failed to write deployedAddresses.json: ${err.message}`);
    console.log("Copy this address manually:");
    console.log(`  gameItems: "${gameItemsAddress}"`);
  }

  // ── Done ────────────────────────────────────────────────
  console.log("\n🎉 DEPLOYMENT COMPLETE!");
  console.log("================================");
  console.log("Chain:      ", chainKey);
  console.log("GameItems:  ", gameItemsAddress);
  console.log("================================");
  console.log("\n📝 Next steps:");
  console.log("   1. Add gameItems to chains.js contracts");
  console.log("   2. Update GamePlay.jsx with new contract address");
  console.log("   3. purchaseSkinAndMint() / purchasePowerUp() need no pre-registration");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});