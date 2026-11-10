// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./ArcadeToken.sol";

/**
 * @title BattleArena
 * @notice Chain-agnostic 5-round battle claim contract. Player earns
 *         dollars across 5 rounds off-chain (recorded by backend);
 *         backend signs a claim proof; player submits it here to mint
 *         ARCADE token on their current chain.
 *
 * ── DEPLOYMENT ──
 * Deploy one instance per chain (BOTChain, MST, ...). After deploy,
 * admin MUST grant PLATFORM_ROLE on THAT chain's ArcadeToken to this
 * contract, otherwise mintTo() will revert.
 *
 *   arcadeToken.grantRole(arcadeToken.PLATFORM_ROLE(), address(battleArena));
 *
 * ── TRUST MODEL (identical to Platform.sol sign-score) ──
 *   • Backend "claimSigner" wallet signs each claim payload off-chain.
 *   • Player submits tx with signature — contract verifies via
 *     ECDSA.recover(). Signature binds address(this) + block.chainid
 *     → cross-chain / cross-contract replay-safe.
 *   • claimedSessions[sessionId] → one claim per session (semantic
 *     replay guard on top of the ECDSA hash uniqueness).
 *
 * ── SAFETY CAPS (all optional, 0 = disabled) ──
 *   • maxDollarsPerSession — hard ceiling on any single claim
 *   • dailyClaimCapPerWallet — anti-farming (in ARCADE wei)
 *   • dailyClaimCapTotal — protects mint pressure on the token
 *   • paused — emergency stop
 */
