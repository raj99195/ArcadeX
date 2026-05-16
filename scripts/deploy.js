const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. ArcadeToken deploy
  console.log("\n📦 Deploying ArcadeToken...");
  const ArcadeToken = await hre.ethers.getContractFactory("ArcadeToken");
  const arcadeToken = await ArcadeToken.deploy(deployer.address);
  await arcadeToken.waitForDeployment();
  const arcadeTokenAddress = await arcadeToken.getAddress();
  console.log("✅ ArcadeToken:", arcadeTokenAddress);

  // 2. Leaderboard deploy
  console.log("\n📦 Deploying Leaderboard...");
  const Leaderboard = await hre.ethers.getContractFactory("Leaderboard");
  const leaderboard = await Leaderboard.deploy(deployer.address);
  await leaderboard.waitForDeployment();
  const leaderboardAddress = await leaderboard.getAddress();
  console.log("✅ Leaderboard:", leaderboardAddress);

  // 3. Platform deploy
  console.log("\n📦 Deploying Platform...");
  const Platform = await hre.ethers.getContractFactory("Platform");
  const platform = await Platform.deploy(
    deployer.address,
    arcadeTokenAddress,
    leaderboardAddress
  );
  await platform.waitForDeployment();
  const platformAddress = await platform.getAddress();
  console.log("✅ Platform:", platformAddress);

  // 4. CreatorNFT deploy
  console.log("\n📦 Deploying CreatorNFT...");
  const CreatorNFT = await hre.ethers.getContractFactory("CreatorNFT");
  const creatorNFT = await CreatorNFT.deploy(deployer.address);
  await creatorNFT.waitForDeployment();
  const creatorNFTAddress = await creatorNFT.getAddress();
  console.log("✅ CreatorNFT:", creatorNFTAddress);

  // 5. Roles setup
  console.log("\n⚙️ Setting up roles...");

  const PLATFORM_ROLE = hre.ethers.keccak256(
    hre.ethers.toUtf8Bytes("PLATFORM_ROLE")
  );
  await arcadeToken.grantRole(PLATFORM_ROLE, platformAddress);
  console.log("✅ PLATFORM_ROLE granted to Platform");

  const OPERATOR_ROLE = hre.ethers.keccak256(
    hre.ethers.toUtf8Bytes("OPERATOR_ROLE")
  );
  await leaderboard.grantRole(OPERATOR_ROLE, platformAddress);
  console.log("✅ OPERATOR_ROLE granted to Platform");

  // 6. Done
  console.log("\n🎉 DEPLOYMENT COMPLETE!");
  console.log("================================");
  console.log("ArcadeToken:", arcadeTokenAddress);
  console.log("Leaderboard:", leaderboardAddress);
  console.log("Platform:   ", platformAddress);
  console.log("CreatorNFT: ", creatorNFTAddress);
  console.log("================================");
  console.log("\n📝 .env mein save karo:");
  console.log(`VITE_ARCADE_TOKEN_ADDRESS=${arcadeTokenAddress}`);
  console.log(`VITE_LEADERBOARD_ADDRESS=${leaderboardAddress}`);
  console.log(`VITE_PLATFORM_ADDRESS=${platformAddress}`);
  console.log(`VITE_CREATOR_NFT_ADDRESS=${creatorNFTAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});