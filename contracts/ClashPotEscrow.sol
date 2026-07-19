// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ClashPotEscrow
 * @notice ClashPot PvP ke liye 2-player stake escrow — native MSTC.
 *
 * FLOW
 *   1. Dono players join(matchId) call karte hain apne stake ke saath.
 *      Pehla player stake amount decide karta hai; doosre ko exactly wahi
 *      bhejna padta hai. Dono aa gaye → status Funded → game shuru.
 *   2. Match khatam hone pe backend (SETTLER_ROLE) settle() call karta hai
 *      dono players ke final amounts ke saath.
 *   3. Kuch galat ho jaaye (server down, opponent aaya hi nahi) to timeout
 *      ke baad koi bhi refundExpired() call karke paisa wapas nikaal sakta hai.
 *
 * "MINT" YAHAN NAHI HOTA
 *   MSTC native token hai — contract ise mint nahi kar sakta. Zaroorat bhi
 *   nahi: pot (5+5=10) pehle se contract ke paas hai, settle() bas usko
 *   baant deta hai. settle() enforce karta hai:
 *
 *       p1Amount + p2Amount + fee == pot
 *
 *   Isliye backend chaahe bhi to contract se pot se zyada nahi nikaal sakta —
 *   sirf baant sakta hai. Ye jaan-boojh kar rakha gaya hai, kyunki settler
 *   key server.js me rehti hai aur wo alag trust boundary hai.
 *
 * TIMEOUT REFUND KYU ZAROORI HAI
 *   Iske bina agar backend crash ho jaaye ya settler key kho jaaye, to har
 *   funded match ka paisa contract me HAMESHA ke liye fas jaayega. Timeout
 *   ke baad players khud apna stake wapas le sakte hain — backend ki
 *   permission ke bina.
 */
