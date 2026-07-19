/**
 * ClashPotEscrow deploy script
 * Usage: npx hardhat run scripts/deployEscrow.js --network mst
 *
 * Constructor: (address admin, address settler)
 *   admin   = tumhara wallet (ADMIN_ROLE — surplus withdraw, emergency)
 *   settler = backend wallet (SETTLER_ROLE — settle() call karta hai)
 *             .env mein PRIVATE_KEY se derive hoti hai
 *
 * Deploy ke baad .env mein add karo:
 *   ESCROW_CONTRACT=<deployed address>
 */

const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\n🔗 Network:", hre.network.name);
  console.log("Deployer (admin):", deployer.address);

  // Settler = same wallet for now (backend key)
  // Production mein alag wallet use karna better hai
  const admin   = deployer.address;
  const settler = deployer.address;

  console.log("Admin:  ", admin);
  console.log("Settler:", settler);

  console.log("\n📦 Deploying ClashPotEscrow...");
  const Factory = await ethers.getContractFactory("ClashPotEscrow");
  const escrow  = await Factory.deploy(admin, settler);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("✅ ClashPotEscrow deployed:", address);

  // Verify contract state
  const feeBps        = await escrow.feeBps();
  const joinTimeout   = await escrow.joinTimeout();
  const settleTimeout = await escrow.settleTimeout();

  console.log("\n📋 Contract state:");
  console.log("  feeBps:        ", feeBps.toString(), "(0 = no fee)");
  console.log("  joinTimeout:   ", joinTimeout.toString(), "seconds");
  console.log("  settleTimeout: ", settleTimeout.toString(), "seconds");

  console.log("\n📝 .env mein add karo:");
  console.log(`  ESCROW_CONTRACT=${address}`);
  console.log(`  MST_RPC_URL=https://mariorpc.mstblockchain.com`);
  console.log(`  BACKEND_PRIVATE_KEY=<tumhari settler wallet ki private key>`);
}

main().catch((e) => { console.error(e); process.exit(1); });
