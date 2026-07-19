// scripts/checkGame.js
// Quick read-only check: what rewardRate is actually stored on-chain for a
// given gameId? Doesn't need the contract to be verified on the explorer —
// talks directly to the RPC using the known ABI.
//
// Usage:
//   npx hardhat run scripts/checkGame.js --network mst
//
// Change GAME_ID below to check a different game.

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const GAME_ID = 11; // change this to check other games

const DEPLOYED_ADDRESSES_PATH = path.join(__dirname, "..", "src", "config", "deployedAddresses.json");

const PLATFORM_ABI = [
  "function games(uint256) external view returns (uint256 gameId, string name, address creator, string iframeUrl, uint256 rewardRate, uint256 totalPlays, bool isActive)",
  "function minRewardRate() external view returns (uint256)",
  "function maxRewardRate() external view returns (uint256)",
];

async function main() {
  const chainKey = hre.network.name;
  const allAddresses = JSON.parse(fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8"));
  const platformAddress = allAddresses[chainKey]?.platform;

  if (!platformAddress) {
    console.error(`❌ No platform address found for "${chainKey}"`);
    return;
  }

  console.log(`\n🔗 Checking gameId ${GAME_ID} on: ${chainKey}`);
  console.log("Platform:", platformAddress);

  const [signer] = await ethers.getSigners();
  const platform = new ethers.Contract(platformAddress, PLATFORM_ABI, signer);

  const game = await platform.games(GAME_ID);
  const min = await platform.minRewardRate();
  const max = await platform.maxRewardRate();

  console.log("\n📋 Game data on-chain:");
  console.log("  gameId:     ", game.gameId.toString());
  console.log("  name:       ", game.name);
  console.log("  creator:    ", game.creator);
  console.log("  rewardRate: ", game.rewardRate.toString(), "  ⚠️  this is what actually gets paid out");
  console.log("  totalPlays: ", game.totalPlays.toString());
  console.log("  isActive:   ", game.isActive);
  console.log("\n📊 Contract's configured limits:", min.toString(), "–", max.toString());

  if (game.rewardRate > max) {
    console.log(`\n🚨 MISMATCH: rewardRate (${game.rewardRate}) is ABOVE the contract's own maxRewardRate (${max})!`);
    console.log("   This game was registered with a rate outside the intended range —");
    console.log("   likely via adminRegisterAndApprove(), which doesn't validate rewardRate.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