contract ClashPotEscrow is AccessControl, ReentrancyGuard {

    bytes32 public constant ADMIN_ROLE   = keccak256("ADMIN_ROLE");
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    enum Status { None, Open, Funded, Settled, Refunded }

    struct Match {
        address p1;
        address p2;
        uint256 stake;      // per player, wei
        uint256 pot;        // total jama (stake * 2 jab Funded ho)
        uint64  createdAt;
        uint64  fundedAt;
        Status  status;
    }

    mapping(bytes32 => Match) private _matches;

    /// @notice Active matches me locked total. Admin ise chhoo nahi sakta (emergency ke alawa).
    uint256 public totalLocked;

    /// @notice Failed direct transfers ka pull-payment balance.
    mapping(address => uint256) public pendingWithdrawals;
    uint256 public totalPending;

    // ── Fee (default 0) ───────────────────────────────────────────────────────
    uint16  public feeBps;            // 100 = 1%
    address public feeRecipient;
    uint16  public constant MAX_FEE_BPS = 1000;   // 10% ceiling, badla nahi ja sakta

    // ── Timeouts ──────────────────────────────────────────────────────────────
    /// @notice Opponent na aaye to itni der baad p1 apna stake wapas le sakta hai.
    uint64 public joinTimeout = 10 minutes;
    /// @notice Funded match settle na ho to itni der baad dono apna stake wapas le sakte hain.
    uint64 public settleTimeout = 2 hours;

    /// @notice true hone pe naye join band. settle/refund tab bhi chalte rehte hain.
    bool public paused;

    // ── Events ────────────────────────────────────────────────────────────────
    event MatchCreated(bytes32 indexed matchId, address indexed p1, uint256 stake);
    event MatchFunded(bytes32 indexed matchId, address indexed p1, address indexed p2, uint256 pot);
    event MatchSettled(bytes32 indexed matchId, uint256 p1Amount, uint256 p2Amount, uint256 fee);
    event MatchRefunded(bytes32 indexed matchId, string reason);
    event MatchCancelled(bytes32 indexed matchId, address indexed p1);
    event PayoutQueued(address indexed to, uint256 amount);   // direct transfer fail hua
    event PendingWithdrawn(address indexed to, uint256 amount);
    event SurplusWithdrawn(address indexed to, uint256 amount);
    event EmergencyWithdrawn(address indexed to, uint256 amount);
    event FeeUpdated(uint16 bps, address recipient);
    event TimeoutsUpdated(uint64 joinTimeout, uint64 settleTimeout);
    event PausedStatusUpdated(bool isPaused);

    constructor(address admin, address settler) {
        require(admin != address(0), "admin=0");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        if (settler != address(0)) _grantRole(SETTLER_ROLE, settler);
        feeRecipient = admin;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PLAYERS
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Match join karo apna stake bhej ke.
     * @param matchId Backend ke roomId ka keccak256 — matchIdFor() dekho.
     *
     * Pehla caller stake set karta hai, doosre ko bilkul wahi amount bhejna hoga.
     */
    function join(bytes32 matchId) external payable nonReentrant {
        require(!paused, "Paused");
        require(msg.value > 0, "Zero stake");

        Match storage m = _matches[matchId];

        if (m.status == Status.None) {
            m.p1        = msg.sender;
            m.stake     = msg.value;
            m.pot       = msg.value;
            m.createdAt = uint64(block.timestamp);
            m.status    = Status.Open;

            totalLocked += msg.value;
            emit MatchCreated(matchId, msg.sender, msg.value);

        } else if (m.status == Status.Open) {
            require(msg.sender != m.p1, "Already joined");
            require(msg.value == m.stake, "Stake mismatch");

            m.p2       = msg.sender;
            m.pot     += msg.value;
            m.fundedAt = uint64(block.timestamp);
            m.status   = Status.Funded;

            totalLocked += msg.value;
            emit MatchFunded(matchId, m.p1, msg.sender, m.pot);

        } else {
            revert("Match not joinable");
        }
    }

    /// @notice p1 apna open match cancel karke stake wapas le sakta hai (opponent aane se pehle).
    function cancelOpen(bytes32 matchId) external nonReentrant {
        Match storage m = _matches[matchId];
        require(m.status == Status.Open, "Not open");
        require(msg.sender == m.p1, "Not your match");

        uint256 amount = m.pot;
        m.status = Status.Refunded;
        m.pot    = 0;
        totalLocked -= amount;

        _payout(m.p1, amount);
        emit MatchCancelled(matchId, m.p1);
    }

    /**
     * @notice Timeout ke baad refund. Koi bhi call kar sakta hai — backend ki
     *         permission ki zaroorat nahi. Ye players ka safety net hai.
     */
    function refundExpired(bytes32 matchId) external nonReentrant {
        Match storage m = _matches[matchId];

        if (m.status == Status.Open) {
            require(block.timestamp >= m.createdAt + joinTimeout, "Join window open");

            uint256 amount = m.pot;
            m.status = Status.Refunded;
            m.pot    = 0;
            totalLocked -= amount;

            _payout(m.p1, amount);
            emit MatchRefunded(matchId, "no opponent");

        } else if (m.status == Status.Funded) {
            require(block.timestamp >= m.fundedAt + settleTimeout, "Settle window open");

            uint256 each = m.stake;
            m.status = Status.Refunded;
            m.pot    = 0;
            totalLocked -= (each * 2);

            _payout(m.p1, each);
            _payout(m.p2, each);
            emit MatchRefunded(matchId, "settle timeout");

        } else {
            revert("Nothing to refund");
        }
    }

    /// @notice Agar direct transfer fail hua tha to yahan se nikalo.
    function withdrawPending() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing pending");

        pendingWithdrawals[msg.sender] = 0;
        totalPending -= amount;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdraw failed");
        emit PendingWithdrawn(msg.sender, amount);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BACKEND
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Match settle karo. Amounts match ke p1/p2 ke hisaab se.
     *
     * @dev Sabse important line yahan ye hai:
     *          require(p1Amount + p2Amount + fee == pot)
     *      Isse settler chori nahi kar sakta — pot ka har wei kisi na kisi
     *      player ya fee recipient ke paas hi jaayega, na kam na zyada.
     *      Isi wajah se backend me float→wei conversion exact hona chahiye,
     *      warna 1 wei ka dust bhi settle ko revert kara dega.
     */
    function settle(
        bytes32 matchId,
        uint256 p1Amount,
        uint256 p2Amount
    ) external onlyRole(SETTLER_ROLE) nonReentrant {
        Match storage m = _matches[matchId];
        require(m.status == Status.Funded, "Not funded");

        uint256 pot = m.pot;
        uint256 fee = (pot * feeBps) / 10000;

        require(p1Amount + p2Amount + fee == pot, "Amounts must equal pot");

        m.status = Status.Settled;
        m.pot    = 0;
        totalLocked -= pot;

        if (p1Amount > 0) _payout(m.p1, p1Amount);
        if (p2Amount > 0) _payout(m.p2, p2Amount);
        if (fee > 0)      _payout(feeRecipient, fee);

        emit MatchSettled(matchId, p1Amount, p2Amount, fee);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ADMIN
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice Wo funds nikalo jo kisi active match ke NAHI hain —
     *         fees, galti se bheja hua native token, bacha hua dust.
     *
     * @dev Ye default aur safe raasta hai: locked escrow aur pending
     *      withdrawals ko haath nahi lagata, isliye players ka paisa
     *      surakshit rehta hai chahe admin key compromise ho jaaye.
     */
    function withdrawSurplus(address payable to, uint256 amount)
        external onlyRole(ADMIN_ROLE) nonReentrant
    {
        require(to != address(0), "to=0");
        require(amount <= availableSurplus(), "Exceeds surplus");

        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit SurplusWithdrawn(to, amount);
    }

    /**
     * @notice ⚠️ EMERGENCY — locked escrow samet KUCH BHI nikaal sakta hai.
     *
     * @dev Ye ek trust assumption hai jo players pe bhaari padti hai: admin
     *      chalu matches ka paisa bhi le ja sakta hai. Isliye do guardrails
     *      lagaye hain —
     *        1. Sirf tab chalta hai jab contract paused ho (naye join band),
     *           taaki chupke se na ho sake.
     *        2. Alag event emit karta hai jo explorer pe saaf dikhta hai.
     *      Ise sirf contract migration ya sach me kisi emergency me use karo.
     *      Rozmarra ke fee/surplus nikaalne ke liye withdrawSurplus() hai.
     *
     *      Agar aage chal ke players ka bharosa badhana ho, to ise multisig
     *      ya timelock ke peeche daal dena — abhi ye single key hai.
     */
    function emergencyWithdraw(address payable to, uint256 amount)
        external onlyRole(ADMIN_ROLE) nonReentrant
    {
        require(paused, "Pause first");
        require(to != address(0), "to=0");
        require(amount <= address(this).balance, "Insufficient balance");

        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit EmergencyWithdrawn(to, amount);
    }

    function setFee(uint16 bps, address recipient) external onlyRole(ADMIN_ROLE) {
        require(bps <= MAX_FEE_BPS, "Fee too high");
        require(recipient != address(0) || bps == 0, "recipient=0");
        feeBps       = bps;
        feeRecipient = recipient;
        emit FeeUpdated(bps, recipient);
    }

    function setTimeouts(uint64 _joinTimeout, uint64 _settleTimeout) external onlyRole(ADMIN_ROLE) {
        require(_joinTimeout >= 1 minutes, "join too short");
        require(_settleTimeout >= 10 minutes, "settle too short");
        joinTimeout   = _joinTimeout;
        settleTimeout = _settleTimeout;
        emit TimeoutsUpdated(_joinTimeout, _settleTimeout);
    }

    function setPaused(bool _paused) external onlyRole(ADMIN_ROLE) {
        paused = _paused;
        emit PausedStatusUpdated(_paused);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // VIEWS
    // ──────────────────────────────────────────────────────────────────────────

    function getMatch(bytes32 matchId) external view returns (Match memory) {
        return _matches[matchId];
    }

    /// @notice Backend game shuru karne se pehle ye check kare.
    function isFunded(bytes32 matchId) external view returns (bool) {
        return _matches[matchId].status == Status.Funded;
    }

    /// @notice Admin kitna nikaal sakta hai (locked escrow chhod kar).
    function availableSurplus() public view returns (uint256) {
        uint256 reserved = totalLocked + totalPending;
        uint256 bal = address(this).balance;
        return bal > reserved ? bal - reserved : 0;
    }

    /// @notice roomId string se matchId — backend, Unity aur contract sab yahi formula use karein.
    function matchIdFor(string calldata roomId) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(roomId));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // INTERNAL
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @dev Pehle direct bhejo; fail ho to credit kar do.
     *      Kyu: agar koi player smart contract wallet hai jo receive pe revert
     *      karta hai, to direct transfer poore settle() ko revert kara dega aur
     *      doosre player ka paisa bhi atak jaayega. Credit fallback se ek
     *      player doosre ko bandhak nahi bana sakta.
     */
    function _payout(address to, uint256 amount) internal {
        if (amount == 0) return;

        (bool ok, ) = payable(to).call{value: amount, gas: 30000}("");
        if (!ok) {
            pendingWithdrawals[to] += amount;
            totalPending += amount;
            emit PayoutQueued(to, amount);
        }
    }

    /// @notice Seedha native token bhejne pe surplus ban jaata hai (locked nahi).
    receive() external payable {}
}
