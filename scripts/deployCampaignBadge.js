// scripts/deployCampaignBadge.js
// Run: npx hardhat run scripts/deployCampaignBadge.js --network botchain_mainnet
require("dotenv").config();
const { ethers } = require("hardhat");

// IPFS gateway base — using the public ipfs.io gateway so the image loads
// for anyone, regardless of which pinning service hosts it.
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

const BADGE_TYPES = [
  {
    name: "Genesis Badge",
    maxSupply: 5000,
    cid: "bafybeibhag5qletlincnrhgdclslvp5kfxvvzad3hqeepgxm3bhm5g2lpa",
  },
  {
    name: "Pioneer Badge",
    maxSupply: 500,
    cid: "bafybeifr5wrcrcie4rdi2ivkfk6h2dpyy24vu3qojc57ohfffeqckptgte",
  },
  {
    name: "Legend Badge",
    maxSupply: 50,
    cid: "bafybeicglxyoruen7mmaxyvsccrfvcpzniv4ro3pduozzw2vuydaxf4nhq",
  },
  {
    name: "Creator Badge",
    maxSupply: 100,
    cid: "bafybeifnoimsaejey6qihipatzbcpor3f6qgtxswgcktbrl4k2wynic4r4",
  },
  {
    name: "Builder Badge",
    maxSupply: 10,
    cid: "bafybeifnmwfh5yxkbudxb7lu35s5vcqm3m5argpcs52deaa3oiflfv57la",
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // ── 1. Deploy CampaignBadge ──────────────────────────────────────────────
  console.log("\n📦 Deploying CampaignBadge...");
  const CampaignBadge = await ethers.getContractFactory("CampaignBadge");
  const badge = await CampaignBadge.deploy(deployer.address);
  await badge.waitForDeployment();
  const badgeAddress = await badge.getAddress();
  console.log("✅ CampaignBadge:", badgeAddress);

  // ── 2. Register all 5 badge types ───────────────────────────────────────
  console.log("\n🏷️  Creating badge types...\n");
  const badgeTypeIds = {};

  for (const b of BADGE_TYPES) {
    const imageURI = IPFS_GATEWAY + b.cid;
    console.log(`Creating: ${b.name} (supply: ${b.maxSupply})`);
    console.log(`  Image: ${imageURI}`);
    try {
      const tx = await badge.createBadgeType(b.name, b.maxSupply, imageURI, { gasLimit: 500000 });
      const receipt = await tx.wait();

      // Pull the badgeTypeId from the BadgeTypeCreated event
      const event = receipt.logs
        .map(log => { try { return badge.interface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "BadgeTypeCreated");
      const badgeTypeId = event ? event.args.badgeTypeId.toString() : "?";

      badgeTypeIds[b.name] = badgeTypeId;
      console.log(`  ✅ Created with badgeTypeId: ${badgeTypeId}\n`);
    } catch (err) {
      console.error(`  ❌ Failed: ${err.shortMessage || err.message}\n`);
    }
  }

  // ── 3. Summary ───────────────────────────────────────────────────────────
  console.log("================================");
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("================================");
  console.log("CampaignBadge address:", badgeAddress);
  console.log("\nBadge Type IDs:");
  for (const [name, id] of Object.entries(badgeTypeIds)) {
    console.log(`  ${name}: ${id}`);
  }
  console.log("\n📝 Add to deployedAddresses.json under your chain key:");
  console.log(`"campaignBadge": "${badgeAddress}"`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
