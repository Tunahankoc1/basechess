// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only stand-in for Base's real USDC (6 decimals), used by
/// Hardhat tests. Never deploy this to a live network.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
