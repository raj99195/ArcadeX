require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "paris",
      viaIR: true,
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    botchain: {
      url: "https://rpc.botchain.ai",
      chainId: 677,
      accounts: [process.env.PRIVATE_KEY]
    },
    mst: {
      url: "https://mariorpc.mstblockchain.com",
      chainId: 4646,
      accounts: [process.env.PRIVATE_KEY],
      gasPrice: "auto",
    },
    somnia: {
      url: "https://50312.rpc.thirdweb.com",
      chainId: 50312,
      accounts: [process.env.PRIVATE_KEY]
    },
  },

  // ── Custom chain verification ─────────────────────────────────────────────
  etherscan: {
    apiKey: {
      mst:      process.env.MST_EXPLORER_API_KEY     || "no-api-key", // Blockscout doesn't need a real key
      botchain: process.env.BOTCHAIN_EXPLORER_API_KEY || "no-api-key",
    },
    customChains: [
      {
        network: "mst",
        chainId: 4646,
        urls: {
          apiURL:     "https://mstscan.com/api",
          browserURL: "https://mstscan.com",
        },
      },
      {
        network: "botchain",
        chainId: 677,
        urls: {
          apiURL:     "https://scan.botchain.ai/api",
          browserURL: "https://scan.botchain.ai",
        },
      },
    ],
  },
};