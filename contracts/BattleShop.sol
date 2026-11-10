// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title BattleShop
 * @notice Signed-quote item shop for ArcadeX. Players buy permanent
 *         unlocks (gun skins, environments, power-ups, cosmetics) by
 *         submitting a backend-signed purchase quote.
 *
 * @dev Signature format (must match games.js backend exactly):
 *      keccak256(buyer, itemId, token, price, nonce, address(this), chainId)
 *      wrapped in EIP-191 (\x19Ethereum Signed Message:\n32)
 *
 * @dev Security features:
 *   - AccessControl with 3 roles (ADMIN, SIGNER, TREASURY)
 *   - ReentrancyGuard on purchase (treasury could be a contract)
 *   - Pausable emergency stop
 *   - SafeERC20 for non-standard tokens (USDT etc.)
 *   - Nonce-based replay protection
 *   - address(this) + chainId in hash prevents cross-contract/chain replay
 *   - Custom errors (gas efficient)
 *   - Non-upgradeable — immutable code
 *   - Checks-Effects-Interactions pattern
 */
contract BattleShop is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA         for bytes32;
    using MessageHashUtils for bytes32;

    // ══════════════════════════════════════════════════════════════════
    // ROLES
    // ══════════════════════════════════════════════════════════════════

    bytes32 public constant ADMIN_ROLE    = keccak256("ADMIN_ROLE");
    bytes32 public constant SIGNER_ROLE   = keccak256("SIGNER_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    // ══════════════════════════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════════════════════════

    address public treasury;
    mapping(address => bool) public acceptedTokens;
    mapping(bytes32 => bool) public usedNonces;
    mapping(address => mapping(bytes32 => bool)) public hasItem;

    // ══════════════════════════════════════════════════════════════════
    // ERRORS
    // ══════════════════════════════════════════════════════════════════

    error ZeroAddress();
    error ZeroAmount();
    error TokenNotAccepted(address token);
    error NonceAlreadyUsed(bytes32 nonce);
    error AlreadyOwned(address player, bytes32 itemId);
    error InvalidSignature();
    error SameTreasury();
    error NoItemToRevoke();

    // ══════════════════════════════════════════════════════════════════
    // EVENTS
    // ══════════════════════════════════════════════════════════════════

    event ItemPurchased(
        address indexed player,
        bytes32 indexed itemId,
        address indexed token,
        uint256 price,
        bytes32 nonce
    );
    event ItemGranted(address indexed player, bytes32 indexed itemId, address indexed grantedBy);
    event ItemRevoked(address indexed player, bytes32 indexed itemId, address indexed revokedBy);
    event AcceptedTokenUpdated(address indexed token, bool accepted);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    // ══════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════════

    constructor(address _admin, address _signer, address _treasury) {
        if (_admin == address(0) || _signer == address(0) || _treasury == address(0)) {
            revert ZeroAddress();
        }
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE,          _admin);
        _grantRole(SIGNER_ROLE,         _signer);
        _grantRole(TREASURY_ROLE,       _admin);

        treasury = _treasury;
        emit TreasuryUpdated(address(0), _treasury);
    }

    // ══════════════════════════════════════════════════════════════════
    // PURCHASE
    // ══════════════════════════════════════════════════════════════════

    /**
     * @notice Buy an item using a backend-signed quote.
     * @dev Caller must pre-approve this contract to spend `price` of `token`.
     */
    function purchase(
        bytes32 itemId,
        address token,
        uint256 price,
        bytes32 nonce,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        // ── Checks ──
        if (price == 0)                          revert ZeroAmount();
        if (!acceptedTokens[token])              revert TokenNotAccepted(token);
        if (usedNonces[nonce])                   revert NonceAlreadyUsed(nonce);
        if (hasItem[msg.sender][itemId])         revert AlreadyOwned(msg.sender, itemId);

        bytes32 messageHash = keccak256(
            abi.encodePacked(
                msg.sender,
                itemId,
                token,
                price,
                nonce,
                address(this),
                block.chainid
            )
        );
        address recovered = messageHash.toEthSignedMessageHash().recover(signature);
        if (!hasRole(SIGNER_ROLE, recovered)) revert InvalidSignature();

        // ── Effects ──
        usedNonces[nonce]            = true;
        hasItem[msg.sender][itemId]  = true;

        // ── Interactions ──
        IERC20(token).safeTransferFrom(msg.sender, treasury, price);

        emit ItemPurchased(msg.sender, itemId, token, price, nonce);
    }

    // ══════════════════════════════════════════════════════════════════
    // ADMIN: grant / revoke
    // ══════════════════════════════════════════════════════════════════

    function grantItem(address player, bytes32 itemId)
        external onlyRole(ADMIN_ROLE) whenNotPaused
    {
        if (player == address(0)) revert ZeroAddress();
        if (hasItem[player][itemId]) return; // idempotent

        hasItem[player][itemId] = true;
        emit ItemGranted(player, itemId, msg.sender);
    }

    function grantItemBatch(address[] calldata players, bytes32 itemId)
        external onlyRole(ADMIN_ROLE) whenNotPaused
    {
        uint256 len = players.length;
        for (uint256 i = 0; i < len; i++) {
            address player = players[i];
            if (player == address(0))    continue;
            if (hasItem[player][itemId]) continue;

            hasItem[player][itemId] = true;
            emit ItemGranted(player, itemId, msg.sender);
        }
    }

    function revokeItem(address player, bytes32 itemId)
        external onlyRole(ADMIN_ROLE)
    {
        if (!hasItem[player][itemId]) revert NoItemToRevoke();
        hasItem[player][itemId] = false;
        emit ItemRevoked(player, itemId, msg.sender);
    }

    // ══════════════════════════════════════════════════════════════════
    // ADMIN: token + treasury
    // ══════════════════════════════════════════════════════════════════

    function setAcceptedToken(address token, bool accepted)
        external onlyRole(ADMIN_ROLE)
    {
        if (token == address(0)) revert ZeroAddress();
        acceptedTokens[token] = accepted;
        emit AcceptedTokenUpdated(token, accepted);
    }

    function setTreasury(address newTreasury)
        external onlyRole(TREASURY_ROLE)
    {
        if (newTreasury == address(0))     revert ZeroAddress();
        if (newTreasury == treasury)       revert SameTreasury();

        address old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    // ══════════════════════════════════════════════════════════════════
    // EMERGENCY
    // ══════════════════════════════════════════════════════════════════

    function pause()   external onlyRole(ADMIN_ROLE) { _pause();   }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amount)
        external onlyRole(ADMIN_ROLE)
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0)      revert ZeroAmount();
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyWithdraw(token, to, amount);
    }

    // ══════════════════════════════════════════════════════════════════
    // VIEW HELPERS  (backend queries these in record-purchase)
    // ══════════════════════════════════════════════════════════════════

    function ownsItem(address player, bytes32 itemId) external view returns (bool) {
        return hasItem[player][itemId];
    }

    function isNonceUsed(bytes32 nonce) external view returns (bool) {
        return usedNonces[nonce];
    }
}
