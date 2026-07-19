require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Chain data directly hardcoded — mirrors src/config/chains.js
// (public RPC values, no secrets needed here)
// IMPORTANT: keys must match chains.js exactly — deploy.js uses
// hre.network.name to write into the correct deployedAddresses.json key.

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      // NOTE: was "cancun" — MST Mainnet's EVM doesn't support Cancun
      // opcodes yet (MCOPY specifically), causing "invalid opcode: MCOPY"
      // on deploy. MST Testnet DOES support Cancun, so this only became a
      // problem switching to mainnet. "paris" is a safe, widely-supported
      // baseline that avoids MCOPY, transient storage (TSTORE/TLOAD), and
      // PUSH0 — if MST mainnet turns out to support Shanghai (PUSH0) you
      // can bump this to "shanghai" for slightly cheaper deploys.
      evmVersion: "paris",
      viaIR: true,
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    // BOTChain mainnet — chains.js key: "botchain"
    botchain: {
      url: "https://rpc.botchain.ai",
      chainId: 677,
      accounts: [process.env.PRIVATE_KEY]
    },
    // MST Mainnet — chains.js key: "mst"
    // Confirmed RPC + chainId from MST's official hardhat.config.js docs.
    mst: {
      url: "https://mariorpc.mstblockchain.com",
      chainId: 4646,
      accounts: [process.env.PRIVATE_KEY],
      gasPrice: "auto",
    },
       // Somnia — chains.js key: "somnia"
    somnia: {
      url: "https://50312.rpc.thirdweb.com",
      chainId: 50312,
      accounts: [process.env.PRIVATE_KEY]
    },
  }
};