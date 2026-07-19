// scripts/deployNFTOnly.js
// Run: npx hardhat run scripts/deployNFTOnly.js --network <chainKey>
//
// Deploys ONLY CreatorNFT.sol — use this when you've updated CreatorNFT.sol
// (e.g. added adminMintFor()) and want to redeploy just that contract
// without touching Platform/Tournament/Marketplace/ArcadeToken or any
// existing game/tournament data on those contracts.
//
// Automatically updates the `creatorNft` field for this chain in
// deployedAddresses.json — leaves every other field (token, platform,
// tournament, marketplace, leaderboard, campaignBadge) untouched.

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const DEPLOYED_ADDRESSES_PATH = path.join(__dirname, "..", "src", "config", "deployedAddresses.json");

async function main() {
  const chainKey = hre.network.name;
  console.log(`\n🔗 Deploying CreatorNFT to chain: ${chainKey}\n`);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const ADMIN = process.env.VITE_ADMIN_ADDRESS;
  if (!ADMIN) {
    console.error("❌ VITE_ADMIN_ADDRESS not set in .env — aborting.");
    process.exit(1);
  }
  console.log("Admin (MINTER_ROLE):", ADMIN);

  const CreatorNFT = await ethers.deployContract("CreatorNFT", [ADMIN]);
  await CreatorNFT.waitForDeployment();
  const creatorNftAddress = await CreatorNFT.getAddress();
  console.log("✅ CreatorNFT:", creatorNftAddress);

  // ── Auto-update only the creatorNft field for this chain ────────────────
  console.log(`\n💾 Updating creatorNft field for "${chainKey}" in deployedAddresses.json...`);
  try {
    const raw = fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8");
    const allAddresses = JSON.parse(raw);

    if (!(chainKey in allAddresses)) {
      console.warn(`⚠️  "${chainKey}" doesn't exist yet in deployedAddresses.json — creating a minimal entry with just creatorNft set.`);
      allAddresses[chainKey] = {};
    }

    allAddresses[chainKey].creatorNft = creatorNftAddress;
    fs.writeFileSync(DEPLOYED_ADDRESSES_PATH, JSON.stringify(allAddresses, null, 2) + "\n");
    console.log(`✅ deployedAddresses.json updated — only "${chainKey}.creatorNft" changed, everything else untouched.`);
  } catch (err) {
    console.error(`❌ Failed to auto-write deployedAddresses.json: ${err.message}`);
    console.error("   You'll need to update it manually.");
  }

  console.log("\n🎉 DONE!");
  console.log("================================");
  console.log("Chain:      ", chainKey);
  console.log("CreatorNFT: ", creatorNftAddress);
  console.log("================================");
  console.log("\n📝 If anything still reads VITE_CREATOR_NFT_ADDRESS directly from");
  console.log("   .env instead of useChain(), update that too:");
  console.log(`   VITE_CREATOR_NFT_ADDRESS=${creatorNftAddress}`);
  console.log("\n⚠️  Note: this is a fresh contract — any creators who minted on the");
  console.log("   PREVIOUS CreatorNFT deployment on this chain will need to be");
  console.log("   re-synced (e.g. via adminMintFor) since usernameTaken/walletToToken");
  console.log("   start empty on the new contract.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});