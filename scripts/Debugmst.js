/**
 * scripts/debugMst.js
 * Comprehensive diagnostic — figures out WHY grantAdminRole.js times out
 * on MST while the frontend (Creator.jsx / GamePlay.jsx) works fine.
 *
 * Prints:
 *  - RPC URL & chain id script is actually connected to
 *  - Latest block + how fresh it is (chain alive? mining?)
 *  - Deployer wallet balance + nonce (latest vs pending)
 *  - Fee data (base fee / gasPrice / priority)
 *  - Status of the specific txs that hung: mempool / mined / dropped
 *  - Same tx pulled via raw JSON-RPC (bypasses ethers) to catch RPC bugs
 *
 * Usage:
 *   npx hardhat run scripts/debugMst.js --network mst
 */

const hre = require("hardhat");
const { ethers } = hre;

// Hashes from the runs Raj already did — add more here if he tries again
const RECENT_TX_HASHES = [
  "0xc0a2f89381c3a46682dc384a6eaf2ccf9f7bfac0cffd51027078d4d354f87944", // 1st Platform grant
  "0xb2db066094bed49fddf4ed36d323c3a2079bab673a68e7425bd92dac169eec95", // 1st Tournament grant
  "0x0fd6f4d37621510c6a11d185553d4c95c065c84b6a16fdcf34457dff22d37f61", // latest Platform grant
];

function line() { console.log("─".repeat(70)); }

async function rawRpc(url, method, params) {
  // Uses global fetch (node 18+). Bypasses ethers to see what RPC actually
  // returns — catches cases where the RPC gives non-standard JSON that
  // ethers silently drops.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return await res.json();
}

