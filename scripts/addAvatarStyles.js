// scripts/addAvatarStyles.js
// Run: npx hardhat run scripts/addAvatarStyles.js --network botchain_testnet
require("dotenv").config();
const { ethers } = require("hardhat");

const MARKETPLACE_ADDRESS = process.env.VITE_MARKETPLACE_ADDRESS;

const MARKETPLACE_ABI = [
  "function addItem(string name, string description, string imageURI, uint8 itemType, uint256 arcadePrice, uint256 botPrice, uint256 totalSupply) external",
  "function nextItemId() external view returns (uint256)",
  "function getAllItems() external view returns (tuple(uint256 id, string name, string description, string imageURI, uint8 itemType, uint256 arcadePrice, uint256 botPrice, uint256 totalSupply, uint256 sold, bool active)[])",
];

// ItemType.Skin = 3
const SKIN = 3;
const E18 = ethers.parseEther;

const AVATAR_STYLES = [
  // Free styles — already unlocked by default, no need to add
  // Uncommon
  { name: "Style: Adventurer",  desc: "Unlock Adventurer avatar style — gamer cartoon look",    price: E18("100"), supply: 0 },
  { name: "Style: Lorelei",     desc: "Unlock Lorelei avatar style — anime-inspired character",  price: E18("100"), supply: 0 },
  // Rare
  { name: "Style: Notionists",  desc: "Unlock Notionists avatar style — minimal line art",       price: E18("300"), supply: 0 },
  { name: "Style: Micah",       desc: "Unlock Micah avatar style — modern illustration",         price: E18("300"), supply: 0 },
  // Epic
  { name: "Style: Rings",       desc: "Unlock Rings avatar style — abstract geometric design",   price: E18("500"), supply: 0 },
  { name: "Style: Shapes",      desc: "Unlock Shapes avatar style — bold abstract art",          price: E18("500"), supply: 0 },
  // Legendary
  { name: "Style: Thumbs",      desc: "Unlock Thumbs avatar style — ultra rare character",       price: E18("800"), supply: 0 },
  { name: "Style: Croodles",    desc: "Unlock Croodles avatar style — hand-drawn exclusive",     price: E18("800"), supply: 0 },
];

async function main() {
  const [admin] = await ethers.getSigners();
  console.log("Admin:", admin.address);
  console.log("Marketplace:", MARKETPLACE_ADDRESS);

  const marketplace = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, admin);

  const nextId = await marketplace.nextItemId();
  console.log(`\nCurrent nextItemId: ${nextId}`);
  console.log(`Adding ${AVATAR_STYLES.length} avatar style items...\n`);

  for (const style of AVATAR_STYLES) {
    console.log(`Adding: ${style.name} — ${ethers.formatEther(style.price)} ARCADE`);
    try {
      const tx = await marketplace.addItem(
        style.name,
        style.desc,
        "",           // imageURI — empty for now
        SKIN,         // ItemType.Skin = 3
        style.price,  // arcadePrice
        0,            // botPrice = 0 (only ARCADE)
        style.supply, // 0 = unlimited
        { gasLimit: 300000 }
      );
      await tx.wait();
      console.log(`  ✅ Added! TX: ${tx.hash}`);
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message?.slice(0, 80)}`);
    }
  }

  const finalNextId = await marketplace.nextItemId();
  console.log(`\n✅ Done! Items added. nextItemId: ${finalNextId}`);
  console.log(`\nItem IDs assigned: ${Number(nextId)} to ${Number(finalNextId) - 1}`);
}

main().catch(err => { console.error(err); process.exit(1); });
