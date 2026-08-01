// Manual end-to-end check of ChessEscrow against a live Base Sepolia deployment.
// Reads player/resolver private keys from .env — never hardcode keys here.
// Usage: node scripts/sepolia-smoke-test.mjs
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.BASE_SEPOLIA_RPC_URL;
const USDC = process.env.USDC_ADDRESS;
const ESCROW = process.env.ESCROW_CONTRACT_ADDRESS;
const STAKE = parseUnits("0.1", 6); // small enough to fit the faucet balances

const usdcAbi = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];

const escrowAbi = [
  { name: "createGame", type: "function", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "uint256" }], outputs: [] },
  { name: "joinGame", type: "function", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { name: "resolve", type: "function", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [] },
  {
    name: "games", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }],
    outputs: [
      { type: "address" }, { type: "address" }, { type: "uint256" },
      { type: "bool" }, { type: "bool" }, { type: "uint8" },
      { type: "uint256" }, { type: "uint256" },
    ],
  },
];

const publicClient = createPublicClient({ transport: http(RPC) });

function walletFor(envVar) {
  const account = privateKeyToAccount(process.env[envVar]);
  return createWalletClient({ account, transport: http(RPC) });
}

const playerA = walletFor("PLAYER_A_PRIVATE_KEY");
const playerB = walletFor("PLAYER_B_PRIVATE_KEY");
const resolver = walletFor("RESOLVER_PRIVATE_KEY");

const gameId = keccak256(toBytes(`smoke-test-${Date.now()}`));

async function usdcBalance(address) {
  return publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [address] });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The public Base Sepolia RPC is load-balanced across multiple nodes, so a
// read immediately after a confirmed write can briefly hit a node that
// hasn't caught up yet. Confirm the receipt succeeded, then pause before the
// next call that depends on the new state.
async function wait(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction ${hash} reverted`);
  }
  await sleep(4000);
  return receipt;
}

async function main() {
  console.log("gameId:", gameId);

  console.log("approving USDC for both players...");
  await wait(await playerA.writeContract({ address: USDC, abi: usdcAbi, functionName: "approve", args: [ESCROW, STAKE] }));
  await wait(await playerB.writeContract({ address: USDC, abi: usdcAbi, functionName: "approve", args: [ESCROW, STAKE] }));

  console.log("createGame...");
  await wait(await playerA.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "createGame", args: [gameId, STAKE] }));

  console.log("joinGame...");
  await wait(await playerB.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "joinGame", args: [gameId] }));

  console.log("deposit x2...");
  await wait(await playerA.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "deposit", args: [gameId] }));
  await wait(await playerB.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "deposit", args: [gameId] }));

  const gameFunded = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "games", args: [gameId] });
  console.log("status after funding (2 = Funded):", gameFunded[5]);

  const beforeA = await usdcBalance(playerA.account.address);

  console.log("resolver declares Player A the winner...");
  const resolveTx = await resolver.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "resolve", args: [gameId, playerA.account.address] });
  await wait(resolveTx);

  const afterA = await usdcBalance(playerA.account.address);
  const gameResolved = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "games", args: [gameId] });

  console.log("resolve tx:", resolveTx);
  console.log("Player A USDC gained:", formatUnits(afterA - beforeA, 6));
  console.log("status after resolve (3 = Resolved):", gameResolved[5]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
