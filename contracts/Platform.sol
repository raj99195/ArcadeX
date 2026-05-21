// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./ArcadeToken.sol";
import "./Leaderboard.sol";

contract Platform is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    ArcadeToken public arcadeToken;
    Leaderboard public leaderboard;

    struct Game {
        uint256 gameId;
        string name;
        address creator;
        string iframeUrl;
        uint256 rewardRate;
        uint256 totalPlays;
        bool isActive;
    }

    struct CreatorProfile {
        address creator;
        uint256 totalEarned;
        uint256 gamesPublished;
        bool isVerified;
    }

    mapping(uint256 => Game) public games;
    mapping(address => CreatorProfile) public creators;
    uint256 public nextGameId = 1;
    uint256 public totalRevenue;

    event GameRegistered(uint256 indexed gameId, address indexed creator, string name);
    event GameApproved(uint256 indexed gameId);
    event PlayRecorded(
        address indexed player,
        uint256 indexed gameId,
        uint256 playerReward,
        uint256 creatorReward
    );

    constructor(address admin, address _arcadeToken, address _leaderboard) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        arcadeToken = ArcadeToken(_arcadeToken);
        leaderboard = Leaderboard(_leaderboard);
    }

    // Creator register
    function initCreator(address creator) external {
        require(creators[creator].creator == address(0), "Already registered");
        creators[creator] = CreatorProfile({
            creator: creator,
            totalEarned: 0,
            gamesPublished: 0,
            isVerified: false
        });
    }

    // Creator game register kare
    function registerGame(
        string memory name,
        string memory iframeUrl,
        uint256 rewardRate
    ) external {
        require(creators[msg.sender].creator != address(0), "Not a creator");

        games[nextGameId] = Game({
            gameId: nextGameId,
            name: name,
            creator: msg.sender,
            iframeUrl: iframeUrl,
            rewardRate: rewardRate,
            totalPlays: 0,
            isActive: false
        });

        emit GameRegistered(nextGameId, msg.sender, name);
        nextGameId++;
    }

    // Admin approve kare
    function approveGame(uint256 gameId) external onlyRole(ADMIN_ROLE) {
        require(games[gameId].gameId != 0, "Game not found");
        games[gameId].isActive = true;
        creators[games[gameId].creator].gamesPublished++;
        emit GameApproved(gameId);
    }

    // Admin directly game register + approve kare — specific gameId ke saath
    // Existing games ko migrate karne ke liye
    function adminRegisterAndApprove(
        uint256 specificGameId,
        address creator,
        string memory name,
        string memory iframeUrl,
        uint256 rewardRate
    ) external onlyRole(ADMIN_ROLE) {
        require(games[specificGameId].gameId == 0, "GameId already taken");

        // Creator auto-register if not exists
        if (creators[creator].creator == address(0)) {
            creators[creator] = CreatorProfile({
                creator: creator,
                totalEarned: 0,
                gamesPublished: 0,
                isVerified: false
            });
        }

        games[specificGameId] = Game({
            gameId: specificGameId,
            name: name,
            creator: creator,
            iframeUrl: iframeUrl,
            rewardRate: rewardRate,
            totalPlays: 0,
            isActive: true  // directly active
        });

        creators[creator].gamesPublished++;

        // nextGameId update karo agar specificGameId >= nextGameId
        if (specificGameId >= nextGameId) {
            nextGameId = specificGameId + 1;
        }

        emit GameRegistered(specificGameId, creator, name);
        emit GameApproved(specificGameId);
    }

    // Player directly call kare — 80% player, 20% creator
    function recordPlayAndEarn(
        uint256 gameId,
        uint256 score
    ) external {
        require(games[gameId].isActive, "Game not active");

        address player = msg.sender;
        address creator = games[gameId].creator;

        // Use game's own rewardRate (set at registration), NOT token's global rate
        // rewardRate stored as plain units (e.g. 90 = 90 ARCADE total)
        // Convert to 18 decimals for minting
        uint256 rate = games[gameId].rewardRate * 10 ** 18;
        uint256 playerReward = (rate * 80) / 100;
        uint256 creatorReward = (rate * 20) / 100;

        // Mint 80% to player
        arcadeToken.mintTo(player, playerReward);
        // Mint 20% to creator
        arcadeToken.mintTo(creator, creatorReward);

        // Submit score to leaderboard
        leaderboard.submitScore(player, gameId, score);

        // Update stats
        games[gameId].totalPlays++;
        creators[creator].totalEarned += creatorReward;
        totalRevenue += rate;

        emit PlayRecorded(player, gameId, playerReward, creatorReward);
    }

    // get_creator_stats
    function getCreatorStats(address creator)
        external
        view
        returns (
            uint256 totalEarned,
            uint256 gamesPublished,
            bool isVerified
        )
    {
        CreatorProfile memory profile = creators[creator];
        return (profile.totalEarned, profile.gamesPublished, profile.isVerified);
    }

    // get_total_games
    function getTotalGames() external view returns (uint256) {
        return nextGameId - 1;
    }

    // get single game
    function getGame(uint256 gameId) external view returns (Game memory) {
        return games[gameId];
    }
}