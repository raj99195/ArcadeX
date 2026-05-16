// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract ArcadeToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PLATFORM_ROLE = keccak256("PLATFORM_ROLE");

    uint256 public rewardRate = 50 * 10 ** 18; // 50 ARCADE per play

    event RewardMinted(
        address indexed player,
        address indexed creator,
        uint256 playerAmount,
        uint256 creatorAmount
    );

    constructor(address admin) ERC20("ARCADE", "ARCADE") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PLATFORM_ROLE, admin);
    }

    // Platform contract call karega — 80% player, 20% creator
    function autoMintReward(
        address player,
        address creator
    ) external onlyRole(PLATFORM_ROLE) {
        uint256 playerAmount = (rewardRate * 80) / 100;
        uint256 creatorAmount = (rewardRate * 20) / 100;

        _mint(player, playerAmount);
        _mint(creator, creatorAmount);

        emit RewardMinted(player, creator, playerAmount, creatorAmount);
    }

    // Direct mint — Platform contract call karega
    function mintTo(
        address recipient,
        uint256 amount
    ) external onlyRole(PLATFORM_ROLE) {
        _mint(recipient, amount);
    }

    // Admin reward rate change kar sakta hai
    function setRewardRate(
        uint256 newRate
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        rewardRate = newRate;
    }

    // Balance check
    function getBalance(address player) external view returns (uint256) {
        return balanceOf(player);
    }
}