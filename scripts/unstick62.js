const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [signer] = await ethers.getSigners();

  console.log("Wallet :", signer.address);

  const tx = await signer.sendTransaction({
    to: signer.address,          // self transfer
    value: 0,
    nonce: 62,                   // FIRST stuck nonce
    gasLimit: 21000,
    gasPrice: ethers.parseUnits("5", "gwei"), // higher than old tx
  });

  console.log("Tx Hash:", tx.hash);

  await tx.wait();

  console.log("✅ Nonce 62 replaced.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});