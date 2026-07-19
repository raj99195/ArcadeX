// scripts/debugCreatorSync.js
// Run: node scripts/debugCreatorSync.js
//
// Diagnoses exactly why adminMintFor() is reverting on Somnia by checking
// each of its require() conditions individually, in order, before
// attempting the actual call.

require("dotenv").config();
const { ethers } = require("ethers");

const SOMNIA_RPC = "https://50312.rpc.thirdweb.com";
const CREATOR_NFT_ADDRESS = "0x40E02708d725d084135D80ea30F42F109e9687f5"; // Somnia CreatorNFT from your deploy output

const CREATOR = "0xB6D0C5f1D3A025FfE2C352Cc9d35B4b22636d7D8";
const USERNAME = "aman";
const AVATAR_COLOR = "bottts";

const ABI = [
  "function walletToToken(address) external view returns (uint256)",
  "function usernameTaken(string) external view returns (bool)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function MINTER_ROLE() external view returns (bytes32)",
  "function adminMintFor(address creator, string username, string avatarColor) external",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(SOMNIA_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CREATOR_NFT_ADDRESS, ABI, wallet);

  console.log("Signer address:", wallet.address);
  console.log("Contract address:", CREATOR_NFT_ADDRESS);
  console.log("");

  // Check 1: does the signer actually have MINTER_ROLE on THIS contract?
  const MINTER_ROLE = await contract.MINTER_ROLE();
  const hasMinterRole = await contract.hasRole(MINTER_ROLE, wallet.address);
  console.log(`✓ Check 1 — Signer has MINTER_ROLE: ${hasMinterRole ? "✅ YES" : "❌ NO"}`);

  // Check 2: is the creator already a token holder on this chain?
  const existingTokenId = await contract.walletToToken(CREATOR);
  console.log(`✓ Check 2 — Creator already has tokenId: ${existingTokenId.toString()} ${existingTokenId.toString() !== "0" ? "❌ ALREADY A CREATOR" : "✅ OK (no existing token)"}`);

  // Check 3: is the username already taken on this chain?
  const taken = await contract.usernameTaken(USERNAME);
  console.log(`✓ Check 3 — Username "${USERNAME}" taken: ${taken ? "❌ YES (taken)" : "✅ NO (available)"}`);

  // Check 4: username length
  console.log(`✓ Check 4 — Username length: ${USERNAME.length} ${USERNAME.length >= 3 && USERNAME.length <= 20 ? "✅ OK" : "❌ OUT OF RANGE"}`);

  console.log("\n--- Attempting actual call with staticCall (no gas spent, just simulates) ---\n");
  try {
    await contract.adminMintFor.staticCall(CREATOR, USERNAME, AVATAR_COLOR, { from: wallet.address });
    console.log("✅ Simulation succeeded — the real transaction should work.");
  } catch (err) {
    console.log("❌ Simulation failed. Full error:");
    console.log(err.reason || err.shortMessage || err.message);
    if (err.data) console.log("Raw revert data:", err.data);
  }
}

main().catch(err => {
  console.error("Script error:", err.message);
  process.exit(1);
});
