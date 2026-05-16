require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun"
    }
  },
  networks: {
    botchain_testnet: {
      url: process.env.BOTCHAIN_TESTNET_RPC_URL,
      chainId: parseInt(process.env.BOTCHAIN_TESTNET_CHAIN_ID),
      accounts: [process.env.PRIVATE_KEY]
    },
    botchain_mainnet: {
      url: process.env.BOTCHAIN_MAINNET_RPC_URL,
      chainId: parseInt(process.env.BOTCHAIN_MAINNET_CHAIN_ID),
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};