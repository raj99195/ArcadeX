const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const ADMIN = process.env.VITE_ADMIN_ADDRESS;

  const CreatorNFT = await ethers.deployContract("CreatorNFT", [ADMIN]);
  await CreatorNFT.waitForDeployment();
  console.log("✅ CreatorNFT:", await CreatorNFT.getAddress());
  console.log("\n.env mein update karo:");
  console.log(`VITE_CREATOR_NFT_ADDRESS=${await CreatorNFT.getAddress()}`);
}

main().catch(console.error);