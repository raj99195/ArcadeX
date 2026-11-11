// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./ArcadeToken.sol";

contract MSTArcadeFallback is AccessControl {
    ArcadeToken public immutable arcadeToken;
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    mapping(bytes32 => bool) public claimed;
    mapping(address => uint256) public lastClaimAt;
    mapping(address => mapping(uint256 => uint256)) public playerDailyMinted;
    mapping(uint256 => uint256) public dailyMinted;
    uint256 public constant PLAYER_DAILY_LIMIT = 10 ether;
    uint256 public constant DAILY_LIMIT = 1000 ether;
    uint256 public constant COOLDOWN = 10 seconds;

    event FallbackClaimed(
        bytes32 indexed playId,
        address indexed player,
        uint256 indexed gameId,
        uint256 playerReward,
        uint256 creatorReward
    );

    constructor(address admin, address signer, ArcadeToken token) {
        require(admin != address(0) && signer != address(0), "Missing role address");
        require(address(token).code.length != 0, "Missing token contract");
        arcadeToken = token;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SIGNER_ROLE, signer);
    }

    function claim(
        bytes32 playId,
        uint256 gameId,
        address creator,
        uint256 playerReward,
        uint256 creatorReward,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(block.timestamp <= deadline, "Claim expired");
        require(!claimed[playId], "Play already claimed");
        bytes32 digest = keccak256(abi.encode(
            address(this), block.chainid, playId, msg.sender, gameId,
            creator, playerReward, creatorReward, deadline
        ));
        require(hasRole(SIGNER_ROLE, ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(digest), signature
        )), "Invalid claim proof");
        uint256 day = block.timestamp / 1 days;
        require(block.timestamp >= lastClaimAt[msg.sender] + COOLDOWN, "Claim cooldown");
        require(playerDailyMinted[msg.sender][day] + playerReward <= PLAYER_DAILY_LIMIT, "Player daily limit");
        require(dailyMinted[day] + playerReward + creatorReward <= DAILY_LIMIT, "Daily mint limit");
        claimed[playId] = true;
        lastClaimAt[msg.sender] = block.timestamp;
        playerDailyMinted[msg.sender][day] += playerReward;
        dailyMinted[day] += playerReward + creatorReward;
        if (playerReward != 0) arcadeToken.mintTo(msg.sender, playerReward);
        if (creatorReward != 0) arcadeToken.mintTo(creator, creatorReward);
        emit FallbackClaimed(playId, msg.sender, gameId, playerReward, creatorReward);
    }
}
