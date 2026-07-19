/**
 * scripts/grantOperatorRole.js
 * Grants OPERATOR_ROLE on the existing Leaderboard contract to whichever
 * Platform address is currently recorded in deployedAddresses.json.
 *
 * Needed whenever Platform.sol is redeployed standalone (e.g. via
 * deployPlatform.js) — the full deploy.js does this automatically as part
 * of "ROLES SETUP", but a standalone Platform redeploy reuses the existing
 * Leaderboard, which still only trusts the OLD Platform address.
 *
 * Usage:
 *   npx hardhat run scripts/grantOperatorRole.js --network mst
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const DEPLOYED_ADDRESSES_PATH = path.join(
  __dirname, "..", "src", "config", "deployedAddresses.json"
);

const LEADERBOARD_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
];

async function main() {
  const chainKey = hre.network.name;
  console.log(`\n🔗 Granting OPERATOR_ROLE on: ${chainKey}\n`);

  let allAddresses;
  try {
    allAddresses = JSON.parse(fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8"));
  } catch (err) {
    console.error("❌ deployedAddresses.json not found or unreadable:", err.message);
    process.exit(1);
  }

  const chainAddresses = allAddresses[chainKey];
  if (!chainAddresses?.leaderboard) {
    console.error(`❌ No "leaderboard" address for "${chainKey}" in deployedAddresses.json`);
    process.exit(1);
  }
  if (!chainAddresses?.platform) {
    console.error(`❌ No "platform" address for "${chainKey}" in deployedAddresses.json`);
    process.exit(1);
  }

  const leaderboardAddress = chainAddresses.leaderboard;
  const platformAddress = chainAddresses.platform;
  console.log("Leaderboard:", leaderboardAddress);
  console.log("Platform:   ", platformAddress);

  const [admin] = await ethers.getSigners();
  console.log("\n👤 Admin wallet:", admin.address);

  const leaderboard = new ethers.Contract(leaderboardAddress, LEADERBOARD_ABI, admin);
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));

  const alreadyGranted = await leaderboard.hasRole(OPERATOR_ROLE, platformAddress);
  if (alreadyGranted) {
    console.log("\n✅ Platform already has OPERATOR_ROLE on this Leaderboard — nothing to do.");
    return;
  }

  console.log("\n⚙️  Granting OPERATOR_ROLE to Platform...");
  const tx = await leaderboard.grantRole(OPERATOR_ROLE, platformAddress, { gasLimit: 200000 });
  console.log("⏳ TX:", tx.hash);
  await tx.wait();

  const confirmed = await leaderboard.hasRole(OPERATOR_ROLE, platformAddress);
  console.log(confirmed ? "✅ OPERATOR_ROLE granted and confirmed!" : "⚠️  Transaction succeeded but hasRole() still returns false — double-check manually.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
