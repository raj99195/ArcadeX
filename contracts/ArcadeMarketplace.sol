// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./ArcadeToken.sol";

contract ArcadeMarketplace is AccessControl, ReentrancyGuard {
    using Strings for uint256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    ArcadeToken public arcadeToken;

    // BOT → ARCADE exchange rate (how many ARCADE per 1 BOT)
    uint256 public arcadePerBot = 1000 * 1e18; // 1 BOT = 1000 ARCADE

    // NFT Badge contract
    BadgeNFT public badgeNFT;

    // Item types
    enum ItemType { Badge, Frame, PowerUp, Skin }

    struct ShopItem {
        uint256 id;
        string name;
        string description;
        string imageURI;
        ItemType itemType;
        uint256 arcadePrice;  // price in ARCADE (0 = not available for ARCADE)
        uint256 botPrice;     // price in BOT native token (0 = not available for BOT)
        uint256 totalSupply;  // 0 = unlimited
        uint256 sold;
        bool active;
    }

    struct UserInventory {
        uint256[] itemIds;
        mapping(uint256 => bool) owns;
    }

    mapping(uint256 => ShopItem) public items;
    mapping(address => UserInventory) private inventories;
    uint256 public nextItemId = 1;

    uint256 public totalArcadeSold;
    uint256 public totalBotCollected;
    uint256 public platformFeePercent = 5;

    event ArcadePurchased(address indexed buyer, uint256 botSpent, uint256 arcadeReceived);
    event ItemPurchased(address indexed buyer, uint256 itemId, string paymentType, uint256 price);
    event ItemAdded(uint256 indexed itemId, string name, ItemType itemType);
    event ExchangeRateUpdated(uint256 newRate);

    constructor(address admin, address _arcadeToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        arcadeToken = ArcadeToken(_arcadeToken);
        badgeNFT = new BadgeNFT(address(this));

        // Add default shop items
        _addDefaultItems();
    }

    // ─── BUY ARCADE WITH BOT ─────────────────────────────────────────────────

    /// @notice Buy ARCADE tokens with native BOT
    function buyArcadeWithBot() external payable nonReentrant {
        require(msg.value > 0, "Send BOT to buy ARCADE");
        uint256 arcadeAmount = (msg.value * arcadePerBot) / 1e18;
        require(arcadeAmount > 0, "Amount too small");

        // Mint ARCADE to buyer
        arcadeToken.mintTo(msg.sender, arcadeAmount);

        totalArcadeSold += arcadeAmount;
        totalBotCollected += msg.value;

        emit ArcadePurchased(msg.sender, msg.value, arcadeAmount);
    }

    /// @notice Get ARCADE amount for BOT amount
    function getArcadeForBot(uint256 botAmount) external view returns (uint256) {
        return (botAmount * arcadePerBot) / 1e18;
    }

    // ─── SHOP ITEMS ──────────────────────────────────────────────────────────

    /// @notice Buy item with ARCADE tokens
    function buyItemWithArcade(uint256 itemId) external nonReentrant {
        ShopItem storage item = items[itemId];
        require(item.active, "Item not available");
        require(item.arcadePrice > 0, "Item not available for ARCADE");
        require(!inventories[msg.sender].owns[itemId], "Already owned");
        require(item.totalSupply == 0 || item.sold < item.totalSupply, "Sold out");

        arcadeToken.transferFrom(msg.sender, address(this), item.arcadePrice);

        _giveItem(msg.sender, itemId);
        item.sold++;

        // Mint badge NFT if it's a badge
        if (item.itemType == ItemType.Badge) {
            badgeNFT.mintBadge(msg.sender, itemId, item.name, item.imageURI);
        }

        emit ItemPurchased(msg.sender, itemId, "ARCADE", item.arcadePrice);
    }

    /// @notice Buy item with BOT (native token)
    function buyItemWithBot(uint256 itemId) external payable nonReentrant {
        ShopItem storage item = items[itemId];
        require(item.active, "Item not available");
        require(item.botPrice > 0, "Item not available for BOT");
        require(msg.value >= item.botPrice, "Insufficient BOT");
        require(!inventories[msg.sender].owns[itemId], "Already owned");
        require(item.totalSupply == 0 || item.sold < item.totalSupply, "Sold out");

        _giveItem(msg.sender, itemId);
        item.sold++;

        if (item.itemType == ItemType.Badge) {
            badgeNFT.mintBadge(msg.sender, itemId, item.name, item.imageURI);
        }

        // Refund excess
        if (msg.value > item.botPrice) {
            payable(msg.sender).transfer(msg.value - item.botPrice);
        }

        emit ItemPurchased(msg.sender, itemId, "BOT", item.botPrice);
    }

    function _giveItem(address user, uint256 itemId) internal {
        inventories[user].itemIds.push(itemId);
        inventories[user].owns[itemId] = true;
    }

    // ─── ADMIN ───────────────────────────────────────────────────────────────

    function addItem(
        string memory name,
        string memory description,
        string memory imageURI,
        ItemType itemType,
        uint256 arcadePrice,
        uint256 botPrice,
        uint256 totalSupply
    ) external onlyRole(ADMIN_ROLE) {
        items[nextItemId] = ShopItem({
            id: nextItemId,
            name: name,
            description: description,
            imageURI: imageURI,
            itemType: itemType,
            arcadePrice: arcadePrice,
            botPrice: botPrice,
            totalSupply: totalSupply,
            sold: 0,
            active: true
        });
        emit ItemAdded(nextItemId, name, itemType);
        nextItemId++;
    }

    function setExchangeRate(uint256 newRate) external onlyRole(ADMIN_ROLE) {
        arcadePerBot = newRate;
        emit ExchangeRateUpdated(newRate);
    }

    function withdrawBot() external onlyRole(ADMIN_ROLE) {
        payable(msg.sender).transfer(address(this).balance);
    }

    function withdrawArcade() external onlyRole(ADMIN_ROLE) {
        arcadeToken.transfer(msg.sender, arcadeToken.balanceOf(address(this)));
    }

    // ─── VIEWS ───────────────────────────────────────────────────────────────

    function getUserItems(address user) external view returns (uint256[] memory) {
        return inventories[user].itemIds;
    }

    function ownsItem(address user, uint256 itemId) external view returns (bool) {
        return inventories[user].owns[itemId];
    }

    function getAllItems() external view returns (ShopItem[] memory) {
        ShopItem[] memory result = new ShopItem[](nextItemId - 1);
        for (uint256 i = 1; i < nextItemId; i++) {
            result[i - 1] = items[i];
        }
        return result;
    }

    function _addDefaultItems() internal {
        // Badges — ARCADE se
        items[nextItemId++] = ShopItem({ id: 1, name: "Pioneer Badge", description: "Early ArcadeX adopter", imageURI: "", itemType: ItemType.Badge, arcadePrice: 500 * 1e18, botPrice: 0, totalSupply: 1000, sold: 0, active: true });
        items[nextItemId++] = ShopItem({ id: 2, name: "Champion Badge", description: "Tournament winner badge", imageURI: "", itemType: ItemType.Badge, arcadePrice: 1000 * 1e18, botPrice: 0, totalSupply: 500, sold: 0, active: true });
        items[nextItemId++] = ShopItem({ id: 3, name: "Creator Badge", description: "Published 5+ games", imageURI: "", itemType: ItemType.Badge, arcadePrice: 750 * 1e18, botPrice: 0, totalSupply: 200, sold: 0, active: true });

        // Premium items — BOT se
        items[nextItemId++] = ShopItem({ id: 4, name: "Gold Frame", description: "Exclusive gold profile frame", imageURI: "", itemType: ItemType.Frame, arcadePrice: 0, botPrice: 0.01 ether, totalSupply: 100, sold: 0, active: true });
        items[nextItemId++] = ShopItem({ id: 5, name: "Diamond Frame", description: "Ultra rare diamond frame", imageURI: "", itemType: ItemType.Frame, arcadePrice: 0, botPrice: 0.05 ether, totalSupply: 10, sold: 0, active: true });

        // Power-ups — ARCADE se
        items[nextItemId++] = ShopItem({ id: 6, name: "2x Reward Boost", description: "Double ARCADE rewards for 24h", imageURI: "", itemType: ItemType.PowerUp, arcadePrice: 200 * 1e18, botPrice: 0, totalSupply: 0, sold: 0, active: true });
    }

    receive() external payable {}
}

