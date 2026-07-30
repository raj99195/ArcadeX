/**
 * test-paymaster.js
 * Standalone test for BOT Chain's EOA Paymaster (gasless transactions) —
 * run this BEFORE touching GamePlay.jsx, to confirm the mechanism actually
 * works end-to-end with a real wallet that has ZERO BOT balance.
 *
 * Two phases:
 *   Phase 1 — pm_isSponsorable check (read-only, no funds needed, no tx sent)
 *   Phase 2 — only runs if Phase 1 says sponsorable=true: builds a real
 *             zero-gas-price recordPlayAndEarn() call, signs it, and submits
 *             it via the paymaster's eth_sendRawTransaction.
 *
 * Usage:
 *   node test-paymaster.js
 *
 * Requires (edit the CONFIG block below):
 *   - TEST_PRIVATE_KEY: a wallet with ZERO BOT balance — this is the whole
 *     point of the test. If a zero-balance wallet successfully submits,
 *     that's definitive proof the paymaster is sponsoring it.
 *   - GAME_ID / SCORE: a real, currently-active gameId + a score that will
 *     pass minRewardRate/minScore checks on BOTChain's Platform, so the
 *     transaction actually succeeds end-to-end (not just gets sponsored
 *     then reverts for unrelated reasons).
 */

const { ethers } = require("ethers");

// ── CONFIG — edit these ────────────────────────────────────────────────────
const PAYMASTER_ENDPOINTS = {
  // Both provided — script tries each and reports which one actually
  // responds to pm_isSponsorable. The "ERC4337 bundler" URLs may or may not
  // be the same infra as the EOA Paymaster described in BOT Chain's docs —
  // this test will tell us empirically.
  testnet: "https://bundler.bohr.life/rpc",
  mainnet: "https://bundler.botchain.ai/rpc",
};
const ACTIVE_ENDPOINT = PAYMASTER_ENDPOINTS.mainnet; // switch to .testnet if needed

const NORMAL_RPC_URL = "https://rpc.botchain.ai"; // for reading contract state, NOT for sending the sponsored tx
const PLATFORM_ADDRESS = "0xB784bECdD891b629979B342F27F3CF95B0C096BC";

const TEST_PRIVATE_KEY = process.env.TEST_PRIVATE_KEY || ""; // MUST be a wallet with 0 BOT balance
const GAME_ID = 11;  // Dancing Ball
const SCORE = 200;

const PLATFORM_ABI = [
  "function recordPlayAndEarn(uint256 gameId, uint256 score, uint256 nonce, bytes signature) external",
];

// ── JSON-RPC helper ──────────────────────────────────────────────────────
async function rpcCall(endpoint, method, params) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
  return data.result;
}

