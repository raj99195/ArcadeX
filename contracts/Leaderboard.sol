// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract Leaderboard is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    struct ScoreEntry {
        address player;
        uint256 score;
        uint256 timestamp;
    }

    struct PlayerStats {
        uint256 totalScore;
        uint256 gamesPlayed;
        uint256 bestScore;
        uint256 lastGameId;
    }

    mapping(uint256 => ScoreEntry[]) public gameScores;
    mapping(address => PlayerStats) public playerStats;

    uint256 public maxEntriesPerGame = 500;

    event ScoreSubmitted(
        address indexed player,
        uint256 indexed gameId,
        uint256 score,
        uint256 timestamp
    );

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // Platform contract call karega
    function submitScore(
        address player,
        uint256 gameId,
        uint256 score
    ) external onlyRole(OPERATOR_ROLE) {
        if (gameScores[gameId].length < maxEntriesPerGame) {
            gameScores[gameId].push(ScoreEntry({
                player: player,
                score: score,
                timestamp: block.timestamp
            }));
        }

        PlayerStats storage stats = playerStats[player];
        stats.totalScore += score;
        stats.gamesPlayed += 1;
        stats.lastGameId = gameId;
        if (score > stats.bestScore) {
            stats.bestScore = score;
        }

        emit ScoreSubmitted(player, gameId, score, block.timestamp);
    }

    // get_player_stats
    function getPlayerStats(address player)
        external
        view
        returns (
            uint256 totalScore,
            uint256 gamesPlayed,
            uint256 bestScore,
            uint256 lastGameId
        )
    {
        PlayerStats memory stats = playerStats[player];
        return (
            stats.totalScore,
            stats.gamesPlayed,
            stats.bestScore,
            stats.lastGameId
        );
    }

    // get scores by game
    function getGameScores(uint256 gameId)
        external
        view
        returns (ScoreEntry[] memory)
    {
        return gameScores[gameId];
    }
}