// ─── BADGE NFT CONTRACT ───────────────────────────────────────────────────────
contract BadgeNFT is ERC721 {
    using Strings for uint256;

    address public marketplace;
    uint256 private _tokenIdCounter;

    struct Badge {
        uint256 itemId;
        string name;
        string imageURI;
        address owner;
        uint256 mintedAt;
    }

    mapping(uint256 => Badge) public badges;

    constructor(address _marketplace) ERC721("ArcadeX Badge", "AXBADGE") {
        marketplace = _marketplace;
    }

    function mintBadge(address to, uint256 itemId, string memory name, string memory imageURI) external {
        require(msg.sender == marketplace, "Only marketplace");
        _tokenIdCounter++;
        badges[_tokenIdCounter] = Badge({ itemId: itemId, name: name, imageURI: imageURI, owner: to, mintedAt: block.timestamp });
        _mint(to, _tokenIdCounter);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        Badge memory b = badges[tokenId];
        string memory json = Base64.encode(bytes(string(abi.encodePacked(
            '{"name":"', b.name, ' #', tokenId.toString(), '",',
            '"description":"ArcadeX Badge - Earned on BOTChain",',
            '"attributes":[{"trait_type":"Platform","value":"ArcadeX"},{"trait_type":"Chain","value":"BOTChain"}]}'
        ))));
        return string(abi.encodePacked("data:application/json;base64,", json));
    }
}