async function main() {
  if (!TEST_PRIVATE_KEY) {
    console.error("❌ Set TEST_PRIVATE_KEY env var — must be a wallet with ZERO BOT balance.");
    console.error('   Usage: set TEST_PRIVATE_KEY=0x... (no trailing space before &&)');
    process.exit(1);
  }

  // ── PHASE 0: confirm whether this endpoint is an ERC-4337 bundler ──────
  // eth_supportedEntryPoints is a standard ERC-4337 bundler method — if this
  // responds (even with an empty array), it confirms the endpoint is a
  // bundler, NOT the EOA Paymaster described in BOT Chain's docs (which
  // needs pm_isSponsorable/eth_sendRawTransaction instead).
  console.log(`\n🔎 Phase 0 — checking if ${ACTIVE_ENDPOINT} is an ERC-4337 bundler...`);
  try {
    const entryPoints = await rpcCall(ACTIVE_ENDPOINT, "eth_supportedEntryPoints", []);
    console.log("✅ eth_supportedEntryPoints responded:", entryPoints);
    console.log("   → CONFIRMED: this is an ERC-4337 bundler (smart-contract-wallet flow),");
    console.log("     NOT the EOA Paymaster. pm_isSponsorable will not work here.");
    console.log("     Ask BOT Chain team for the actual EOA Paymaster RPC endpoint");
    console.log('     (the docs mention "Nodereal MegaFuel" as an example provider —');
    console.log("     it's a separate URL from this bundler).");
    return;
  } catch (err) {
    console.log("⚠️  eth_supportedEntryPoints didn't respond as expected:", err.message);
    console.log("   Inconclusive — proceeding to try pm_isSponsorable anyway.\n");
  }

  const provider = new ethers.JsonRpcProvider(NORMAL_RPC_URL);
  const wallet = new ethers.Wallet(TEST_PRIVATE_KEY, provider);

  console.log("🔗 Test wallet:", wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log("💰 BOT balance:", ethers.formatEther(balance), "BOT");
  if (balance > 0n) {
    console.warn("⚠️  This wallet has a non-zero balance — a successful tx here doesn't PROVE");
    console.warn("   the paymaster sponsored it, since the wallet could have paid its own gas.");
    console.warn("   For a definitive test, use a fresh wallet with exactly 0 BOT.\n");
  }

  // Build the recordPlayAndEarn calldata (matches GamePlay.jsx's fallback
  // pattern: nonce=0, signature=0x, assuming scoreSigner is unset on BOTChain)
  const iface = new ethers.Interface(PLATFORM_ABI);
  const data = iface.encodeFunctionData("recordPlayAndEarn", [GAME_ID, SCORE, 0, "0x"]);

  const txForCheck = {
    to: PLATFORM_ADDRESS,
    from: wallet.address,
    value: "0x0",
    data,
    gas: "0x7A120", // 500000 in hex, matches the gas limit used elsewhere in the app
  };

  // ── PHASE 1: pm_isSponsorable (read-only check) ──────────────────────────
  console.log(`\n📡 Phase 1 — checking pm_isSponsorable on ${ACTIVE_ENDPOINT}...`);
  let sponsorResult;
  try {
    sponsorResult = await rpcCall(ACTIVE_ENDPOINT, "pm_isSponsorable", [txForCheck]);
    console.log("✅ Response:", JSON.stringify(sponsorResult, null, 2));
  } catch (err) {
    console.error("❌ pm_isSponsorable failed:", err.message);
    console.error("   This endpoint may not implement the EOA Paymaster API described in the docs.");
    console.error("   Try the other endpoint (testnet/mainnet), or confirm the correct paymaster URL with BOT Chain.");
    process.exit(1);
  }

  if (!sponsorResult?.Sponsorable) {
    console.log("\n⏹️  Not sponsorable according to this endpoint/policy. Stopping here — nothing sent.");
    console.log("   Ask BOT Chain: what's the correct sponsor policy / endpoint for ArcadeX's contract calls?");
    return;
  }

  console.log(`\n✅ Sponsorable! Policy: "${sponsorResult.SponsorPolicy}"`);

  // ── PHASE 2: build + sign a zero-gas-price tx, submit via paymaster ──────
  console.log("\n📡 Phase 2 — building zero-gas-price transaction...");
  const nonce = await provider.getTransactionCount(wallet.address);
  const network = await provider.getNetwork();

  const tx = {
    to: PLATFORM_ADDRESS,
    data,
    value: 0n,
    gasLimit: 500000n,
    gasPrice: 0n,           // ← the key part: zero gas price for a sponsored tx
    nonce,
    chainId: network.chainId,
    type: 0,                // legacy tx type — paymaster docs example uses type 2 (EIP-1559) actually, adjust if this fails
  };

  console.log("Signing zero-gas-price tx...");
  const signedTx = await wallet.signTransaction(tx);

  console.log(`Submitting via ${ACTIVE_ENDPOINT} (eth_sendRawTransaction)...`);
  try {
    const txHash = await rpcCall(ACTIVE_ENDPOINT, "eth_sendRawTransaction", [signedTx]);
    console.log("✅ Submitted! TX hash:", txHash);
    console.log(`   Check: https://scan.botchain.ai/tx/${txHash}`);
    console.log("\n⏳ Waiting for confirmation (up to 45s)...");
    const receipt = await provider.waitForTransaction(txHash, 1, 45_000).catch(e => {
      console.warn("   Timed out waiting — check the explorer link above manually.");
      return null;
    });
    if (receipt) {
      console.log("Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ REVERTED");
      console.log("Gas used:", receipt.gasUsed.toString());
      if (balance === 0n && receipt.status === 1) {
        console.log("\n🎉 CONFIRMED: a zero-balance wallet successfully submitted a transaction.");
        console.log("   The paymaster is genuinely sponsoring gas — safe to integrate into GamePlay.jsx.");
      }
    }
  } catch (err) {
    console.error("❌ eth_sendRawTransaction failed:", err.message);
    console.error("   If this mentions transaction type or format, the paymaster may expect");
    console.error("   EIP-1559 (type 2) txs instead of legacy (type 0) — try changing `type: 0` to `type: 2`");
    console.error("   with maxFeePerGas: 0n, maxPriorityFeePerGas: 0n instead of gasPrice.");
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});