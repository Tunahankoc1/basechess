import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, toBytes, parseUnits, getAddress } from "viem";

const STAKE = parseUnits("1", 6); // 1 mUSDC, 6 decimals like real USDC

function gameIdFor(label: string) {
  return keccak256(toBytes(label));
}

async function deployFixture(
  usdcContractName: "MockUSDC" | "MaliciousReentrantUSDC" = "MockUSDC",
  useTokenAsResolver = false,
) {
  const { viem, networkHelpers } = await network.create();
  const [deployer, resolverWallet, playerA, playerB, stranger] =
    await viem.getWalletClients();

  const usdc = await viem.deployContract(usdcContractName);
  const escrow = await viem.deployContract("ChessEscrow", [
    usdc.address,
    useTokenAsResolver ? getAddress(usdc.address) : getAddress(resolverWallet.account.address),
  ]);

  for (const p of [playerA, playerB]) {
    await usdc.write.mint([p.account.address, parseUnits("1000", 6)]);
    await usdc.write.approve([escrow.address, parseUnits("1000", 6)], {
      account: p.account.address,
    });
  }

  return { viem, networkHelpers, deployer, resolverWallet, playerA, playerB, stranger, usdc, escrow };
}

async function setUpFundedGame(gameId: `0x${string}`) {
  const ctx = await deployFixture();
  const { escrow, playerA, playerB } = ctx;

  await escrow.write.createGame([gameId, STAKE], { account: playerA.account.address });
  await escrow.write.joinGame([gameId], { account: playerB.account.address });
  await escrow.write.deposit([gameId], { account: playerA.account.address });
  await escrow.write.deposit([gameId], { account: playerB.account.address });

  return ctx;
}

