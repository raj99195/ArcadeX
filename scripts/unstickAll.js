const hre = require("hardhat");
const { ethers } = hre;

const START_NONCE = 63;   // Change if needed
const END_NONCE = 84;     // Last pending nonce

const GAS_PRICE = "5";    // gwei

async function main() {
    const [signer] = await ethers.getSigners();

    console.log("======================================");
    console.log("Wallet :", signer.address);
    console.log(`Replacing nonces ${START_NONCE} -> ${END_NONCE}`);
    console.log("======================================");

    for (let nonce = START_NONCE; nonce <= END_NONCE; nonce++) {
        console.log(`\nReplacing nonce ${nonce}...`);

        try {
            const tx = await signer.sendTransaction({
                to: signer.address,
                value: 0,
                nonce,
                gasLimit: 21000,
                gasPrice: ethers.parseUnits(GAS_PRICE, "gwei"),
            });

            console.log(`Tx: ${tx.hash}`);

            await tx.wait();

            console.log(`✅ Nonce ${nonce} mined.`);
        } catch (err) {
            console.log(`❌ Nonce ${nonce} failed`);
            console.log(err.shortMessage || err.message);

            // Continue with next nonce
        }
    }

    console.log("\n======================================");
    console.log("Finished");
    console.log("======================================");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});