// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IChessEscrowMinimal {
    function resolve(bytes32 gameId, address winner) external;
}

/// @notice Test-only ERC20 whose transfers can be armed to re-enter
/// ChessEscrow.resolve() mid-payout, used to prove the nonReentrant guard
/// blocks it. Never deploy this to a live network.
contract MaliciousReentrantUSDC is ERC20 {
    address public escrow;
    bytes32 public targetGameId;
    address public targetWinner;
    bool public armed;

    constructor() ERC20("Malicious USD Coin", "malUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address _escrow, bytes32 _gameId, address _winner) external {
        escrow = _escrow;
        targetGameId = _gameId;
        targetWinner = _winner;
        armed = true;
    }

    /// @notice Calls resolve() with this contract itself as msg.sender, so it
    /// can be set as the escrow's `resolver` for this test — that's what lets
    /// the reentrant call below reach the nonReentrant check instead of just
    /// failing the onlyResolver check first.
    function attack(bytes32 gameId, address winner) external {
        IChessEscrowMinimal(escrow).resolve(gameId, winner);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed) {
            armed = false;
            IChessEscrowMinimal(escrow).resolve(targetGameId, targetWinner);
        }
    }
}
