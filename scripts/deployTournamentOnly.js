// scripts/deployTournamentOnly.js
require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const ADMIN  = process.env.VITE_ADMIN_ADDRESS;
  const ARCADE = process.env.VITE_ARCADE_TOKEN_ADDRESS;

  console.log("Admin:", ADMIN);
  console.log("ArcadeToken:", ARCADE);

  // constructor(address admin, address _arcadeToken)
  const Tournament = await ethers.deployContract("Tournament", [ADMIN, ARCADE]);
  await Tournament.waitForDeployment();

  const addr = await Tournament.getAddress();
  console.log("✅ Tournament deployed:", addr);
  console.log("\n.env mein update karo:");
  console.log(`VITE_TOURNAMENT_ADDRESS=${addr}`);

  // Verify
  const arcadeInContract = await Tournament.arcadeToken();
  console.log("\n✅ ArcadeToken in contract:", arcadeInContract);
  console.log(arcadeInContract.toLowerCase() === ARCADE.toLowerCase() ? "✅ Match!" : "❌ MISMATCH!");
}

main().catch(err => { console.error(err); process.exit(1); });