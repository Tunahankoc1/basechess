// Single place that controls which network the whole app (frontend wallet.js
// AND the api/resolve.js serverless function) talks to. Flipping this is the
// entire mainnet cutover — both sides import `chain` from here.
export const NETWORK = 'base-mainnet';

const NETWORKS = {
  'base-sepolia': {
    chainIdHex: '0x14a34', // 84532
    chainName: 'Base Sepolia',
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorerUrls: ['https://sepolia.basescan.org'],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    escrowAddress: '0xB315eB2Ad9AE2962DF8601ecdf5eC1fDda312398',
  },
  'base-mainnet': {
    chainIdHex: '0x2105', // 8453
    chainName: 'Base',
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    escrowAddress: '0x2d49A9fA0c2eF46fbE86C2c30f6ae0114AF25d38',
  },
};

export const chain = NETWORKS[NETWORK];
