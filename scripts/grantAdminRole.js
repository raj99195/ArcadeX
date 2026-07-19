/**
 * scripts/grantAdminRole.js
 * Grants ADMIN_ROLE on both Platform and Tournament (whichever addresses are
 * currently recorded in deployedAddresses.json for --network) to a given
 * wallet — e.g. the MST team's own admin wallet, so they can use
 * AdminMST.jsx with their own key instead of a shared one.
 *
 * Usage:
 *   npx hardhat run scripts/grantAdminRole.js --network mst
 *
 * NOTE: the address is hardcoded below (NEW_ADMIN_ADDRESS) rather than read
 * from an env var — env vars set via `set X=Y &&` in this project's shell
 * have been unreliable (some get silently dropped, likely dotenvx-related).
 * Just edit the constant below for a different address.
 */

const NEW_ADMIN_ADDRESS = "0x120462Bbe7f0111c972fEE1FFa8eb88421b6169c";

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const DEPLOYED_ADDRESSES_PATH = path.join(__dirname, "..", "src", "config", "deployedAddresses.json");

const CONTRACT_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function ADMIN_ROLE() external view returns (bytes32)",
];

// ── Robust receipt waiter ────────────────────────────────────────────────────
// ethers v6 `tx.wait()` has an aggressive internal timeout and MST's RPC is
// slow/flaky at returning receipts (even though the tx itself lands fine).
// This falls back to manual polling via `getTransactionReceipt` so we don't
// bail just because the built-in wait gave up.
//
// Total budget: ~5 minutes. Polls every 5s.
async function waitForReceipt(txHash, label) {
  const MAX_TRIES = 60;      // 60 * 5s = 300s = 5 min
  const INTERVAL_MS = 5_000;

  // First try the native wait with a short timeout — usually fast path works.
  // If it throws (timeout), fall through to manual polling instead of failing.
  try {
    const receipt = await hre.ethers.provider.waitForTransaction(txHash, 1, 45_000);
    if (receipt) return receipt;
  } catch (_) {
    // ignore, fall through to polling
  }

  for (let i = 0; i < MAX_TRIES; i++) {
    try {
      const receipt = await hre.ethers.provider.getTransactionReceipt(txHash);
      if (receipt && receipt.blockNumber) return receipt;
    } catch (_) {
      // RPC hiccup — just try again next tick
    }
    if (i === 0 || (i + 1) % 6 === 0) {
      console.log(`   … still polling for ${label} receipt (${(i + 1) * INTERVAL_MS / 1000}s elapsed)`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  return null; // exhausted budget
}

async function grantOn(contractName, address, newAdmin, signer) {
  if (!address) {
    console.log(`⏭️  Skipping ${contractName} — no address configured for this chain.`);
    return;
  }
  const contract = new ethers.Contract(address, CONTRACT_ABI, signer);
  const ADMIN_ROLE = await contract.ADMIN_ROLE();

  const already = await contract.hasRole(ADMIN_ROLE, newAdmin);
  if (already) {
    console.log(`✅ ${contractName} (${address}) — ${newAdmin} already has ADMIN_ROLE, nothing to do.`);
    return;
  }

  console.log(`⚙️  Granting ADMIN_ROLE on ${contractName} (${address}) to ${newAdmin}...`);
  const tx = await contract.grantRole(ADMIN_ROLE, newAdmin, { gasLimit: 200000 });
  console.log("   ⏳ TX:", tx.hash);

  const receipt = await waitForReceipt(tx.hash, contractName);

  if (!receipt) {
    // Polling budget exhausted. Do one last on-chain state check — the tx
    // may well have landed and receipt fetch just kept failing.
    console.warn(`   ⚠️  Receipt not returned after 5 min. Checking hasRole() directly...`);
    const landed = await contract.hasRole(ADMIN_ROLE, newAdmin);
    if (landed) {
      console.log(`   ✅ hasRole() confirms ADMIN_ROLE granted on ${contractName} despite receipt timeout.`);
    } else {
      console.warn(`   ⚠️  hasRole() still false. TX may be pending or dropped: https://mstscan.com/tx/${tx.hash}`);
      console.warn(`   Re-run this script later — it skips wallets that already have the role.`);
    }
    return;
  }

  if (receipt.status !== 1) {
    console.error(`   ❌ TX reverted on-chain: https://mstscan.com/tx/${tx.hash}`);
    return;
  }

  const confirmed = await contract.hasRole(ADMIN_ROLE, newAdmin);
  console.log(
    confirmed
      ? `   ✅ Confirmed — ADMIN_ROLE granted on ${contractName} (block ${receipt.blockNumber}).`
      : `   ⚠️  Transaction succeeded but hasRole() still returns false — double-check manually.`
  );
}

async function main() {
  const chainKey = hre.network.name;
  const newAdmin = NEW_ADMIN_ADDRESS;

  if (!newAdmin || !ethers.isAddress(newAdmin)) {
    console.error("❌ NEW_ADMIN_ADDRESS is missing or not a valid address (edit the constant at top of file).");
    process.exit(1);
  }

  console.log(`\n🔗 Granting ADMIN_ROLE on: ${chainKey}`);
  console.log("New admin wallet:", newAdmin, "\n");

  let allAddresses;
  try {
    allAddresses = JSON.parse(fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8"));
  } catch (err) {
    console.error("❌ deployedAddresses.json not found or unreadable:", err.message);
    process.exit(1);
  }

  const chainAddresses = allAddresses[chainKey];
  if (!chainAddresses) {
    console.error(`❌ No entry for "${chainKey}" in deployedAddresses.json`);
    process.exit(1);
  }

  const [signer] = await ethers.getSigners();
  console.log("Signing with (must already have ADMIN_ROLE / DEFAULT_ADMIN_ROLE):", signer.address, "\n");

  await grantOn("Platform", chainAddresses.platform, newAdmin, signer);
  await grantOn("Tournament", chainAddresses.tournament, newAdmin, signer);

  console.log(`\n🎉 Done. ${newAdmin} can now use AdminMST.jsx with their own wallet.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});