async function main() {
  const provider = ethers.provider;
  const [signer] = await ethers.getSigners();
  const addr = signer.address;
  const rpcUrl = hre.network.config.url;

  line();
  console.log("MST MAINNET DIAGNOSTIC");
  line();

  // ── 1. Network ────────────────────────────────────────────────────────────
  console.log("\n[1] Network");
  const net = await provider.getNetwork();
  console.log(`    hardhat network:  ${hre.network.name}`);
  console.log(`    RPC URL:          ${rpcUrl}`);
  console.log(`    Chain ID:         ${net.chainId}`);

  // ── 2. Chain liveness ─────────────────────────────────────────────────────
  console.log("\n[2] Chain liveness");
  const blockNum = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNum);
  const ageSec = Math.round((Date.now() / 1000) - Number(block.timestamp));
  console.log(`    Latest block:     ${blockNum}`);
  console.log(`    Block timestamp:  ${new Date(Number(block.timestamp) * 1000).toISOString()}`);
  console.log(`    Age:              ${ageSec}s ago  ${ageSec > 60 ? "⚠️  chain looks stalled" : "✅ mining"}`);
  console.log(`    Block gas used:   ${block.gasUsed} / limit ${block.gasLimit}`);
  console.log(`    Base fee:         ${block.baseFeePerGas ? ethers.formatUnits(block.baseFeePerGas, "gwei") + " gwei" : "n/a (legacy chain?)"}`);
  console.log(`    Tx count:         ${block.transactions.length}`);

  // ── 3. Signer ─────────────────────────────────────────────────────────────
  console.log("\n[3] Deployer wallet (this is what hardhat scripts use)");
  console.log(`    Address:          ${addr}`);
  const bal = await provider.getBalance(addr);
  console.log(`    Balance:          ${ethers.formatEther(bal)} MST`);
  if (bal === 0n) console.log(`    ❌ ZERO BALANCE — this alone would cause every tx to fail`);

  const nLatest  = await provider.getTransactionCount(addr, "latest");
  const nPending = await provider.getTransactionCount(addr, "pending");
  console.log(`    Nonce (latest):   ${nLatest}   ← last mined tx nonce + 1`);
  console.log(`    Nonce (pending):  ${nPending}   ← next nonce the RPC will assign`);
  if (nPending > nLatest) {
    console.log(`    ⚠️  ${nPending - nLatest} PENDING TX(s) STUCK IN MEMPOOL`);
    console.log(`       This is almost certainly why grantAdminRole hangs.`);
    console.log(`       Every new tx queues behind the stuck one and never mines.`);
    console.log(`       Fix: bump the stuck nonce (see remediation at end).`);
  } else {
    console.log(`    ✅ No pending stuck txs from this wallet`);
  }

  // ── 4. Fee data ───────────────────────────────────────────────────────────
  console.log("\n[4] Fee data (what the RPC would suggest for a new tx)");
  try {
    const fd = await provider.getFeeData();
    console.log(`    gasPrice:              ${fd.gasPrice ? ethers.formatUnits(fd.gasPrice, "gwei") + " gwei" : "n/a"}`);
    console.log(`    maxFeePerGas:          ${fd.maxFeePerGas ? ethers.formatUnits(fd.maxFeePerGas, "gwei") + " gwei" : "n/a"}`);
    console.log(`    maxPriorityFeePerGas:  ${fd.maxPriorityFeePerGas ? ethers.formatUnits(fd.maxPriorityFeePerGas, "gwei") + " gwei" : "n/a"}`);
  } catch (e) {
    console.log(`    ❌ getFeeData failed: ${e.message}`);
  }

  // ── 5. Recent tx status via ethers ────────────────────────────────────────
  console.log("\n[5] Recent tx status (via ethers)");
  for (const h of RECENT_TX_HASHES) {
    console.log(`\n    ${h}`);
    try {
      const tx = await provider.getTransaction(h);
      if (!tx) {
        console.log(`      ❌ Not found on RPC — either dropped from mempool OR RPC has amnesia`);
      } else {
        console.log(`      from:      ${tx.from}`);
        console.log(`      nonce:     ${tx.nonce}`);
        console.log(`      gasLimit:  ${tx.gasLimit}`);
        console.log(`      gasPrice:  ${tx.gasPrice ? ethers.formatUnits(tx.gasPrice, "gwei") + " gwei" : "n/a"}`);
        if (tx.blockNumber) {
          console.log(`      ✅ MINED in block ${tx.blockNumber}`);
        } else {
          console.log(`      ⏳ PENDING (accepted into mempool but not mined)`);
        }
      }
      const rcpt = await provider.getTransactionReceipt(h);
      if (rcpt) {
        console.log(`      Receipt:   status=${rcpt.status} (${rcpt.status === 1 ? "SUCCESS" : "REVERTED"}), block ${rcpt.blockNumber}, gas used ${rcpt.gasUsed}`);
      } else {
        console.log(`      Receipt:   null (either not mined yet, or RPC receipt endpoint broken)`);
      }
    } catch (e) {
      console.log(`      ❌ ethers error: ${e.message}`);
    }
  }

  // ── 6. Same tx via raw JSON-RPC (bypasses ethers parsing) ─────────────────
  console.log("\n[6] Same txs via raw JSON-RPC (catches ethers parsing bugs)");
  for (const h of RECENT_TX_HASHES) {
    console.log(`\n    ${h}`);
    try {
      const r1 = await rawRpc(rpcUrl, "eth_getTransactionByHash", [h]);
      if (r1.error) {
        console.log(`      getTransactionByHash error:  ${JSON.stringify(r1.error)}`);
      } else if (!r1.result) {
        console.log(`      getTransactionByHash:        null (not in mempool or blocks)`);
      } else {
        console.log(`      getTransactionByHash:        blockNumber=${r1.result.blockNumber ?? "PENDING"}, nonce=${parseInt(r1.result.nonce, 16)}`);
      }
      const r2 = await rawRpc(rpcUrl, "eth_getTransactionReceipt", [h]);
      if (r2.error) {
        console.log(`      getTransactionReceipt error: ${JSON.stringify(r2.error)}`);
      } else if (!r2.result) {
        console.log(`      getTransactionReceipt:       null`);
      } else {
        console.log(`      getTransactionReceipt:       status=${r2.result.status}, block=${parseInt(r2.result.blockNumber, 16)}`);
      }
    } catch (e) {
      console.log(`      ❌ raw RPC error: ${e.message}`);
    }
  }

  // ── 7. Summary / next step ────────────────────────────────────────────────
  line();
  console.log("SUMMARY — read the flags above:");
  console.log("");
  console.log("  If [3] shows PENDING TX STUCK  →  stuck nonce. Fix by sending a");
  console.log("     self-transfer at the stuck nonce with 2× the gasPrice to");
  console.log("     evict/replace it. Tell me the pending count and I'll write");
  console.log("     the unstick script.");
  console.log("");
  console.log("  If [5]/[6] show txs are MINED but hardhat scripts still hang  →");
  console.log("     RPC's receipt endpoint is broken for this endpoint. Try a");
  console.log("     different MST RPC URL, or switch script to poll via");
  console.log("     getTransactionByHash + blockNumber (not receipt).");
  console.log("");
  console.log("  If [5]/[6] show txs PENDING even after minutes  →  txs entered");
  console.log("     mempool but underpriced / gas issue. Compare [4] to the");
  console.log("     gasPrice in [5]. Likely need explicit higher gasPrice.");
  console.log("");
  console.log("  If [5] shows 'not found'  →  RPC dropped them silently.");
  console.log("     Different RPC issue — need alternative endpoint.");
  line();
}

main().catch((e) => { console.error(e); process.exit(1); });