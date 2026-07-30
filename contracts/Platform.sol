// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./ArcadeToken.sol";
import "./Leaderboard.sol";

/**
 * @title Platform
 * @notice Chain-agnostic game platform.
 *
 * ERC-20 chains (BOTChain/Somnia):
 *   isNativeToken=false, _arcadeToken=ArcadeToken address, rewardPool=address(0)
 *   → mintTo() player and creator
 *
 * Native token chains (MST):
 *   isNativeToken=true, _arcadeToken=address(0), rewardPool=funded wallet
 *   → transfer native token held by THIS CONTRACT to player and creator
 *   → Fund the contract itself (send native token to its address) before
 *     rewards can be paid — see note on rewardPool below.
 *
 * Admin-configurable "fair play" controls (all optional — off/unrestricted
 * by default so existing chains behave exactly as before until an admin
 * turns them on):
 *   - Reward split (player% / creator%) — was hardcoded 80/20
 *   - Per-player daily earning cap
 *   - Chain-wide daily payout cap (protects the whole reward pool)
 *   - Configurable reset period (not hardcoded to exactly 24h)
 *   - Per-game minimum score requirement
 *   - Minimum seconds between plays per player (basic bot/spam throttle)
 *   - Backend-signed score proof — recordPlayAndEarn() requires a
 *     signature from a trusted "scoreSigner" address, so a score can't be
 *     submitted by calling the contract directly (bypassing the game).
 *   - Emergency pause switch
 *   - Admin withdrawal from the contract's own held balance
 */
