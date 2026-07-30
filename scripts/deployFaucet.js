/**
 * scripts/deployFaucet.js  (v2)
 *
 * Deploys MSTFaucet v2 to MST Blockchain.
 * - Amount is set ON-CHAIN at deploy time (immutable)
 * - deployedAddresses.json updated automatically
 *
 * Usage:
 *   npx hardhat run scripts/deployFaucet.js --network mst
 *
 * Amount kaise change kare:
 *   FAUCET_AMOUNT_MSTC below badlo (e.g. "0.1" ya "0.5")
 *   Phir redeploy karo — amount immutable hai toh change ke liye
 *   naya contract deploy karna hoga.
 *
 * Deploy ke baad:
 *   1. Platform.withdraw() se contract mein MSTC fund karo
 *   2. .env + Vercel pe MST_FAUCET_ADDRESS update karo
 *   3. deployedAddresses.json push karo
 */

// ── CONFIGURE HERE ────────────────────────────────────────────────────────────
const FAUCET_AMOUNT_MSTC = "0.1";  // ← Amount per claim (in MSTC)
// ─────────────────────────────────────────────────────────────────────────────

const hre = require("hardhat");
const { ethers } = hre;
const fs   = require("fs");
const path = require("path");

const DEPLOYED_ADDRESSES_PATH = path.join(
  __dirname, "..", "src", "config", "deployedAddresses.json"
);

async function waitForReceipt(txHash, label = "tx", maxTries = 60, intervalMs = 5000) {
  try {
    const receipt = await hre.ethers.provider.waitForTransaction(txHash, 1, 45_000);
    if (receipt) return receipt;
  } catch (_) {}

  for (let i = 0; i < maxTries; i++) {
    try {
      const receipt = await hre.ethers.provider.getTransactionReceipt(txHash);
      if (receipt && receipt.blockNumber) return receipt;
    } catch (_) {}
    if ((i + 1) % 6 === 0) {
      console.log(`   … waiting for ${label} receipt (${(i + 1) * intervalMs / 1000}s)`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

async function main() {
  const network = hre.network.name;
  console.log("\n============================================================");
  console.log(`🚀 Deploying MSTFaucet v2 — network: ${network}`);
  console.log(`💰 Faucet Amount: ${FAUCET_AMOUNT_MSTC} MSTC per claim (IMMUTABLE)`);
  console.log("============================================================\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer (owner):", deployer.address);

  const amountWei = ethers.parseEther(FAUCET_AMOUNT_MSTC);
  console.log("Amount in wei:   ", amountWei.toString());

  // ── Deploy ────────────────────────────────────────────────────────────────
  console.log("\n📦 Deploying MSTFaucet...");
  const Factory = await ethers.getContractFactory("MSTFaucet");
  const faucet  = await Factory.deploy(deployer.address, amountWei, { gasLimit: 600_000 });
  const deployTx = faucet.deploymentTransaction();
  console.log("   ⏳ Deploy TX:", deployTx?.hash);

  const receipt     = await waitForReceipt(deployTx?.hash || "", "MSTFaucet deploy");
  const faucetAddress = await faucet.getAddress();

  if (!receipt) {
    const code = await hre.ethers.provider.getCode(faucetAddress);
    if (code === "0x") {
      console.error("   ❌ Deployment failed. Check explorer:");
      console.error(`   https://mstscan.com/tx/${deployTx?.hash}`);
      process.exit(1);
    }
    console.log("   ✅ Contract live (confirmed via getCode)");
  } else {
    console.log(`   ✅ Deployed at block ${receipt.blockNumber}`);
  }

  // Verify on-chain amount
  const onChainAmount = await faucet.FAUCET_AMOUNT();
  console.log(`   ✅ On-chain FAUCET_AMOUNT: ${ethers.formatEther(onChainAmount)} MSTC`);

  console.log("\n🔑 MSTFaucet Address:", faucetAddress);
  console.log(`   Explorer: https://mstscan.com/address/${faucetAddress}`);

  // ── Update deployedAddresses.json ─────────────────────────────────────────
  let allAddresses = {};
  try {
    allAddresses = JSON.parse(fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8"));
  } catch (_) {}

  if (!allAddresses[network]) allAddresses[network] = {};
  allAddresses[network].faucet = faucetAddress;
  allAddresses[network].faucetAmount = FAUCET_AMOUNT_MSTC;

  fs.writeFileSync(DEPLOYED_ADDRESSES_PATH, JSON.stringify(allAddresses, null, 2));
  console.log(`\n💾 deployedAddresses.json updated`);
  console.log(`   mst.faucet       = ${faucetAddress}`);
  console.log(`   mst.faucetAmount = ${FAUCET_AMOUNT_MSTC} MSTC`);

  // ── Fund the faucet from Platform reward pool ──────────────────────────────
  console.log("\n💸 Funding faucet from Platform reward pool...");
  const PLATFORM_ADDRESS = allAddresses[network]?.platform;

  if (!PLATFORM_ADDRESS) {
    console.warn("   ⚠️  Platform address not found in deployedAddresses.json — fund manually");
  } else {
    const PLATFORM_ABI = ["function withdraw(address payable to, uint256 amount) external"];
    const platform = new ethers.Contract(PLATFORM_ADDRESS, PLATFORM_ABI, deployer);

    // Fund with 10 MSTC initially — enough for 100 claims at 0.1 MSTC each
    const fundAmount = ethers.parseEther("10");
    const platformBal = await hre.ethers.provider.getBalance(PLATFORM_ADDRESS);
    console.log(`   Platform balance: ${ethers.formatEther(platformBal)} MSTC`);

    if (platformBal < fundAmount) {
      console.warn(`   ⚠️  Platform has less than 10 MSTC — skipping auto-fund`);
      console.warn(`   Fund manually: send MSTC to ${faucetAddress}`);
    } else {
      const fundTx = await platform.withdraw(faucetAddress, fundAmount, { gasLimit: 100_000 });
      console.log("   ⏳ Fund TX:", fundTx.hash);
      await waitForReceipt(fundTx.hash, "fund faucet");
      const newBal = await hre.ethers.provider.getBalance(faucetAddress);
      console.log(`   ✅ Faucet funded! Balance: ${ethers.formatEther(newBal)} MSTC`);
      console.log(`   📊 Remaining claims: ${Number(newBal / onChainAmount)}`);
    }
  }

  // ── Next steps ────────────────────────────────────────────────────────────
  console.log("\n============================================================");
  console.log("🎉 DONE!");
  console.log("============================================================");
  console.log("\n📝 Next steps:\n");
  console.log("1. Add to .env (local):");
  console.log(`   MST_FAUCET_ADDRESS=${faucetAddress}`);
  console.log(`   MST_RPC_URL=https://mariorpc.mstblockchain.com`);
  console.log(`   MST_PLATFORM_ADDRESS=${PLATFORM_ADDRESS || "0xB784bECdD891b629979B342F27F3CF95B0C096BC"}`);
  console.log("\n2. Add same vars to Vercel Dashboard → Settings → Environment Variables");
  console.log("\n3. Push deployedAddresses.json:");
  console.log("   git add src/config/deployedAddresses.json");
  console.log(`   git commit -m "MST Faucet v2: ${FAUCET_AMOUNT_MSTC} MSTC per claim"`);
  console.log("   git push");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
