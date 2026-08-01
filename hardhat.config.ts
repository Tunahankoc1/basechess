import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    baseSepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    base: {
      type: "http",
      chainType: "l1",
      url: configVariable("BASE_MAINNET_RPC_URL"),
      accounts: [configVariable("MAINNET_DEPLOYER_PRIVATE_KEY")],
    },
  },
});
