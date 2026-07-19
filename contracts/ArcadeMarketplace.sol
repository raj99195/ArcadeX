// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title ArcadeMarketplace
 * @notice Chain-agnostic marketplace — works with any ERC-20 reward token
 *         (ARCADE on BOTChain/Somnia) or native token (MSTC on MST chain).
 *
 * Deploy params:
 *   BOTChain/Somnia: isNativeToken=false, _rewardToken=ArcadeToken address, chainName="BOTChain"
 *   MST:             isNativeToken=true,  _rewardToken=address(0),           chainName="MST Blockchain"
 */
contract ArcadeMarketplace is AccessControl, ReentrancyGuard {
    using Strings for uint256;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ── Token config ─────────────────────────────────────────────────────────
    IERC20  public rewardToken;       // ERC-20 reward token (zero address if native)
    bool    public isNativeToken;     // true = native (MSTC), false = ERC-20 (ARCADE)
    string  public rewardTokenSymbol; // "ARCADE", "MSTC", etc. — for events/metadata
    string  public chainName;         // "BOTChain", "MST Blockchain", etc.

    // Exchange rate: how many reward tokens per 1 native unit (only used when !isNativeToken)
    uint256 public tokensPerNative = 1000 * 1e18;

    BadgeNFT public badgeNFT;

    enum ItemType { Badge, Frame, PowerUp, Skin }

    struct ShopItem {
        uint256 id;
        string  name;
        string  description;
        string  imageURI;
        ItemType itemType;
        uint256 tokenPrice;   // price in rewardToken (ERC-20 or native)
        uint256 totalSupply;  // 0 = unlimited
        uint256 sold;
        bool    active;
    }

    struct UserInventory {
        uint256[] itemIds;
        mapping(uint256 => bool) owns;
    }

    mapping(uint256 => ShopItem)      public items;
    mapping(address => UserInventory) private inventories;

    uint256 public nextItemId = 1;
    uint256 public platformFeePercent = 5;

    event ItemPurchased(address indexed buyer, uint256 itemId, uint256 price);
    event ItemAdded(uint256 indexed itemId, string name, ItemType itemType);
    event ExchangeRateUpdated(uint256 newRate);
    event NativeSwapped(address indexed buyer, uint256 nativeSpent, uint256 tokensReceived);

    constructor(
        address admin,
        address _rewardToken,
        bool    _isNativeToken,
        string  memory _rewardTokenSymbol,
        string  memory _chainName
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);

        isNativeToken     = _isNativeToken;
        rewardTokenSymbol = _rewardTokenSymbol;
        chainName         = _chainName;

        if (!_isNativeToken) {
            require(_rewardToken != address(0), "ERC-20 address required");
            rewardToken = IERC20(_rewardToken);
        }

        badgeNFT = new BadgeNFT(address(this), _chainName);
    }

    // ── Buy reward tokens with native (only for ERC-20 chains) ──────────────
    /// @notice Swap native token (BOT/STT) for reward token (ARCADE)
    ///         Not available on native-token chains (MST) — MSTC IS the reward token.
    function buyTokensWithNative() external payable nonReentrant {
        require(!isNativeToken, "Use native token directly on this chain");
        require(msg.value > 0, "Send native token to swap");
        uint256 amount = (msg.value * tokensPerNative) / 1e18;
        require(amount > 0, "Amount too small");
        // ArcadeToken needs mintTo — cast only on ERC-20 chains
        IArcadeToken(address(rewardToken)).mintTo(msg.sender, amount);
        emit NativeSwapped(msg.sender, msg.value, amount);
    }

    // ── Buy item ─────────────────────────────────────────────────────────────
    /// @notice Buy shop item.
    ///         ERC-20 chains: call with value=0, tokens transferred via transferFrom.
    ///         Native chains: call with msg.value = item price in native token.
    function buyItem(uint256 itemId) external payable nonReentrant {
        ShopItem storage item = items[itemId];
        require(item.active,                                    "Item not available");
        require(!inventories[msg.sender].owns[itemId],          "Already owned");
        require(item.totalSupply == 0 || item.sold < item.totalSupply, "Sold out");

        if (isNativeToken) {
            require(msg.value >= item.tokenPrice, "Insufficient native token");
            // Refund excess
            if (msg.value > item.tokenPrice) {
                payable(msg.sender).transfer(msg.value - item.tokenPrice);
            }
        } else {
            require(item.tokenPrice > 0, "Item not available for token purchase");
            rewardToken.transferFrom(msg.sender, address(this), item.tokenPrice);
        }

        _giveItem(msg.sender, itemId);
        item.sold++;

        if (item.itemType == ItemType.Badge) {
            badgeNFT.mintBadge(msg.sender, itemId, item.name, item.imageURI);
        }

        emit ItemPurchased(msg.sender, itemId, item.tokenPrice);
    }

    function _giveItem(address user, uint256 itemId) internal {
        inventories[user].itemIds.push(itemId);
        inventories[user].owns[itemId] = true;
    }

    // ── Admin ────────────────────────────────────────────────────────────────
    function addItem(
        string   memory name,
        string   memory description,
        string   memory imageURI,
        ItemType         itemType,
        uint256          tokenPrice,
        uint256          botPrice,    // kept for ABI compatibility — ignored internally
        uint256          totalSupply
    ) external onlyRole(ADMIN_ROLE) {
        items[nextItemId] = ShopItem({
            id:          nextItemId,
            name:        name,
            description: description,
            imageURI:    imageURI,
            itemType:    itemType,
            tokenPrice:  tokenPrice,
            totalSupply: totalSupply,
            sold:        0,
            active:      true
        });
        emit ItemAdded(nextItemId, name, itemType);
        nextItemId++;
    }

    function setExchangeRate(uint256 newRate) external onlyRole(ADMIN_ROLE) {
        tokensPerNative = newRate;
        emit ExchangeRateUpdated(newRate);
    }

    function withdrawNative() external onlyRole(ADMIN_ROLE) {
        payable(msg.sender).transfer(address(this).balance);
    }

    function withdrawTokens() external onlyRole(ADMIN_ROLE) {
        if (!isNativeToken) {
            rewardToken.transfer(msg.sender, rewardToken.balanceOf(address(this)));
        } else {
            payable(msg.sender).transfer(address(this).balance);
        }
    }

    // ── Views ────────────────────────────────────────────────────────────────
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

    function nextItemId_() external view returns (uint256) { return nextItemId; }

    receive() external payable {}
}

