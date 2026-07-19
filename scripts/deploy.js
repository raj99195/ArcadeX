const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

// Path to the registry file the frontend reads from (src/config/chains.js
// imports this directly). Adjust this path if your project structure
// differs — it should point at the same file chains.js imports.
const DEPLOYED_ADDRESSES_PATH = path.join(__dirname, "..", "src", "config", "deployedAddresses.json");

// ── Campaign Badge config (was deployCampaignBadge.js) ───────────────────
const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
const BADGE_TYPES = [
  { name: "Genesis Badge", maxSupply: 5000, cid: "bafybeibhag5qletlincnrhgdclslvp5kfxvvzad3hqeepgxm3bhm5g2lpa" },
  { name: "Pioneer Badge", maxSupply: 500,  cid: "bafybeifr5wrcrcie4rdi2ivkfk6h2dpyy24vu3qojc57ohfffeqckptgte" },
  { name: "Legend Badge",  maxSupply: 50,   cid: "bafybeicglxyoruen7mmaxyvsccrfvcpzniv4ro3pduozzw2vuydaxf4nhq" },
  { name: "Creator Badge", maxSupply: 100,  cid: "bafybeifnoimsaejey6qihipatzbcpor3f6qgtxswgcktbrl4k2wynic4r4" },
  { name: "Builder Badge", maxSupply: 10,   cid: "bafybeifnmwfh5yxkbudxb7lu35s5vcqm3m5argpcs52deaa3oiflfv57la" },
];

// ── Avatar style items config (was addAvatarStyles.js) ───────────────────
// ItemType.Skin = 3 in ArcadeMarketplace.sol
const SKIN_ITEM_TYPE = 3;
const E18 = ethers.parseEther;
const AVATAR_STYLES = [
  { name: "Style: Adventurer", desc: "Unlock Adventurer avatar style — gamer cartoon look",   price: E18("100"), supply: 0 },
  { name: "Style: Lorelei",    desc: "Unlock Lorelei avatar style — anime-inspired character", price: E18("100"), supply: 0 },
  { name: "Style: Notionists", desc: "Unlock Notionists avatar style — minimal line art",       price: E18("300"), supply: 0 },
  { name: "Style: Micah",      desc: "Unlock Micah avatar style — modern illustration",         price: E18("300"), supply: 0 },
  { name: "Style: Rings",      desc: "Unlock Rings avatar style — abstract geometric design",   price: E18("500"), supply: 0 },
  { name: "Style: Shapes",     desc: "Unlock Shapes avatar style — bold abstract art",          price: E18("500"), supply: 0 },
  { name: "Style: Thumbs",     desc: "Unlock Thumbs avatar style — ultra rare character",       price: E18("800"), supply: 0 },
  { name: "Style: Croodles",   desc: "Unlock Croodles avatar style — hand-drawn exclusive",     price: E18("800"), supply: 0 },
];