contract BattleArena is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    ArcadeToken public arcadeToken;

    // Backend signer — SAME key as Platform.sol scoreSigner (reuses
    // SCORE_SIGNER_PRIVATE_KEY in Vercel env). address(0) = signature
    // check disabled (dev-only; NEVER leave unset in prod).
    address public claimSigner;

    // 1 dollar → this many ARCADE wei. Default 1e18 = 1:1 ratio.
    // Admin-settable so economics can be tweaked without redeploy.
    uint256 public dollarToArcadeRate = 1e18;

    // Anti-farming caps (0 = disabled)
    uint256 public maxDollarsPerSession = 100;        // max $100/session
    uint256 public dailyClaimCapPerWallet;             // ARCADE wei
    uint256 public dailyClaimCapTotal;                 // ARCADE wei

    // Cap reset window — admin can widen if daily is too tight
    uint256 public capResetPeriod = 1 days;

    // Emergency stop
    bool public paused;

    // Replay: one claim per session
    mapping(bytes32 => bool) public claimedSessions;

    // Per-wallet rolling window
    mapping(address => uint256) public walletCapWindowStart;
    mapping(address => uint256) public walletClaimedInWindow;

    // Global rolling window
    uint256 public totalCapWindowStart;
    uint256 public totalClaimedInWindow;

    // ── Events ──────────────────────────────────────────────────────────
    event ClaimSubmitted(
        address indexed player,
        bytes32 indexed sessionId,
        uint256 dollars,
        uint256 arcadeAmount
    );
    event ClaimSignerUpdated(address newSigner);
    event DollarToArcadeRateUpdated(uint256 newRate);
    event MaxDollarsPerSessionUpdated(uint256 newMax);
    event DailyClaimCapPerWalletUpdated(uint256 newCap);
    event DailyClaimCapTotalUpdated(uint256 newCap);
    event CapResetPeriodUpdated(uint256 newPeriod);
    event PausedStatusUpdated(bool isPaused);
    event ArcadeTokenUpdated(address newToken);

    constructor(
        address admin,
        address _arcadeToken,
        address _claimSigner
    ) {
        require(admin        != address(0), "admin=0");
        require(_arcadeToken != address(0), "arcadeToken=0");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE,         admin);

        arcadeToken = ArcadeToken(_arcadeToken);
        claimSigner = _claimSigner; // can be address(0) initially, set later
    }

    // ── Core: claim ─────────────────────────────────────────────────────
    /**
     * @notice Claim ARCADE reward for a completed battle session.
     * @param sessionId  Unique session id (backend-generated, bytes32).
     * @param dollars    Total dollars earned across all 5 rounds.
     * @param signature  ECDSA signature over
     *                   keccak256(msg.sender, sessionId, dollars, address(this), block.chainid)
     *                   wrapped via EIP-191 (toEthSignedMessageHash), so it
     *                   matches signerWallet.signMessage() output from ethers.
     */
    function claim(
        bytes32 sessionId,
        uint256 dollars,
        bytes calldata signature
    ) external nonReentrant {
        require(!paused,                          "Platform paused");
        require(dollars > 0,                      "dollars=0");
        require(!claimedSessions[sessionId],      "Session already claimed");
        if (maxDollarsPerSession > 0) {
            require(dollars <= maxDollarsPerSession, "Exceeds per-session cap");
        }

        // ── ECDSA claim proof ──
        require(claimSigner != address(0), "Claim signer not configured");
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                msg.sender,
                sessionId,
                dollars,
                address(this),
                block.chainid
            )
        );
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(messageHash);
        require(
            ECDSA.recover(ethSignedHash, signature) == claimSigner,
            "Invalid claim proof"
        );

        // Mark BEFORE mint (CEI + nonReentrant belt/suspenders)
        claimedSessions[sessionId] = true;

        uint256 arcadeAmount = dollars * dollarToArcadeRate;

        // ── Per-wallet daily cap ──
        if (dailyClaimCapPerWallet > 0) {
            _refreshWalletWindow(msg.sender);
            require(
                walletClaimedInWindow[msg.sender] + arcadeAmount <= dailyClaimCapPerWallet,
                "Daily wallet cap reached"
            );
            walletClaimedInWindow[msg.sender] += arcadeAmount;
        }

        // ── Global daily cap ──
        if (dailyClaimCapTotal > 0) {
            _refreshTotalWindow();
            require(
                totalClaimedInWindow + arcadeAmount <= dailyClaimCapTotal,
                "Daily total cap reached"
            );
            totalClaimedInWindow += arcadeAmount;
        }

        // ── Mint via ArcadeToken.mintTo (needs PLATFORM_ROLE) ──
        arcadeToken.mintTo(msg.sender, arcadeAmount);

        emit ClaimSubmitted(msg.sender, sessionId, dollars, arcadeAmount);
    }

    // ── Views ───────────────────────────────────────────────────────────
    function isSessionClaimed(bytes32 sessionId) external view returns (bool) {
        return claimedSessions[sessionId];
    }

    /// Frontend/backend can use this to verify what hash the contract expects
    /// (useful for debugging signature mismatches).
    function computeClaimHash(
        address player,
        bytes32 sessionId,
        uint256 dollars
    ) external view returns (bytes32) {
        bytes32 messageHash = keccak256(
            abi.encodePacked(player, sessionId, dollars, address(this), block.chainid)
        );
        return MessageHashUtils.toEthSignedMessageHash(messageHash);
    }

    /// Current per-wallet consumed amount within the active window (0 if window expired).
    function walletClaimedNow(address wallet) external view returns (uint256) {
        if (block.timestamp >= walletCapWindowStart[wallet] + capResetPeriod) return 0;
        return walletClaimedInWindow[wallet];
    }

    // ── Internal cap refresh ────────────────────────────────────────────
    function _refreshWalletWindow(address wallet) internal {
        if (block.timestamp >= walletCapWindowStart[wallet] + capResetPeriod) {
            walletCapWindowStart[wallet]  = block.timestamp;
            walletClaimedInWindow[wallet] = 0;
        }
    }

    function _refreshTotalWindow() internal {
        if (block.timestamp >= totalCapWindowStart + capResetPeriod) {
            totalCapWindowStart  = block.timestamp;
            totalClaimedInWindow = 0;
        }
    }

    // ── Admin ───────────────────────────────────────────────────────────
    function setClaimSigner(address _signer) external onlyRole(ADMIN_ROLE) {
        claimSigner = _signer;
        emit ClaimSignerUpdated(_signer);
    }

    function setDollarToArcadeRate(uint256 _rate) external onlyRole(ADMIN_ROLE) {
        require(_rate > 0, "rate=0");
        dollarToArcadeRate = _rate;
        emit DollarToArcadeRateUpdated(_rate);
    }

    function setMaxDollarsPerSession(uint256 _max) external onlyRole(ADMIN_ROLE) {
        maxDollarsPerSession = _max;
        emit MaxDollarsPerSessionUpdated(_max);
    }

    function setDailyClaimCapPerWallet(uint256 _cap) external onlyRole(ADMIN_ROLE) {
        dailyClaimCapPerWallet = _cap;
        emit DailyClaimCapPerWalletUpdated(_cap);
    }

    function setDailyClaimCapTotal(uint256 _cap) external onlyRole(ADMIN_ROLE) {
        dailyClaimCapTotal = _cap;
        emit DailyClaimCapTotalUpdated(_cap);
    }

    function setCapResetPeriod(uint256 _seconds) external onlyRole(ADMIN_ROLE) {
        require(_seconds >= 1 hours && _seconds <= 7 days, "unreasonable period");
        capResetPeriod = _seconds;
        emit CapResetPeriodUpdated(_seconds);
    }

    function setPaused(bool _paused) external onlyRole(ADMIN_ROLE) {
        paused = _paused;
        emit PausedStatusUpdated(_paused);
    }

    /// Emergency: replace ArcadeToken (if token is ever redeployed).
    /// Requires re-granting PLATFORM_ROLE on the new token to this contract.
    function setArcadeToken(address _token) external onlyRole(ADMIN_ROLE) {
        require(_token != address(0), "token=0");
        arcadeToken = ArcadeToken(_token);
        emit ArcadeTokenUpdated(_token);
    }
}