describe("ChessEscrow", async function () {
  const { viem } = await network.create();

  it("runs a full happy path: create, join, both deposit, resolver pays the winner the full pot", async () => {
    const gameId = gameIdFor("game-happy-path");
    const { escrow, usdc, playerA, playerB, resolverWallet } = await setUpFundedGame(gameId);

    const game = await escrow.read.games([gameId]);
    assert.equal(game[5], 2); // status === Funded

    const balanceBefore = await usdc.read.balanceOf([playerA.account.address]);

    await escrow.write.resolve([gameId, playerA.account.address], {
      account: resolverWallet.account.address,
    });

    const balanceAfter = await usdc.read.balanceOf([playerA.account.address]);
    assert.equal(balanceAfter - balanceBefore, STAKE * 2n);

    const gameAfter = await escrow.read.games([gameId]);
    assert.equal(gameAfter[5], 3); // status === Resolved
  });

  it("resolveDraw splits the pot evenly between both players", async () => {
    const gameId = gameIdFor("game-draw");
    const { escrow, usdc, playerA, playerB, resolverWallet } = await setUpFundedGame(gameId);

    const beforeA = await usdc.read.balanceOf([playerA.account.address]);
    const beforeB = await usdc.read.balanceOf([playerB.account.address]);

    await escrow.write.resolveDraw([gameId], { account: resolverWallet.account.address });

    const afterA = await usdc.read.balanceOf([playerA.account.address]);
    const afterB = await usdc.read.balanceOf([playerB.account.address]);

    assert.equal(afterA - beforeA, STAKE);
    assert.equal(afterB - beforeB, STAKE);
  });

  it("charges both players the exact same stake amount fixed at createGame time", async () => {
    const gameId = gameIdFor("game-same-stake");
    const { escrow, usdc, playerA, playerB } = await deployFixture();

    await escrow.write.createGame([gameId, STAKE], { account: playerA.account.address });
    await escrow.write.joinGame([gameId], { account: playerB.account.address });

    const beforeA = await usdc.read.balanceOf([playerA.account.address]);
    const beforeB = await usdc.read.balanceOf([playerB.account.address]);

    await escrow.write.deposit([gameId], { account: playerA.account.address });
    await escrow.write.deposit([gameId], { account: playerB.account.address });

    const afterA = await usdc.read.balanceOf([playerA.account.address]);
    const afterB = await usdc.read.balanceOf([playerB.account.address]);

    assert.equal(beforeA - afterA, STAKE);
    assert.equal(beforeB - afterB, STAKE);
  });

  it("reverts on a double deposit from the same player", async () => {
    const gameId = gameIdFor("game-double-deposit");
    const { escrow, playerA, playerB } = await deployFixture();

    await escrow.write.createGame([gameId, STAKE], { account: playerA.account.address });
    await escrow.write.joinGame([gameId], { account: playerB.account.address });
    await escrow.write.deposit([gameId], { account: playerA.account.address });

    await viem.assertions.revertWith(
      escrow.write.deposit([gameId], { account: playerA.account.address }),
      "already deposited",
    );
  });

  it("reverts resolve() when called by anyone other than the resolver", async () => {
    const gameId = gameIdFor("game-not-resolver");
    const { escrow, playerA, stranger } = await setUpFundedGame(gameId);

    await viem.assertions.revertWith(
      escrow.write.resolve([gameId, playerA.account.address], {
        account: stranger.account.address,
      }),
      "not resolver",
    );
  });

  it("reverts resolve() when the game isn't funded yet", async () => {
    const gameId = gameIdFor("game-not-funded");
    const { escrow, playerA, playerB, resolverWallet } = await deployFixture();

    await escrow.write.createGame([gameId, STAKE], { account: playerA.account.address });
    await escrow.write.joinGame([gameId], { account: playerB.account.address });
    // only one side deposits -> never reaches Funded

    await escrow.write.deposit([gameId], { account: playerA.account.address });

    await viem.assertions.revertWith(
      escrow.write.resolve([gameId, playerA.account.address], {
        account: resolverWallet.account.address,
      }),
      "not funded",
    );
  });

  it("blocks claimAbandonRefund before the timeout and allows it after, refunding each player their own stake", async () => {
    const gameId = gameIdFor("game-abandon");
    const { escrow, usdc, networkHelpers, playerA, playerB } = await setUpFundedGame(gameId);

    await viem.assertions.revertWith(
      escrow.write.claimAbandonRefund([gameId], { account: playerA.account.address }),
      "timeout not reached",
    );

    await networkHelpers.time.increase(24 * 60 * 60 + 1);

    const beforeA = await usdc.read.balanceOf([playerA.account.address]);
    const beforeB = await usdc.read.balanceOf([playerB.account.address]);

    await escrow.write.claimAbandonRefund([gameId], { account: playerA.account.address });

    const afterA = await usdc.read.balanceOf([playerA.account.address]);
    const afterB = await usdc.read.balanceOf([playerB.account.address]);

    assert.equal(afterA - beforeA, STAKE);
    assert.equal(afterB - beforeB, STAKE);
  });

  it("lets the creator cancel a game nobody has funded yet", async () => {
    const gameId = gameIdFor("game-cancel");
    const { escrow, playerA, playerB } = await deployFixture();

    await escrow.write.createGame([gameId, STAKE], { account: playerA.account.address });
    await escrow.write.joinGame([gameId], { account: playerB.account.address });
    await escrow.write.cancelUnfundedGame([gameId], { account: playerA.account.address });

    const game = await escrow.read.games([gameId]);
    assert.equal(game[5], 5); // status === Cancelled
  });

  it("rejects a player joining their own game and a second player joining an already-joined game", async () => {
    const gameId = gameIdFor("game-join-rules");
    const { escrow, playerA, playerB, stranger } = await deployFixture();

    await escrow.write.createGame([gameId, STAKE], { account: playerA.account.address });

    await viem.assertions.revertWith(
      escrow.write.joinGame([gameId], { account: playerA.account.address }),
      "cannot join own game",
    );

    await escrow.write.joinGame([gameId], { account: playerB.account.address });

    await viem.assertions.revertWith(
      escrow.write.joinGame([gameId], { account: stranger.account.address }),
      "already joined",
    );
  });

  it("blocks a reentrant call into resolve() during the payout transfer", async () => {
    const gameId = gameIdFor("game-reentrancy");
    // The malicious token itself must be the escrow's `resolver` here: the
    // reentrant call it makes from inside _update() has the token contract
    // as msg.sender, so onlyResolver only passes (letting us reach the
    // nonReentrant check) if the token address IS the configured resolver.
    const { escrow, usdc, playerA, playerB } = await deployFixture(
      "MaliciousReentrantUSDC",
      true,
    );

    await escrow.write.createGame([gameId, STAKE], { account: playerA.account.address });
    await escrow.write.joinGame([gameId], { account: playerB.account.address });
    await escrow.write.deposit([gameId], { account: playerA.account.address });
    await escrow.write.deposit([gameId], { account: playerB.account.address });

    await usdc.write.arm([escrow.address, gameId, playerB.account.address]);

    await viem.assertions.revertWithCustomError(
      usdc.write.attack([gameId, playerA.account.address]),
      escrow,
      "ReentrancyGuardReentrantCall",
    );

    // the whole tx reverted, so the game must still be Funded, not Resolved
    const game = await escrow.read.games([gameId]);
    assert.equal(game[5], 2);
  });
});
