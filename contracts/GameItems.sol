// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title GameItems
 * @notice ArcadeX SDK — web3 payment + minting layer for in-game purchases.
 *
 * Design: the game (Unity) owns all item data (name, image, price, index).
 * This contract does NOT store a registry, does NOT track ownership, and
 * does NOT gate purchases on prior registration. Every call is fully
 * self-contained — pass the data, pay, done.
 *
 * Two purchase types:
 *   1. purchaseSkinAndMint — pay + mint an ERC-1155 NFT (skins, characters)
 *   2. purchasePowerUp     — pay only, no NFT (power-ups, boosts, consumables)
 *
 * Both ERC-20 (BOTChain/Somnia) and native token (MST) payment supported.
 */
contract GameItems is ERC1155, ERC1155Supply, ReentrancyGuard {
    using Strings for uint256;

    // -- Token config ------------------------------------------
    IERC20  public arcadeToken;
    bool    public isNativeToken;
    address public platformWallet;
    uint256 public constant PLATFORM_FEE  = 20; // %
    uint256 public constant CREATOR_SHARE = 80; // %

    // -- Skin struct (for NFT metadata only — no registry lookup) ----
    struct Skin {
        uint256 gameId;
        uint256 skinIndex;
        string  name;
        string  imageURI;
        uint256 price;
        address creator;
    }

    // -- Storage -------------------------------------------------
    // tokenId => skin data, purely for uri()/metadata display, not a registry
    mapping(uint256 => Skin) public skins;
    uint256 public nextTokenId = 1;

    // -- Events ----------------------------------------------------
    event SkinPurchased(address indexed player, uint256 indexed tokenId, uint256 indexed gameId, uint256 skinIndex, uint256 price);
    event PowerUpPurchased(address indexed player, uint256 indexed gameId, string powerUpId, uint256 price);

    // -- Constructor -----------------------------------------------
    constructor(
        address _platformWallet,
        address _arcadeToken,
        bool    _isNativeToken
    ) ERC1155("") {
        platformWallet = _platformWallet;
        isNativeToken  = _isNativeToken;
        if (!_isNativeToken) {
            require(_arcadeToken != address(0), "Token address required");
            arcadeToken = IERC20(_arcadeToken);
        }
    }

    // -- Internal: split + collect payment --------------------------
    function _takePayment(address creator, uint256 price) internal {
        if (price == 0) return;
        uint256 platformAmt = (price * PLATFORM_FEE) / 100;
        uint256 creatorAmt  = price - platformAmt;

        if (isNativeToken) {
            require(msg.value >= price, "Insufficient native token");
            (bool c, ) = payable(creator).call{value: creatorAmt}("");
            require(c, "Creator transfer failed");
            (bool p, ) = payable(platformWallet).call{value: platformAmt}("");
            require(p, "Platform transfer failed");
            if (msg.value > price) {
                (bool r, ) = payable(msg.sender).call{value: msg.value - price}("");
                require(r, "Refund failed");
            }
        } else {
            require(arcadeToken.transferFrom(msg.sender, creator, creatorAmt), "Creator transfer failed");
            require(arcadeToken.transferFrom(msg.sender, platformWallet, platformAmt), "Platform transfer failed");
        }
    }

    // -- Purchase skin: pay + mint NFT, single call ------------------
    // gameId, skinIndex, name, imageURI (ipfs://...), price — all passed by the game,
    // no prior registration needed.
    function purchaseSkinAndMint(
        uint256 gameId,
        uint256 skinIndex,
        string  memory name,
        string  memory imageURI,
        uint256 price,
        address creator
    ) external payable nonReentrant returns (uint256 tokenId) {
        require(creator != address(0), "Creator required");

        _takePayment(creator, price);

        tokenId = nextTokenId++;
        skins[tokenId] = Skin({
            gameId:    gameId,
            skinIndex: skinIndex,
            name:      name,
            imageURI:  imageURI,
            price:     price,
            creator:   creator
        });

        _mint(msg.sender, tokenId, 1, "");

        emit SkinPurchased(msg.sender, tokenId, gameId, skinIndex, price);
    }

    // -- Purchase power-up: pay only, no NFT, no on-chain ownership check ---
    // Ownership/unlock state is tracked entirely on the game (Unity) side.
    function purchasePowerUp(
        uint256 gameId,
        string  memory powerUpId,
        uint256 price,
        address creator
    ) external payable nonReentrant {
        require(creator != address(0), "Creator required");

        _takePayment(creator, price);

        emit PowerUpPurchased(msg.sender, gameId, powerUpId, price);
    }

    // -- ERC-1155 Metadata URI ---------------------------------------
    function uri(uint256 tokenId) public view override returns (string memory) {
        require(tokenId > 0 && tokenId < nextTokenId, "Token does not exist");
        Skin memory s = skins[tokenId];
        string memory priceStr = (s.price / 1e18).toString();

        string memory json = string(abi.encodePacked(
            '{"name":"', s.name, '",',
            '"description":"In-game skin for game #', s.gameId.toString(), ' - ArcadeX",',
            '"image":"', s.imageURI, '",',
            '"attributes":[',
                '{"trait_type":"Game ID","value":', s.gameId.toString(), '},',
                '{"trait_type":"Skin Index","value":', s.skinIndex.toString(), '},',
                '{"trait_type":"Price","value":', priceStr, '}',
            ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    receive() external payable {}

    // -- Required overrides -------------------------------------------
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal override(ERC1155, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }
}
