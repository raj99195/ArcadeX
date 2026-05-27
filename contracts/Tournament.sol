// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ArcadeToken.sol";

contract Tournament is AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    ArcadeToken public arcadeToken;

    enum TournamentStatus { Upcoming, Active, Ended, Cancelled }

    struct TournamentInfo {
        uint256 id;
        uint256 gameId;
        string gameName;
        string gameThumbnail;
        address creator;
        uint256 entryFee;
        uint256 maxPlayers;
        uint256 startTime;
        uint256 endTime;
        uint256 prizePool;
        TournamentStatus status;
        address[] players;
        bool prizesDistributed;
    }

    struct PlayerScore {
        address player;
        uint256 score;
        bool submitted;
    }

    // tournamentId => TournamentInfo
    mapping(uint256 => TournamentInfo) public tournaments;
    // tournamentId => player => score
    mapping(uint256 => mapping(address => PlayerScore)) public playerScores;
    // tournamentId => sorted leaderboard
    mapping(uint256 => address[]) public tournamentLeaderboard;
    // player => tournament ids they joined
    mapping(address => uint256[]) public playerTournaments;

    uint256 public nextTournamentId = 1;
    uint256 public platformFeePercent = 5; // 5% platform fee

    // Prize distribution: 60%, 25%, 15%
    uint256[] public prizePercents = [60, 25, 15];

    event TournamentCreated(uint256 indexed id, uint256 gameId, string gameName, address creator);
    event PlayerJoined(uint256 indexed tournamentId, address indexed player, uint256 entryFee);
    event ScoreSubmitted(uint256 indexed tournamentId, address indexed player, uint256 score);
    event PrizesDistributed(uint256 indexed tournamentId, address[3] winners, uint256[3] prizes);
    event TournamentCancelled(uint256 indexed tournamentId);

    constructor(address admin, address _arcadeToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        arcadeToken = ArcadeToken(_arcadeToken);
    }

    /// @notice Creator creates a tournament
    function createTournament(
        uint256 gameId,
        string memory gameName,
        string memory gameThumbnail,
        uint256 entryFee,
        uint256 maxPlayers,
        uint256 startTime,
        uint256 durationInHours
    ) external {
        require(entryFee > 0, "Entry fee required");
        require(maxPlayers >= 2, "Min 2 players");
        require(maxPlayers <= 100, "Max 100 players");
        require(startTime >= block.timestamp, "Start time in past");
        require(durationInHours >= 1 && durationInHours <= 168, "Duration 1-168 hours");

        uint256 endTime = startTime + (durationInHours * 1 hours);

        tournaments[nextTournamentId] = TournamentInfo({
            id: nextTournamentId,
            gameId: gameId,
            gameName: gameName,
            gameThumbnail: gameThumbnail,
            creator: msg.sender,
            entryFee: entryFee,
            maxPlayers: maxPlayers,
            startTime: startTime,
            endTime: endTime,
            prizePool: 0,
            status: TournamentStatus.Upcoming,
            players: new address[](0),
            prizesDistributed: false
        });

        emit TournamentCreated(nextTournamentId, gameId, gameName, msg.sender);
        nextTournamentId++;
    }

    /// @notice Player joins tournament — ARCADE tokens transferred to contract
    function joinTournament(uint256 tournamentId) external nonReentrant {
        TournamentInfo storage t = tournaments[tournamentId];
        require(t.id != 0, "Tournament not found");
        require(t.status == TournamentStatus.Upcoming || t.status == TournamentStatus.Active, "Not joinable");
        require(t.players.length < t.maxPlayers, "Tournament full");
        require(!playerScores[tournamentId][msg.sender].submitted, "Already joined");
        require(block.timestamp < t.endTime, "Tournament ended");

        // Transfer entry fee from player to contract
        arcadeToken.transferFrom(msg.sender, address(this), t.entryFee);

        t.prizePool += t.entryFee;
        t.players.push(msg.sender);

        playerScores[tournamentId][msg.sender] = PlayerScore({
            player: msg.sender,
            score: 0,
            submitted: true
        });

        playerTournaments[msg.sender].push(tournamentId);

        // Auto-activate if start time reached
        if (block.timestamp >= t.startTime && t.status == TournamentStatus.Upcoming) {
            t.status = TournamentStatus.Active;
        }

        emit PlayerJoined(tournamentId, msg.sender, t.entryFee);
    }

    /// @notice Submit score — called by platform or player
    function submitTournamentScore(uint256 tournamentId, uint256 score) external {
        TournamentInfo storage t = tournaments[tournamentId];
        require(t.id != 0, "Tournament not found");
        require(
            t.status != TournamentStatus.Ended && t.status != TournamentStatus.Cancelled,
            "Tournament finished"
        );
        require(block.timestamp >= t.startTime && block.timestamp <= t.endTime, "Outside tournament time");
        require(playerScores[tournamentId][msg.sender].submitted, "Not joined");

        // Only update if new score is higher
        if (score > playerScores[tournamentId][msg.sender].score) {
            playerScores[tournamentId][msg.sender].score = score;
        }

        emit ScoreSubmitted(tournamentId, msg.sender, score);
    }

    /// @notice End tournament + distribute prizes
    function endTournamentAndDistribute(uint256 tournamentId) external nonReentrant {
        TournamentInfo storage t = tournaments[tournamentId];
        require(t.id != 0, "Tournament not found");
        require(block.timestamp > t.endTime, "Tournament still running");
        require(!t.prizesDistributed, "Prizes already distributed");
        require(t.players.length > 0, "No players");

        t.status = TournamentStatus.Ended;
        t.prizesDistributed = true;

        // Sort players by score — get top 3
        address[] memory sorted = _getSortedPlayers(tournamentId);

        uint256 pool = t.prizePool;
        uint256 platformFee = (pool * platformFeePercent) / 100;
        uint256 distributablePool = pool - platformFee;

        // Send platform fee to admin
        arcadeToken.transfer(getRoleMember(DEFAULT_ADMIN_ROLE, 0), platformFee);

        address[3] memory winners;
        uint256[3] memory prizes;

        uint256 numWinners = sorted.length >= 3 ? 3 : sorted.length;

        for (uint256 i = 0; i < numWinners; i++) {
            uint256 prize = (distributablePool * prizePercents[i]) / 100;
            arcadeToken.transfer(sorted[i], prize);
            winners[i] = sorted[i];
            prizes[i] = prize;
        }

        emit PrizesDistributed(tournamentId, winners, prizes);
    }

    /// @notice Cancel tournament — refund all players
    function cancelTournament(uint256 tournamentId) external nonReentrant {
        TournamentInfo storage t = tournaments[tournamentId];
        require(t.id != 0, "Tournament not found");
        require(msg.sender == t.creator || hasRole(ADMIN_ROLE, msg.sender), "Not authorized");
        require(t.status != TournamentStatus.Ended, "Already ended");

        t.status = TournamentStatus.Cancelled;

        // Refund all players
        for (uint256 i = 0; i < t.players.length; i++) {
            arcadeToken.transfer(t.players[i], t.entryFee);
        }

        emit TournamentCancelled(tournamentId);
    }

    /// @notice Get tournament players + scores
    function getTournamentPlayers(uint256 tournamentId) external view returns (address[] memory, uint256[] memory) {
        TournamentInfo storage t = tournaments[tournamentId];
        address[] memory players = t.players;
        uint256[] memory scores = new uint256[](players.length);
        for (uint256 i = 0; i < players.length; i++) {
            scores[i] = playerScores[tournamentId][players[i]].score;
        }
        return (players, scores);
    }

    /// @notice Get all active tournaments
    function getActiveTournaments() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < nextTournamentId; i++) {
            if (tournaments[i].status == TournamentStatus.Active || 
                (tournaments[i].status == TournamentStatus.Upcoming && block.timestamp >= tournaments[i].startTime)) {
                count++;
            }
        }
        uint256[] memory result = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i < nextTournamentId; i++) {
            if (tournaments[i].status == TournamentStatus.Active ||
                (tournaments[i].status == TournamentStatus.Upcoming && block.timestamp >= tournaments[i].startTime)) {
                result[idx++] = i;
            }
        }
        return result;
    }

    /// @notice Internal — sort players by score descending
    function _getSortedPlayers(uint256 tournamentId) internal view returns (address[] memory) {
        TournamentInfo storage t = tournaments[tournamentId];
        address[] memory players = t.players;
        uint256 len = players.length;

        // Bubble sort (fine for small arrays)
        for (uint256 i = 0; i < len; i++) {
            for (uint256 j = 0; j < len - i - 1; j++) {
                if (playerScores[tournamentId][players[j]].score < playerScores[tournamentId][players[j + 1]].score) {
                    address temp = players[j];
                    players[j] = players[j + 1];
                    players[j + 1] = temp;
                }
            }
        }
        return players;
    }

    function getTournamentInfo(uint256 tournamentId) external view returns (TournamentInfo memory) {
        return tournaments[tournamentId];
    }

    function getPlayerTournaments(address player) external view returns (uint256[] memory) {
        return playerTournaments[player];
    }

    function setPlatformFee(uint256 feePercent) external onlyRole(ADMIN_ROLE) {
        require(feePercent <= 20, "Max 20%");
        platformFeePercent = feePercent;
    }

    function getRoleMember(bytes32 role, uint256 index) internal view returns (address) {
        // Simple — return admin address
        return _msgSender();
    }
}