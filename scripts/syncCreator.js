// scripts/syncCreator.js
//
// One-off manual sync: calls the local server's /api/admin/sync-creator-nft
// route directly from the command line, for a creator who minted BEFORE
// the automatic sync was wired into Creator.jsx's mint flow.
//
// Usage:
//   1. Paste your JWT below (copy it from the browser console:
//      localStorage.getItem("arcadex_jwt"))
//   2. Fill in USERNAME, AVATAR_COLOR, ORIGIN_CHAIN_KEY to match exactly
//      what you minted with
//   3. Run: node scripts/syncCreator.js

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZGRyZXNzIjoiMHhiNmQwYzVmMWQzYTAyNWZmZTJjMzUyY2M5ZDM1YjRiMjI2MzZkN2Q4IiwiaWF0IjoxNzgyNzQ5MzQ0LCJleHAiOjE3ODI4MzU3NDR9.hLevncHBeYytzOUSFK_0ezHPaarWBJyLiZ8X34vDsBc";

const USERNAME = "aman";          // your exact username, without ".arcade"
const AVATAR_COLOR = "bottts";    // your exact avatar style (bottts, pixel-art, etc.)
const ORIGIN_CHAIN_KEY = "botchain"; // the chain you ALREADY minted on

const SERVER_URL = "http://localhost:3000";

async function main() {
  console.log(`\n🔗 Syncing creator profile "${USERNAME}.arcade" to all live chains except "${ORIGIN_CHAIN_KEY}"...\n`);

  const res = await fetch(`${SERVER_URL}/api/admin/sync-creator-nft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${JWT}`,
    },
    body: JSON.stringify({
      username: USERNAME,
      avatarColor: AVATAR_COLOR,
      originChainKey: ORIGIN_CHAIN_KEY,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("❌ Request failed:", data.error || data);
    process.exit(1);
  }

  console.log("✅ Response:");
  console.log(JSON.stringify(data, null, 2));

  if (data.results?.length) {
    console.log("\n📋 Per-chain summary:");
    data.results.forEach(r => {
      const icon = r.status === "minted" || r.status === "already_minted" ? "✅" : r.status === "skipped" ? "⏭️" : "❌";
      console.log(`  ${icon} ${r.chain}: ${r.status}${r.reason ? ` — ${r.reason}` : ""}`);
    });
  }
}

main().catch(err => {
  console.error("❌ Script error:", err.message);
  process.exit(1);
});