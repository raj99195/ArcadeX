// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Tournament
 * @notice Chain-agnostic tournament contract.
 *
 * ERC-20 chains (BOTChain/Somnia):
 *   isNativeToken=false, _rewardToken=ArcadeToken address
 *   → entry fee paid in ARCADE, prizes paid in ARCADE
 *
 * Native token chains (MST):
 *   isNativeToken=true, _rewardToken=address(0)
 *   → entry fee paid in MSTC (msg.value), prizes paid in MSTC
 */
contract Tournament is AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ── Token config ──────────────────────────────────────────────────────────
    IERC20  public rewardToken;
    bool    public isNativeToken;
    string  public rewardTokenSymbol;

    enum TournamentStatus { Upcoming, Active, Ended, Cancelled }

    struct TournamentInfo {
        uint256           id;
        uint256           gameId;
        string            gameName;
        string            gameThumbnail;
        address           creator;
        uint256           entryFee;
        uint256           maxPlayers;
        uint256           startTime;
        uint256           endTime;
        uint256           prizePool;
        TournamentStatus  status;
        address[]         players;
        bool              prizesDistributed;
    }

    struct PlayerScore {
        address player;
        uint256 score;
        bool    submitted;
    }

    mapping(uint256 => TournamentInfo)                      public tournaments;
    mapping(uint256 => mapping(address => PlayerScore))     public playerScores;
    mapping(uint256 => address[])                           public tournamentLeaderboard;
    mapping(address => uint256[])                           public playerTournaments;

    uint256   public nextTournamentId  = 1;
    uint256   public platformFeePercent = 5;
    uint256[] public prizePercents      = [60, 25, 15];
    address   public feeRecipient;

    event TournamentCreated(uint256 indexed id, uint256 gameId, string gameName, address creator);
    event PlayerJoined(uint256 indexed tournamentId, address indexed player, uint256 entryFee);
    event ScoreSubmitted(uint256 indexed tournamentId, address indexed player, uint256 score);
    event PrizesDistributed(uint256 indexed tournamentId, address[3] winners, uint256[3] prizes);
    event TournamentCancelled(uint256 indexed tournamentId);
    event PrizePercentsUpdated(uint256 first, uint256 second, uint256 third);

    constructor(
        address admin,
        address _rewardToken,
        bool    _isNativeToken,
        string  memory _rewardTokenSymbol
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);

        isNativeToken     = _isNativeToken;
        rewardTokenSymbol = _rewardTokenSymbol;
        feeRecipient      = admin;

        if (!_isNativeToken) {
            require(_rewardToken != address(0), "Token address required");
            rewardToken = IERC20(_rewardToken);
        }
    }

    // ── Create tournament ─────────────────────────────────────────────────────
    function createTournament(
        uint256 gameId,
        string  memory gameName,
        string  memory gameThumbnail,
        uint256 entryFee,
        uint256 maxPlayers,
        uint256 startTime,
        uint256 durationInHours
    ) external {
        require(entryFee > 0,                                    "Entry fee required");
        require(maxPlayers >= 2 && maxPlayers <= 100,            "Players: 2-100");
        require(startTime >= block.timestamp,                    "Start time in past");
        require(durationInHours >= 1 && durationInHours <= 168, "Duration: 1-168h");

        uint256 endTime = startTime + (durationInHours * 1 hours);

        tournaments[nextTournamentId] = TournamentInfo({
            id:                nextTournamentId,
            gameId:            gameId,
            gameName:          gameName,
            gameThumbnail:     gameThumbnail,
            creator:           msg.sender,
            entryFee:          entryFee,
            maxPlayers:        maxPlayers,
            startTime:         startTime,
            endTime:           endTime,
            prizePool:         0,
            status:            TournamentStatus.Upcoming,
            players:           new address[](0),
            prizesDistributed: false
        });

        emit TournamentCreated(nextTournamentId, gameId, gameName, msg.sender);
        nextTournamentId++;
    }

    // ── Join tournament ───────────────────────────────────────────────────────
    function joinTournament(uint256 tournamentId) external payable nonReentrant {
        TournamentInfo storage t = tournaments[tournamentId];
        require(t.id != 0,                                                              "Not found");
        require(t.status == TournamentStatus.Upcoming || t.status == TournamentStatus.Active, "Not joinable");
        require(t.players.length < t.maxPlayers,                                        "Full");
        require(!playerScores[tournamentId][msg.sender].submitted,                      "Already joined");
        require(block.timestamp < t.endTime,                                            "Ended");

        if (isNativeToken) {
            require(msg.value >= t.entryFee, "Insufficient MSTC");
            // Refund excess
            if (msg.value > t.entryFee) {
                payable(msg.sender).transfer(msg.value - t.entryFee);
            }
        } else {
            rewardToken.transferFrom(msg.sender, address(this), t.entryFee);
        }

        t.prizePool += t.entryFee;
        t.players.push(msg.sender);

        playerScores[tournamentId][msg.sender] = PlayerScore({
            player:    msg.sender,
            score:     0,
            submitted: true
        });

        playerTournaments[msg.sender].push(tournamentId);

        if (block.timestamp >= t.startTime && t.status == TournamentStatus.Upcoming) {
            t.status = TournamentStatus.Active;
        }

        emit PlayerJoined(tournamentId, msg.sender, t.entryFee);
    }

    // ── Submit score ──────────────────────────────────────────────────────────
    function submitTournamentScore(uint256 tournamentId, uint256 score) external {
        TournamentInfo storage t = tournaments[tournamentId];
        require(t.id != 0,                                                                       "Not found");
        require(t.status != TournamentStatus.Ended && t.status != TournamentStatus.Cancelled,   "Finished");
        require(block.timestamp >= t.startTime && block.timestamp <= t.endTime,                 "Outside time");
        require(playerScores[tournamentId][msg.sender].submitted,                               "Not joined");

        if (score > playerScores[tournamentId][msg.sender].score) {
            playerScores[tournamentId][msg.sender].score = score;
        }

        emit ScoreSubmitted(tournamentId, msg.sender, score);
    }

    // ── End + distribute ──────────────────────────────────────────────────────
    function endTournamentAndDistribute(uint256 tournamentId) external nonReentrant {
        TournamentInfo storage t = tournaments[tournamentId];
        require(t.id != 0,              "Not found");
        require(block.timestamp > t.endTime, "Still running");
        require(!t.prizesDistributed,   "Already distributed");
        require(t.players.length > 0,   "No players");

        t.status            = TournamentStatus.Ended;
        t.prizesDistributed = true;

        address[] memory sorted = _getSortedPlayers(tournamentId);

        uint256 pool            = t.prizePool;
        uint256 platformFee     = (pool * platformFeePercent) / 100;
        uint256 distributable   = pool - platformFee;

        // Send platform fee to fee recipient
        _transfer(feeRecipient, platformFee);

        address[3] memory winners;
        uint256[3] memory prizes;
        uint256 numWinners = sorted.length >= 3 ? 3 : sorted.length;

        for (uint256 i = 0; i < numWinners; i++) {
            uint256 prize = (distributable * prizePercents[i]) / 100;
            _transfer(sorted[i], prize);
            winners[i] = sorted[i];
            prizes[i]  = prize;
        }

        emit PrizesDistributed(tournamentId, winners, prizes);
    }

    // ── Cancel + refund ───────────────────────────────────────────────────────
    function cancelTournament(uint256 tournamentId) external nonReentrant {
        TournamentInfo storage t = tournaments[tournamentId];
        require(t.id != 0,                                                        "Not found");
        require(msg.sender == t.creator || hasRole(ADMIN_ROLE, msg.sender),       "Not authorized");
        require(t.status != TournamentStatus.Ended,                               "Already ended");

        t.status = TournamentStatus.Cancelled;

        for (uint256 i = 0; i < t.players.length; i++) {
            _transfer(t.players[i], t.entryFee);
        }

        emit TournamentCancelled(tournamentId);
    }

    // ── Internal transfer (native or ERC-20) ──────────────────────────────────
    function _transfer(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (isNativeToken) {
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "Native transfer failed");
        } else {
            rewardToken.transfer(to, amount);
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function setPlatformFee(uint256 feePercent) external onlyRole(ADMIN_ROLE) {
        require(feePercent <= 20, "Max 20%");
        platformFeePercent = feePercent;
    }

    function setFeeRecipient(address _recipient) external onlyRole(ADMIN_ROLE) {
        require(_recipient != address(0), "Zero address");
        feeRecipient = _recipient;
    }

    // e.g. setPrizePercents([50, 30, 20]) — must sum to 100. Lets the "top 3
    // get X%" split be admin-configured instead of hardcoded 60/25/15.
    function setPrizePercents(uint256[] memory percents) external onlyRole(ADMIN_ROLE) {
        require(percents.length == 3, "Must provide exactly 3 values");
        require(percents[0] + percents[1] + percents[2] == 100, "Must sum to 100");
        prizePercents = percents;
        emit PrizePercentsUpdated(percents[0], percents[1], percents[2]);
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    function getTournamentPlayers(uint256 tournamentId) external view returns (address[] memory, uint256[] memory) {
        TournamentInfo storage t = tournaments[tournamentId];
        uint256[] memory scores  = new uint256[](t.players.length);
        for (uint256 i = 0; i < t.players.length; i++) {
            scores[i] = playerScores[tournamentId][t.players[i]].score;
        }
        return (t.players, scores);
    }

    function getActiveTournaments() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < nextTournamentId; i++) {
            if (_isActive(i)) count++;
        }
        uint256[] memory result = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i < nextTournamentId; i++) {
            if (_isActive(i)) result[idx++] = i;
        }
        return result;
    }

    function getTournamentInfo(uint256 tournamentId) external view returns (TournamentInfo memory) {
        return tournaments[tournamentId];
    }

    function getPlayerTournaments(address player) external view returns (uint256[] memory) {
        return playerTournaments[player];
    }

    // ── Internal ──────────────────────────────────────────────────────────────
    function _isActive(uint256 id) internal view returns (bool) {
        TournamentStatus s = tournaments[id].status;
        return s == TournamentStatus.Active ||
               (s == TournamentStatus.Upcoming && block.timestamp >= tournaments[id].startTime);
    }

    function _getSortedPlayers(uint256 tournamentId) internal view returns (address[] memory) {
        TournamentInfo storage t = tournaments[tournamentId];
        address[] memory players = t.players;
        uint256 len = players.length;
        for (uint256 i = 0; i < len; i++) {
            for (uint256 j = 0; j < len - i - 1; j++) {
                if (playerScores[tournamentId][players[j]].score <
                    playerScores[tournamentId][players[j + 1]].score) {
                    address temp  = players[j];
                    players[j]    = players[j + 1];
                    players[j + 1] = temp;
                }
            }
        }
        return players;
    }

    receive() external payable {}
}