// ── Minimal interface for ArcadeToken.mintTo (ERC-20 chains only) ────────────
interface IArcadeToken {
    function mintTo(address to, uint256 amount) external;
}

// ── BadgeNFT ─────────────────────────────────────────────────────────────────
contract BadgeNFT is ERC721 {
    using Strings for uint256;

    address public marketplace;
    uint256 private _tokenIdCounter;
    string  public platformChainName; // dynamic — set at deploy time

    struct Badge {
        uint256 itemId;
        string  name;
        string  imageURI;
        address owner;
        uint256 mintedAt;
    }

    mapping(uint256 => Badge) public badges;

    constructor(address _marketplace, string memory _chainName)
        ERC721("ArcadeX Badge", "AXBADGE")
    {
        marketplace       = _marketplace;
        platformChainName = _chainName;
    }

    function mintBadge(
        address to,
        uint256 itemId,
        string memory name,
        string memory imageURI
    ) external {
        require(msg.sender == marketplace, "Only marketplace");
        _tokenIdCounter++;
        badges[_tokenIdCounter] = Badge({
            itemId:   itemId,
            name:     name,
            imageURI: imageURI,
            owner:    to,
            mintedAt: block.timestamp
        });
        _mint(to, _tokenIdCounter);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        Badge memory b = badges[tokenId];
        string memory json = Base64.encode(bytes(string(abi.encodePacked(
            '{"name":"', b.name, ' #', tokenId.toString(), '",',
            '"description":"ArcadeX Badge - Earned on ', platformChainName, '",',
            '"attributes":[',
                '{"trait_type":"Platform","value":"ArcadeX"},',
                '{"trait_type":"Chain","value":"', platformChainName, '"}',
            ']}'
        ))));
        return string(abi.encodePacked("data:application/json;base64,", json));
    }
}
