const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. ArcadeToken
  console.log("\n📦 Deploying ArcadeToken...");
  const ArcadeToken = await hre.ethers.getContractFactory("ArcadeToken");
  const arcadeToken = await ArcadeToken.deploy(deployer.address);
  await arcadeToken.waitForDeployment();
  const arcadeTokenAddress = await arcadeToken.getAddress();
  console.log("✅ ArcadeToken:", arcadeTokenAddress);

  // 2. Leaderboard
  console.log("\n📦 Deploying Leaderboard...");
  const Leaderboard = await hre.ethers.getContractFactory("Leaderboard");
  const leaderboard = await Leaderboard.deploy(deployer.address);
  await leaderboard.waitForDeployment();
  const leaderboardAddress = await leaderboard.getAddress();
  console.log("✅ Leaderboard:", leaderboardAddress);

  // 3. Platform
  console.log("\n📦 Deploying Platform...");
  const Platform = await hre.ethers.getContractFactory("Platform");
  const platform = await Platform.deploy(deployer.address, arcadeTokenAddress, leaderboardAddress);
  await platform.waitForDeployment();
  const platformAddress = await platform.getAddress();
  console.log("✅ Platform:", platformAddress);

  // 4. CreatorNFT
  console.log("\n📦 Deploying CreatorNFT...");
  const CreatorNFT = await hre.ethers.getContractFactory("CreatorNFT");
  const creatorNFT = await CreatorNFT.deploy(deployer.address);
  await creatorNFT.waitForDeployment();
  const creatorNFTAddress = await creatorNFT.getAddress();
  console.log("✅ CreatorNFT:", creatorNFTAddress);

  // 5. Tournament
  console.log("\n📦 Deploying Tournament...");
  const Tournament = await hre.ethers.getContractFactory("Tournament");
  const tournament = await Tournament.deploy(deployer.address, arcadeTokenAddress);
  await tournament.waitForDeployment();
  const tournamentAddress = await tournament.getAddress();
  console.log("✅ Tournament:", tournamentAddress);

    // 6. ArcadeMarketplace deploy
  console.log("\n📦 Deploying ArcadeMarketplace...");
  const ArcadeMarketplace = await hre.ethers.getContractFactory("ArcadeMarketplace");
  const marketplace = await ArcadeMarketplace.deploy(deployer.address, arcadeTokenAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("✅ ArcadeMarketplace:", marketplaceAddress);

  // 6. Roles setup
  console.log("\n⚙️ Setting up roles...");

  const PLATFORM_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("PLATFORM_ROLE"));
  await arcadeToken.grantRole(PLATFORM_ROLE, platformAddress);
  console.log("✅ PLATFORM_ROLE → Platform");

  const OPERATOR_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("OPERATOR_ROLE"));
  await leaderboard.grantRole(OPERATOR_ROLE, platformAddress);
  console.log("✅ OPERATOR_ROLE → Platform");

  // Tournament ko PLATFORM_ROLE do — taaki tokens transfer kar sake
  await arcadeToken.grantRole(PLATFORM_ROLE, tournamentAddress);
  console.log("✅ PLATFORM_ROLE → Tournament");

   // Marketplace ko PLATFORM_ROLE do — taaki ARCADE mint kar sake
  await arcadeToken.grantRole(PLATFORM_ROLE, marketplaceAddress);
  console.log("✅ PLATFORM_ROLE → Marketplace");

  // 7. Done
  console.log("\n🎉 DEPLOYMENT COMPLETE!");
  console.log("================================");
  console.log("ArcadeToken: ", arcadeTokenAddress);
  console.log("Leaderboard: ", leaderboardAddress);
  console.log("Platform:    ", platformAddress);
  console.log("CreatorNFT:  ", creatorNFTAddress);
  console.log("Tournament:  ", tournamentAddress);
  console.log("Marketplace:  ", marketplaceAddress);
  console.log(`VITE_MARKETPLACE_ADDRESS=${marketplaceAddress}`);
  console.log("================================");
  console.log("\n📝 .env mein save karo:");
  console.log(`VITE_ARCADE_TOKEN_ADDRESS=${arcadeTokenAddress}`);
  console.log(`VITE_LEADERBOARD_ADDRESS=${leaderboardAddress}`);
  console.log(`VITE_PLATFORM_ADDRESS=${platformAddress}`);
  console.log(`VITE_CREATOR_NFT_ADDRESS=${creatorNFTAddress}`);
  console.log(`VITE_TOURNAMENT_ADDRESS=${tournamentAddress}`);
  
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});