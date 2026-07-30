// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MSTFaucet v2
 * @notice Self-contained gas faucet for ArcadeX MST players.
 *
 * Key design decisions:
 * - FAUCET_AMOUNT is immutable - set once at deploy, never changeable.
 *   No backend code can override it. Fully on-chain.
 * - claimGas() does everything: checks claimed, sends MSTC, marks claimed.
 *   Backend just calls one function - no amount parameter.
 * - Contract holds its own MSTC balance (fund via receive() or deposit()).
 * - onlyOwner = ArcadeX backend wallet (deployer).
 *
 * Flow:
 *   1. Deploy with desired amount (e.g. 0.1 ether)
 *   2. Fund contract with MSTC (send directly or via deposit())
 *   3. Backend calls claimGas(userAddress) - contract handles everything
 *   4. User gets MSTC, claimed[user] = true permanently on-chain
 */
contract MSTFaucet is Ownable, ReentrancyGuard {

    // ── State ──────────────────────────────────────────────────────────────

    /// @notice Fixed amount given per claim - set at deploy, immutable.
    uint256 public immutable FAUCET_AMOUNT;

    /// @notice On-chain record of every wallet that has claimed.
    mapping(address => bool) public claimed;

    // ── Events ─────────────────────────────────────────────────────────────

    event GasClaimed(address indexed user, uint256 amount, uint256 timestamp);
    event FaucetFunded(address indexed sender, uint256 amount);
    event FaucetWithdrawn(address indexed to, uint256 amount);

    // ── Constructor ────────────────────────────────────────────────────────

    /**
     * @param initialOwner  Backend wallet address (ArcadeX admin).
     * @param faucetAmount  Amount in wei to send per claim.
     *                      e.g. 0.1 MSTC = 100000000000000000
     *                      e.g. 0.5 MSTC = 500000000000000000
     */
    constructor(address initialOwner, uint256 faucetAmount)
        Ownable(initialOwner)
    {
        require(faucetAmount > 0, "Amount must be > 0");
        FAUCET_AMOUNT = faucetAmount;
    }

    // ── Core Function ──────────────────────────────────────────────────────

    /**
     * @notice Claim gas for a new user - called by backend (onlyOwner).
     * @dev    Amount is fixed on-chain - backend passes no amount param.
     *         Everything happens in one tx: check → send → mark.
     * @param  user  The new player wallet to receive MSTC.
     */
    function claimGas(address payable user)
        external
        onlyOwner
        nonReentrant
    {
        require(user != address(0),        "Zero address");
        require(!claimed[user],            "Already claimed");
        require(
            address(this).balance >= FAUCET_AMOUNT,
            "Faucet empty - fund the contract"
        );

        // Mark first - checks-effects-interactions pattern
        claimed[user] = true;

        // Send MSTC
        (bool ok,) = user.call{value: FAUCET_AMOUNT}("");
        require(ok, "MSTC transfer failed");

        emit GasClaimed(user, FAUCET_AMOUNT, block.timestamp);
    }

    // ── View ───────────────────────────────────────────────────────────────

    /**
     * @notice Check if a wallet has already claimed.
     */
    function hasClaimed(address user) external view returns (bool) {
        return claimed[user];
    }

    /**
     * @notice Current MSTC balance available for claims.
     */
    function balance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice How many more claims can be made with current balance.
     */
    function remainingClaims() external view returns (uint256) {
        if (FAUCET_AMOUNT == 0) return 0;
        return address(this).balance / FAUCET_AMOUNT;
    }

    // ── Funding ────────────────────────────────────────────────────────────

    /**
     * @notice Accept MSTC sent directly to contract address.
     */
    receive() external payable {
        emit FaucetFunded(msg.sender, msg.value);
    }

    /**
     * @notice Explicit deposit function (same as receive but callable).
     */
    function deposit() external payable {
        require(msg.value > 0, "Send some MSTC");
        emit FaucetFunded(msg.sender, msg.value);
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    /**
     * @notice Emergency withdraw - owner can pull remaining MSTC back.
     * @param  to      Destination address.
     * @param  amount  Amount in wei (0 = withdraw all).
     */
    function withdrawFunds(address payable to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        require(to != address(0), "Zero address");
        uint256 amt = amount == 0 ? address(this).balance : amount;
        require(amt <= address(this).balance, "Insufficient balance");
        (bool ok,) = to.call{value: amt}("");
        require(ok, "Withdraw failed");
        emit FaucetWithdrawn(to, amt);
    }
}