contract Platform is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ── Token config ──────────────────────────────────────────────────────────
    ArcadeToken public arcadeToken;
    bool        public isNativeToken;
    address     public rewardPool;       // kept for reference/back-compat; the
                                          // actual balance check is against
                                          // address(this), see note in
                                          // recordPlayAndEarn().
    string      public rewardTokenSymbol;

    // ── Reward rate limits (set at deploy, updatable by admin) ────────────────
    uint256 public minRewardRate;
    uint256 public maxRewardRate;

    // ── Reward split — replaces the old hardcoded 80/20 ────────────────────────
    uint256 public playerSharePercent  = 80;
    uint256 public creatorSharePercent = 20;

    // ── Fair-play caps (all 0 = disabled, matches old unrestricted behavior) ──
    uint256 public playerDailyCap;   // in wei — e.g. 5 MSTC = 5e18
    uint256 public chainDailyCap;    // in wei — total payout cap across ALL players
    uint256 public capResetPeriod = 1 days; // admin can widen to e.g. 2 days

    mapping(address => uint256) public playerCapWindowStart;
    mapping(address => uint256) public playerEarnedInWindow; // wei, resets each window
    uint256 public chainCapWindowStart;
    uint256 public chainEarnedInWindow; // wei, resets each window

    // ── Per-game minimum score requirement (0 = no minimum) ────────────────────
    mapping(uint256 => uint256) public gameMinScore;

    // ── Basic anti-bot throttle (0 = disabled) ─────────────────────────────────
    uint256 public minSecondsBetweenPlays;
    mapping(address => uint256) public lastPlayTimestamp;

    // ── Backend-signed score proof (address(0) = disabled — anyone can call
    // recordPlayAndEarn() directly, matching the old behavior) ────────────────
    // The signer is a backend wallet ONLY used to sign score attestations —
    // it should NOT be the same key as any ADMIN_ROLE wallet, since its key
    // effectively lives in server.js and is a different trust boundary.
    address public scoreSigner;
    mapping(bytes32 => bool) public usedScoreProofs;

    // ── Emergency pause ─────────────────────────────────────────────────────────
    bool public paused;

    Leaderboard public leaderboard;

    struct Game {
        uint256 gameId;
        string  name;
        address creator;
        string  iframeUrl;
        uint256 rewardRate;
        uint256 totalPlays;
        bool    isActive;
    }

    struct CreatorProfile {
        address creator;
        uint256 totalEarned;
        uint256 gamesPublished;
        bool    isVerified;
    }

    mapping(uint256 => Game)           public games;
    mapping(address => CreatorProfile) public creators;

    uint256 public nextGameId    = 1;
    uint256 public totalRevenue;

    event GameRegistered(uint256 indexed gameId, address indexed creator, string name);
    event GameApproved(uint256 indexed gameId);
    event PlayRecorded(address indexed player, uint256 indexed gameId, uint256 playerReward, uint256 creatorReward);
    event RewardRateLimitsUpdated(uint256 minRate, uint256 maxRate);
    event RewardPoolUpdated(address newPool);
    event GameRewardRateUpdated(uint256 indexed gameId, uint256 oldRate, uint256 newRate);
    event RewardSplitUpdated(uint256 playerPercent, uint256 creatorPercent);
    event PlayerDailyCapUpdated(uint256 cap);
    event ChainDailyCapUpdated(uint256 cap);
    event CapResetPeriodUpdated(uint256 seconds_);
    event GameMinScoreUpdated(uint256 indexed gameId, uint256 minScore);
    event MinSecondsBetweenPlaysUpdated(uint256 seconds_);
    event ScoreSignerUpdated(address newSigner);
    event PausedStatusUpdated(bool isPaused);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(
        address admin,
        address _arcadeToken,
        address _leaderboard,
        bool    _isNativeToken,
        address _rewardPool,
        string  memory _rewardTokenSymbol,
        uint256 _minRewardRate,
        uint256 _maxRewardRate
    ) {
        require(_minRewardRate <= _maxRewardRate, "min > max");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);

        isNativeToken     = _isNativeToken;
        rewardPool        = _rewardPool;
        rewardTokenSymbol = _rewardTokenSymbol;
        minRewardRate     = _minRewardRate;
        maxRewardRate     = _maxRewardRate;
        leaderboard       = Leaderboard(_leaderboard);

        if (!_isNativeToken) {
            require(_arcadeToken != address(0), "ArcadeToken address required");
            arcadeToken = ArcadeToken(_arcadeToken);
        }
    }

    // ── Creator ───────────────────────────────────────────────────────────────
    function initCreator(address creator) external {
        require(creators[creator].creator == address(0), "Already registered");
        creators[creator] = CreatorProfile({
            creator:        creator,
            totalEarned:    0,
            gamesPublished: 0,
            isVerified:     false
        });
    }

    // ── Game registration ─────────────────────────────────────────────────────
    function registerGame(
        string memory name,
        string memory iframeUrl,
        uint256 rewardRate
    ) external {
        require(creators[msg.sender].creator != address(0), "Not a creator");
        _validateRewardRate(rewardRate);

        games[nextGameId] = Game({
            gameId:     nextGameId,
            name:       name,
            creator:    msg.sender,
            iframeUrl:  iframeUrl,
            rewardRate: rewardRate,
            totalPlays: 0,
            isActive:   false
        });

        emit GameRegistered(nextGameId, msg.sender, name);
        nextGameId++;
    }

    function approveGame(uint256 gameId) external onlyRole(ADMIN_ROLE) {
        require(games[gameId].gameId != 0, "Game not found");
        games[gameId].isActive = true;
        creators[games[gameId].creator].gamesPublished++;
        emit GameApproved(gameId);
    }

    function adminRegisterAndApprove(
        uint256 specificGameId,
        address creator,
        string  memory name,
        string  memory iframeUrl,
        uint256 rewardRate
    ) external onlyRole(ADMIN_ROLE) {
        require(games[specificGameId].gameId == 0, "GameId already taken");

        if (creators[creator].creator == address(0)) {
            creators[creator] = CreatorProfile({
                creator:        creator,
                totalEarned:    0,
                gamesPublished: 0,
                isVerified:     false
            });
        }

        games[specificGameId] = Game({
            gameId:     specificGameId,
            name:       name,
            creator:    creator,
            iframeUrl:  iframeUrl,
            rewardRate: rewardRate,
            totalPlays: 0,
            isActive:   true
        });

        creators[creator].gamesPublished++;

        if (specificGameId >= nextGameId) {
            nextGameId = specificGameId + 1;
        }

        emit GameRegistered(specificGameId, creator, name);
        emit GameApproved(specificGameId);
    }

    // ── Core: record play + distribute rewards ────────────────────────────────
    // nonce: any value unique per score-submission (backend generates it).
    // signature: backend's signature over
    //   keccak256(player, gameId, score, nonce, address(this), block.chainid)
    // — proves this specific (player, gameId, score) tuple was approved by
    // the backend, and can't be replayed (nonce+signature marked used) or
    // reused on a different chain/contract (address(this)+chainid bound in).
    //
    // If scoreSigner is unset (address(0)), signature/nonce are ignored —
    // this keeps existing chains that haven't configured a signer working
    // exactly as before.
    function recordPlayAndEarn(
        uint256 gameId,
        uint256 score,
        uint256 nonce,
        bytes memory signature
    ) external nonReentrant {
        require(!paused, "Platform paused");
        require(games[gameId].isActive, "Game not active");
        require(score >= gameMinScore[gameId], "Score below minimum required");

        address player  = msg.sender;
        address creator = games[gameId].creator;

        // ── Backend-signed score proof ──
        if (scoreSigner != address(0)) {
            bytes32 messageHash = keccak256(
                abi.encodePacked(player, gameId, score, nonce, address(this), block.chainid)
            );
            bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
            require(!usedScoreProofs[ethSignedHash], "Score proof already used");
            require(ECDSA.recover(ethSignedHash, signature) == scoreSigner, "Invalid score proof");
            usedScoreProofs[ethSignedHash] = true;
        }

        // ── Anti-bot throttle ──
        if (minSecondsBetweenPlays > 0) {
            require(
                block.timestamp >= lastPlayTimestamp[player] + minSecondsBetweenPlays,
                "Playing too fast"
            );
        }
        lastPlayTimestamp[player] = block.timestamp;

        // rewardRate is now stored in wei directly (e.g. 0.5 MSTC = 5e17).
        // Previously was whole-token units multiplied here by 1e18.
        uint256 rate          = games[gameId].rewardRate;
        uint256 playerReward  = (rate * playerSharePercent) / 100;
        uint256 creatorReward = (rate * creatorSharePercent) / 100;

        // ── Per-player daily cap ──
        if (playerDailyCap > 0) {
            _refreshPlayerWindow(player);
            // playerDailyCap is now stored in wei
            require(playerEarnedInWindow[player] + playerReward <= playerDailyCap, "Daily player cap reached");
            playerEarnedInWindow[player] += playerReward;
        }

        // ── Chain-wide daily payout cap ──
        if (chainDailyCap > 0) {
            _refreshChainWindow();
            // chainDailyCap is now stored in wei
            require(chainEarnedInWindow + playerReward + creatorReward <= chainDailyCap, "Daily chain cap reached");
            chainEarnedInWindow += playerReward + creatorReward;
        }

        if (isNativeToken) {
            // Native token chain (MST) — pay from THIS CONTRACT's own
            // balance. NOTE: previously this checked rewardPool.balance
            // (an external wallet) while actually paying from
            // address(this) — two different addresses, which meant both
            // had to be separately funded. Now it checks the address that
            // actually pays.
            require(address(this).balance >= rate, "Pool insufficient - fund this contract");
            if (playerReward > 0) {
                (bool p,) = payable(player).call{value: playerReward}("");
                require(p, "Player transfer failed");
            }
            if (creatorReward > 0) {
                (bool c,) = payable(creator).call{value: creatorReward}("");
                require(c, "Creator transfer failed");
            }
        } else {
            // ERC-20 chain (BOTChain/Somnia) — mint ARCADE
            if (playerReward > 0)  arcadeToken.mintTo(player,  playerReward);
            if (creatorReward > 0) arcadeToken.mintTo(creator, creatorReward);
        }

        leaderboard.submitScore(player, gameId, score);

        games[gameId].totalPlays++;
        creators[creator].totalEarned += creatorReward;
        totalRevenue += rate;

        emit PlayRecorded(player, gameId, playerReward, creatorReward);
    }

    function _refreshPlayerWindow(address player) internal {
        if (block.timestamp >= playerCapWindowStart[player] + capResetPeriod) {
            playerCapWindowStart[player] = block.timestamp;
            playerEarnedInWindow[player] = 0;
        }
    }

    function _refreshChainWindow() internal {
        if (block.timestamp >= chainCapWindowStart + capResetPeriod) {
            chainCapWindowStart = block.timestamp;
            chainEarnedInWindow = 0;
        }
    }

    // ── Admin config ──────────────────────────────────────────────────────────
    function setRewardRateLimits(uint256 _min, uint256 _max) external onlyRole(ADMIN_ROLE) {
        require(_min <= _max, "min > max");
        minRewardRate = _min;
        maxRewardRate = _max;
        emit RewardRateLimitsUpdated(_min, _max);
    }

    // Kept for backward compatibility / informational purposes — no longer
    // used in the actual balance check (see recordPlayAndEarn), which now
    // checks address(this).balance directly.
    function setRewardPool(address _pool) external onlyRole(ADMIN_ROLE) {
        rewardPool = _pool;
        emit RewardPoolUpdated(_pool);
    }

    // Fix an already-registered game's rewardRate — needed because
    // adminRegisterAndApprove() doesn't validate rate on the way in, so a
    // game can end up registered outside minRewardRate/maxRewardRate.
    // Still enforces the SAME range check registerGame() uses, so this
    // can't be used to push a game's rate out of bounds either.
    function updateGameRewardRate(uint256 gameId, uint256 newRate) external onlyRole(ADMIN_ROLE) {
        require(games[gameId].gameId != 0, "Game not found");
        _validateRewardRate(newRate);
        uint256 oldRate = games[gameId].rewardRate;
        games[gameId].rewardRate = newRate;
        emit GameRewardRateUpdated(gameId, oldRate, newRate);
    }

    // e.g. setRewardSplit(90, 10) or setRewardSplit(100, 0) for a pure
    // play-to-earn model with zero creator fee.
    function setRewardSplit(uint256 _playerPercent, uint256 _creatorPercent) external onlyRole(ADMIN_ROLE) {
        require(_playerPercent + _creatorPercent == 100, "Must sum to 100");
        playerSharePercent  = _playerPercent;
        creatorSharePercent = _creatorPercent;
        emit RewardSplitUpdated(_playerPercent, _creatorPercent);
    }

    // Max a single player can earn per reset period, in whole tokens. 0 disables the cap.
    function setPlayerDailyCap(uint256 _cap) external onlyRole(ADMIN_ROLE) {
        playerDailyCap = _cap;
        emit PlayerDailyCapUpdated(_cap);
    }

    // Max total payout (all players combined) per reset period, in whole tokens. 0 disables the cap.
    function setChainDailyCap(uint256 _cap) external onlyRole(ADMIN_ROLE) {
        chainDailyCap = _cap;
        emit ChainDailyCapUpdated(_cap);
    }

    // How long a "day" is for cap purposes — default 1 days, can widen to
    // e.g. 2 days if the admin wants a longer reset window.
    function setCapResetPeriod(uint256 _seconds) external onlyRole(ADMIN_ROLE) {
        require(_seconds >= 1 hours, "Too short");
        capResetPeriod = _seconds;
        emit CapResetPeriodUpdated(_seconds);
    }

    function setGameMinScore(uint256 gameId, uint256 minScore) external onlyRole(ADMIN_ROLE) {
        require(games[gameId].gameId != 0, "Game not found");
        gameMinScore[gameId] = minScore;
        emit GameMinScoreUpdated(gameId, minScore);
    }

    // Basic bot/spam throttle — minimum seconds a player must wait between
    // successful recordPlayAndEarn() calls. 0 disables it.
    function setMinSecondsBetweenPlays(uint256 _seconds) external onlyRole(ADMIN_ROLE) {
        minSecondsBetweenPlays = _seconds;
        emit MinSecondsBetweenPlaysUpdated(_seconds);
    }

    // Set to address(0) to disable score-signature verification entirely
    // (anyone can call recordPlayAndEarn() directly again, old behavior).
    function setScoreSigner(address _signer) external onlyRole(ADMIN_ROLE) {
        scoreSigner = _signer;
        emit ScoreSignerUpdated(_signer);
    }

    function setPaused(bool _paused) external onlyRole(ADMIN_ROLE) {
        paused = _paused;
        emit PausedStatusUpdated(_paused);
    }

    // Admin can withdraw native tokens held by this contract — e.g. to
    // recover excess funding, or migrate balance to a new contract version.
    // Only relevant on native-token chains; on ERC-20 chains this contract
    // shouldn't hold a meaningful native balance anyway.
    function withdraw(address payable to, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(to != address(0), "Zero address");
        require(amount <= address(this).balance, "Insufficient balance");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(to, amount);
    }

    // Fund the reward pool (MST chain) — send native tokens directly to
    // this contract's address. It holds them and pays out on each play.
    receive() external payable {}

    // ── Views ─────────────────────────────────────────────────────────────────
    function getCreatorStats(address creator) external view returns (uint256, uint256, bool) {
        CreatorProfile memory p = creators[creator];
        return (p.totalEarned, p.gamesPublished, p.isVerified);
    }

    function getTotalGames() external view returns (uint256) { return nextGameId - 1; }

    function getGame(uint256 gameId) external view returns (Game memory) { return games[gameId]; }

    // Returns (earnedInWindow, windowStart, cap, windowElapsed). earnedInWindow
    // reflects on-chain state — if windowElapsed is true, treat it as
    // effectively 0 already used (it only actually resets on that player's
    // next recordPlayAndEarn() call).
    function getPlayerCapStatus(address player) external view returns (uint256 earnedInWindow, uint256 windowStart, uint256 cap, bool windowElapsed) {
        uint256 start = playerCapWindowStart[player];
        bool elapsed = block.timestamp >= start + capResetPeriod;
        return (playerEarnedInWindow[player], start, playerDailyCap, elapsed);
    }

    function getChainCapStatus() external view returns (uint256 earnedInWindow, uint256 windowStart, uint256 cap, bool windowElapsed) {
        bool elapsed = block.timestamp >= chainCapWindowStart + capResetPeriod;
        return (chainEarnedInWindow, chainCapWindowStart, chainDailyCap, elapsed);
    }

    // ── Internal ──────────────────────────────────────────────────────────────
    function _validateRewardRate(uint256 rate) internal view {
        require(rate >= minRewardRate, "Below min reward rate");
        require(rate <= maxRewardRate, "Exceeds max reward rate");
    }
}
