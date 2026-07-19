// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title CampaignBadge
 * @notice Generic, admin-controlled badge NFT system for ArcadeX campaigns
 *         (Genesis, Pioneer, Legend, Creator, Builder, and any future tiers).
 *
 * Design:
 *  - Badge "types" are defined by admin (name, max supply) — new types can be
 *    added anytime without redeploying, so numbers/tiers can flex as the
 *    campaign plan evolves (exactly like the Genesis/Pioneer/Legend/Creator/
 *    Builder tiers discussed for the BOTChain co-marketing campaign).
 *  - Minting requires a signature from an authorized SIGNER_ROLE wallet
 *    (the backend signs only after verifying real eligibility — e.g. "this
 *    wallet played 5 different games" — against Firestore). This prevents
 *    anyone from calling mint() directly and draining limited supply without
 *    actually meeting the criteria.
 *  - Each wallet can claim a given badge type only once (duplicate-claim
 *    prevention), enforced on-chain.
 *  - Minting itself is free (no ETH/ARCADE cost) — these are participation
 *    rewards, not marketplace purchases.
 */
contract CampaignBadge is ERC721, AccessControl {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    struct BadgeType {
        string name;        // e.g. "Genesis Badge"
        uint256 maxSupply;  // e.g. 5000
        uint256 minted;     // running count
        string imageURI;    // metadata image (can be set later)
        bool active;        // admin can pause a badge type from further minting
    }

    // badgeTypeId => BadgeType
    mapping(uint256 => BadgeType) public badgeTypes;
    uint256 public nextBadgeTypeId = 1;

    // wallet => badgeTypeId => already claimed?
    mapping(address => mapping(uint256 => bool)) public hasClaimed;

    // tokenId => badgeTypeId (so tokenURI/metadata can look up which badge it is)
    mapping(uint256 => uint256) public tokenBadgeType;
    uint256 private _nextTokenId = 1;

    // Used signatures can't be replayed (extra safety on top of hasClaimed,
    // covers the case where eligibility logic itself might be re-run)
    mapping(bytes32 => bool) public usedSignatures;

    event BadgeTypeCreated(uint256 indexed badgeTypeId, string name, uint256 maxSupply);
    event BadgeTypeUpdated(uint256 indexed badgeTypeId, bool active, string imageURI);
    event BadgeMinted(address indexed to, uint256 indexed badgeTypeId, uint256 indexed tokenId);

    constructor(address admin) ERC721("ArcadeX Campaign Badge", "ARCXBADGE") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(SIGNER_ROLE, admin); // admin wallet doubles as initial signer; can add a dedicated backend signer later
    }

    // ── Admin: badge type management ───────────────────────────────────────

    /// @notice Create a new badge type (e.g. "Genesis Badge", 5000 supply).
    function createBadgeType(string calldata name, uint256 maxSupply, string calldata imageURI)
        external onlyRole(ADMIN_ROLE) returns (uint256 badgeTypeId)
    {
        badgeTypeId = nextBadgeTypeId++;
        badgeTypes[badgeTypeId] = BadgeType({
            name: name,
            maxSupply: maxSupply,
            minted: 0,
            imageURI: imageURI,
            active: true
        });
        emit BadgeTypeCreated(badgeTypeId, name, maxSupply);
    }

    /// @notice Pause/unpause a badge type and/or update its image URI.
    function updateBadgeType(uint256 badgeTypeId, bool active, string calldata imageURI)
        external onlyRole(ADMIN_ROLE)
    {
        require(badgeTypes[badgeTypeId].maxSupply > 0, "Badge type does not exist");
        badgeTypes[badgeTypeId].active = active;
        badgeTypes[badgeTypeId].imageURI = imageURI;
        emit BadgeTypeUpdated(badgeTypeId, active, imageURI);
    }

    // ── Public: signature-verified claim ────────────────────────────────────

    /**
     * @notice Mint a badge after the backend has verified eligibility and
     *         signed off on it. The signature covers (recipient, badgeTypeId,
     *         contract address, chainId) so it can't be replayed on another
     *         wallet, badge type, or chain.
     */
    function claimBadge(uint256 badgeTypeId, bytes calldata signature) external {
        BadgeType storage bt = badgeTypes[badgeTypeId];
        require(bt.maxSupply > 0, "Badge type does not exist");
        require(bt.active, "Badge type not active");
        require(bt.minted < bt.maxSupply, "Badge type sold out");
        require(!hasClaimed[msg.sender][badgeTypeId], "Already claimed this badge");

        bytes32 messageHash = keccak256(
            abi.encodePacked(msg.sender, badgeTypeId, address(this), block.chainid)
        );
        require(!usedSignatures[messageHash], "Signature already used");

        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(signature);
        require(hasRole(SIGNER_ROLE, signer), "Invalid signature");

        usedSignatures[messageHash] = true;
        hasClaimed[msg.sender][badgeTypeId] = true;
        bt.minted += 1;

        uint256 tokenId = _nextTokenId++;
        tokenBadgeType[tokenId] = badgeTypeId;
        _safeMint(msg.sender, tokenId);

        emit BadgeMinted(msg.sender, badgeTypeId, tokenId);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getBadgeType(uint256 badgeTypeId) external view returns (BadgeType memory) {
        return badgeTypes[badgeTypeId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return badgeTypes[tokenBadgeType[tokenId]].imageURI;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