async function main() {
  // hre.network.name is whatever you passed to --network — e.g.
  // `npx hardhat run scripts/deploy.js --network somnia` makes this "somnia".
  // This MUST match a key in chains.js / deployedAddresses.json for the
  // auto-write step below to land in the right place.
  const chainKey = hre.network.name;
  console.log(`\n🔗 Deploying full stack to chain: ${chainKey}\n`);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // ════════════════════════════════════════════════════════════════
  // CORE CONTRACTS
  // ════════════════════════════════════════════════════════════════

  console.log("\n📦 Deploying ArcadeToken...");
  const ArcadeToken = await ethers.getContractFactory("ArcadeToken");
  const arcadeToken = await ArcadeToken.deploy(deployer.address);
  await arcadeToken.waitForDeployment();
  const arcadeTokenAddress = await arcadeToken.getAddress();
  console.log("✅ ArcadeToken:", arcadeTokenAddress);

  console.log("\n📦 Deploying Leaderboard...");
  const Leaderboard = await ethers.getContractFactory("Leaderboard");
  const leaderboard = await Leaderboard.deploy(deployer.address);
  await leaderboard.waitForDeployment();
  const leaderboardAddress = await leaderboard.getAddress();
  console.log("✅ Leaderboard:", leaderboardAddress);

  console.log("\n📦 Deploying Platform...");
  const Platform = await ethers.getContractFactory("Platform");
  const platform = await Platform.deploy(deployer.address, arcadeTokenAddress, leaderboardAddress);
  await platform.waitForDeployment();
  const platformAddress = await platform.getAddress();
  console.log("✅ Platform:", platformAddress);

  console.log("\n📦 Deploying CreatorNFT...");
  const CreatorNFT = await ethers.getContractFactory("CreatorNFT");
  const creatorNFT = await CreatorNFT.deploy(deployer.address);
  await creatorNFT.waitForDeployment();
  const creatorNFTAddress = await creatorNFT.getAddress();
  console.log("✅ CreatorNFT:", creatorNFTAddress);

  console.log("\n📦 Deploying Tournament...");
  const Tournament = await ethers.getContractFactory("Tournament");
  const tournament = await Tournament.deploy(deployer.address, arcadeTokenAddress);
  await tournament.waitForDeployment();
  const tournamentAddress = await tournament.getAddress();
  console.log("✅ Tournament:", tournamentAddress);

  console.log("\n📦 Deploying ArcadeMarketplace...");
  const ArcadeMarketplace = await ethers.getContractFactory("ArcadeMarketplace");
  const marketplace = await ArcadeMarketplace.deploy(deployer.address, arcadeTokenAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("✅ ArcadeMarketplace:", marketplaceAddress);

  console.log("\n📦 Deploying CampaignBadge...");
  const CampaignBadge = await ethers.getContractFactory("CampaignBadge");
  const campaignBadge = await CampaignBadge.deploy(deployer.address);
  await campaignBadge.waitForDeployment();
  const campaignBadgeAddress = await campaignBadge.getAddress();
  console.log("✅ CampaignBadge:", campaignBadgeAddress);

  // ════════════════════════════════════════════════════════════════
  // ROLES SETUP
  // ════════════════════════════════════════════════════════════════
  console.log("\n⚙️  Setting up roles...");

  const PLATFORM_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PLATFORM_ROLE"));
  await arcadeToken.grantRole(PLATFORM_ROLE, platformAddress);
  console.log("✅ PLATFORM_ROLE → Platform");

  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  await leaderboard.grantRole(OPERATOR_ROLE, platformAddress);
  console.log("✅ OPERATOR_ROLE → Platform");

  await arcadeToken.grantRole(PLATFORM_ROLE, tournamentAddress);
  console.log("✅ PLATFORM_ROLE → Tournament");

  await arcadeToken.grantRole(PLATFORM_ROLE, marketplaceAddress);
  console.log("✅ PLATFORM_ROLE → Marketplace");

  // ════════════════════════════════════════════════════════════════
  // CAMPAIGN BADGE TYPES (was deployCampaignBadge.js)
  // ════════════════════════════════════════════════════════════════
  console.log("\n🏷️  Creating campaign badge types...\n");
  const badgeTypeIds = {};

  for (const b of BADGE_TYPES) {
    const imageURI = IPFS_GATEWAY + b.cid;
    console.log(`Creating: ${b.name} (supply: ${b.maxSupply})`);
    try {
      const tx = await campaignBadge.createBadgeType(b.name, b.maxSupply, imageURI, { gasLimit: 500000 });
      const receipt = await tx.wait();
      const event = receipt.logs
        .map(log => { try { return campaignBadge.interface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "BadgeTypeCreated");
      const badgeTypeId = event ? event.args.badgeTypeId.toString() : "?";
      badgeTypeIds[b.name] = badgeTypeId;
      console.log(`  ✅ Created with badgeTypeId: ${badgeTypeId}`);
    } catch (err) {
      console.error(`  ❌ Failed: ${err.shortMessage || err.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // AVATAR STYLE MARKETPLACE ITEMS (was addAvatarStyles.js)
  // ════════════════════════════════════════════════════════════════
  console.log(`\n🎨 Adding ${AVATAR_STYLES.length} avatar style items to Marketplace...\n`);

  for (const style of AVATAR_STYLES) {
    console.log(`Adding: ${style.name} — ${ethers.formatEther(style.price)} ARCADE`);
    try {
      const tx = await marketplace.addItem(
        style.name,
        style.desc,
        "",                 // imageURI — empty for now
        SKIN_ITEM_TYPE,
        style.price,        // arcadePrice
        0,                  // botPrice = 0 (only ARCADE)
        style.supply,       // 0 = unlimited
        { gasLimit: 300000 }
      );
      await tx.wait();
      console.log(`  ✅ Added!`);
    } catch (err) {
      console.error(`  ❌ Failed: ${err.shortMessage || err.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // AUTO-WRITE to deployedAddresses.json under this chain's key
  // ════════════════════════════════════════════════════════════════
  console.log(`\n💾 Writing addresses to deployedAddresses.json under "${chainKey}"...`);
  try {
    const raw = fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8");
    const allAddresses = JSON.parse(raw);

    if (!(chainKey in allAddresses)) {
      console.warn(`⚠️  "${chainKey}" is not an existing key in deployedAddresses.json — adding it now. Make sure chains.js also has a "${chainKey}" entry, or the frontend won't pick this chain up.`);
    }

    allAddresses[chainKey] = {
      token: arcadeTokenAddress,
      platform: platformAddress,
      tournament: tournamentAddress,
      creatorNft: creatorNFTAddress,
      marketplace: marketplaceAddress,
      leaderboard: leaderboardAddress,
      campaignBadge: campaignBadgeAddress,
      deployedAt: new Date().toISOString(),
    };

    fs.writeFileSync(DEPLOYED_ADDRESSES_PATH, JSON.stringify(allAddresses, null, 2) + "\n");
    console.log(`✅ deployedAddresses.json updated for "${chainKey}"`);
  } catch (err) {
    console.error(`❌ Failed to auto-write deployedAddresses.json: ${err.message}`);
    console.error("   You'll need to copy the addresses below in manually.");
  }

  // ════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════
  console.log("\n🎉 DEPLOYMENT COMPLETE!");
  console.log("================================");
  console.log("Chain:         ", chainKey);
  console.log("ArcadeToken:   ", arcadeTokenAddress);
  console.log("Leaderboard:   ", leaderboardAddress);
  console.log("Platform:      ", platformAddress);
  console.log("CreatorNFT:    ", creatorNFTAddress);
  console.log("Tournament:    ", tournamentAddress);
  console.log("Marketplace:   ", marketplaceAddress);
  console.log("CampaignBadge: ", campaignBadgeAddress);
  console.log("\nBadge Type IDs:");
  for (const [name, id] of Object.entries(badgeTypeIds)) {
    console.log(`  ${name}: ${id}`);
  }
  console.log("================================");
  console.log("\n📝 Next step: open src/config/chains.js and flip this chain's");
  console.log(`   status from "coming_soon" to "live" — that's it, no other`);
  console.log(`   file needs to change.`);
  console.log("\n📝 Also update VITE_CAMPAIGN_BADGE_ADDRESS in your .env to:");
  console.log(`   ${campaignBadgeAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});