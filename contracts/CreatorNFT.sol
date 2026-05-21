// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract CreatorNFT is ERC721, AccessControl {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 private _tokenIdCounter;

    struct CreatorProfile {
        string username;
        string avatarColor;
        address wallet;
        uint256 mintedAt;
    }

    // tokenId => profile
    mapping(uint256 => CreatorProfile) public profiles;
    // username => taken?
    mapping(string => bool) public usernameTaken;
    // wallet => tokenId (0 = no NFT)
    mapping(address => uint256) public walletToToken;

    event CreatorMinted(
        address indexed creator,
        uint256 indexed tokenId,
        string username
    );

    constructor(address admin) ERC721("ArcadeX Creator", "ARCX") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    /// @notice Mint creator NFT — one per wallet, unique username
    function mintCreatorNFT(string memory username, string memory avatarColor) external {
        require(walletToToken[msg.sender] == 0, "Already a creator");
        require(!usernameTaken[username], "Username taken");
        require(bytes(username).length >= 3, "Username too short");
        require(bytes(username).length <= 20, "Username too long");

        _tokenIdCounter++;
        uint256 tokenId = _tokenIdCounter;

        profiles[tokenId] = CreatorProfile({
            username: username,
            avatarColor: avatarColor,
            wallet: msg.sender,
            mintedAt: block.timestamp
        });

        usernameTaken[username] = true;
        walletToToken[msg.sender] = tokenId;

        _mint(msg.sender, tokenId);

        emit CreatorMinted(msg.sender, tokenId, username);
    }

    /// @notice On-chain SVG metadata
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");

        CreatorProfile memory p = profiles[tokenId];

        string memory svg = _buildSVG(p, tokenId);
        string memory json = Base64.encode(bytes(string(abi.encodePacked(
            '{"name":"', p.username, '.arcade",',
            '"description":"ArcadeX Creator Pass - On-chain identity on BOTChain",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '",',
            '"attributes":[',
                '{"trait_type":"Username","value":"', p.username, '"},',
                '{"trait_type":"Chain","value":"BOTChain"},',
                '{"trait_type":"Platform","value":"ArcadeX"},',
                '{"trait_type":"Token ID","value":"', tokenId.toString(), '"}',
            ']}'
        ))));

        return string(abi.encodePacked("data:application/json;base64,", json));
    }

    function _buildSVG(CreatorProfile memory p, uint256 tokenId) internal pure returns (string memory) {
        // avatarColor field now stores DiceBear style (e.g. "bottts", "pixel-art")
        string memory dicebearUrl = string(abi.encodePacked(
            "https://api.dicebear.com/9.x/", p.avatarColor, "/svg?seed=", p.username
        ));
        return string(abi.encodePacked(
            '<svg width="500" height="500" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
            '<defs>',
            '<linearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="0%">',
            '<stop offset="0%" stop-color="#7B2FFF"/>',
            '<stop offset="100%" stop-color="#00d4ff"/>',
            '</linearGradient>',
            '<linearGradient id="lg" x1="0%" y1="0%" x2="0%" y2="100%">',
            '<stop offset="0%" stop-color="#00d4ff"/>',
            '<stop offset="50%" stop-color="#7B2FFF"/>',
            '<stop offset="100%" stop-color="#5a1fd4"/>',
            '</linearGradient>',
            '<clipPath id="avatarClip">',
            '<circle cx="250" cy="220" r="90"/>',
            '</clipPath>',
            '</defs>',
            '<rect width="500" height="500" fill="#08070f"/>',
            '<rect width="500" height="5" fill="url(#pg)"/>',
            '<rect y="495" width="500" height="5" fill="url(#pg)"/>',
            _buildGrid(),
            _buildTopBar(),
            // Avatar circle background
            '<circle cx="250" cy="220" r="92" fill="#0e0c1a" stroke="#7B2FFF" stroke-width="2"/>',
            // DiceBear avatar image clipped to circle
            '<image href="', dicebearUrl, '" x="160" y="130" width="180" height="180" clip-path="url(#avatarClip)"/>',
            // Username
            '<text x="250" y="345" font-family="Arial Black" font-size="24" font-weight="900" fill="white" text-anchor="middle">', p.username, '.arcade</text>',
            // Creator badge
            '<rect x="175" y="358" width="150" height="24" rx="12" fill="#7B2FFF" fill-opacity="0.2" stroke="#7B2FFF" stroke-width="1"/>',
            '<text x="250" y="374" font-family="Arial" font-size="11" fill="#a67fff" text-anchor="middle" letter-spacing="2">CREATOR</text>',
            // Style label
            '<text x="250" y="420" font-family="Arial" font-size="10" fill="#5533aa" text-anchor="middle">', p.avatarColor, ' style</text>',
            // Footer
            '<text x="250" y="470" font-family="monospace" font-size="10" fill="#3a2a5a" text-anchor="middle">#', tokenId.toString(), ' . BOTChain . ArcadeX</text>',
            _buildLogo(),
            '</svg>'
        ));
    }

    function _buildGrid() internal pure returns (string memory) {
        return '<g opacity="0.05" stroke="#7B2FFF" stroke-width="0.5"><line x1="0" y1="100" x2="500" y2="100"/><line x1="0" y1="200" x2="500" y2="200"/><line x1="0" y1="300" x2="500" y2="300"/><line x1="0" y1="400" x2="500" y2="400"/><line x1="100" y1="0" x2="100" y2="500"/><line x1="200" y1="0" x2="200" y2="500"/><line x1="300" y1="0" x2="300" y2="500"/><line x1="400" y1="0" x2="400" y2="500"/></g>';
    }

    function _buildTopBar() internal pure returns (string memory) {
        return string(abi.encodePacked(
            '<rect x="20" y="20" width="4" height="28" rx="2" fill="#7B2FFF"/>',
            '<text x="32" y="34" font-family="Arial Black" font-size="13" font-weight="900" fill="white">ARCADE</text>',
            '<text x="120" y="34" font-family="Arial Black" font-size="13" font-weight="900" fill="#7B2FFF">X</text>',
            '<text x="32" y="46" font-family="Arial" font-size="7" fill="#5533aa" letter-spacing="2">GAMING PLATFORM</text>',
            '<text x="360" y="34" font-family="Arial" font-size="11" font-weight="700" fill="white">BOT</text>',
            '<text x="388" y="34" font-family="Arial" font-size="11" fill="#10A37F">Chain</text>',
            '<text x="360" y="46" font-family="Arial" font-size="7" fill="#0f6e56" letter-spacing="1">POWERED BY</text>'
        ));
    }

    function _buildLogo() internal pure returns (string memory) {
        return string(abi.encodePacked(
            '<polygon points="250,152 256,166 244,166" fill="url(#lg)"/>',
            '<path d="M234,166 Q226,182 238,196 L250,204 L262,196 Q274,182 266,166 Z" fill="url(#lg)"/>',
            '<ellipse cx="250" cy="240" rx="8" ry="14" fill="url(#lg)"/>',
            '<path d="M234,288 Q226,274 238,260 L250,252 L262,260 Q274,274 266,288 Z" fill="url(#lg)"/>',
            '<polygon points="250,302 256,288 244,288" fill="url(#lg)"/>',
            '<path d="M234,166 Q210,176 214,188 L238,196" fill="url(#lg)" opacity="0.8"/>',
            '<path d="M266,166 Q290,176 286,188 L262,196" fill="url(#lg)" opacity="0.8"/>',
            '<path d="M234,288 Q210,278 214,266 L238,260" fill="url(#lg)" opacity="0.8"/>',
            '<path d="M266,288 Q290,278 286,266 L262,260" fill="url(#lg)" opacity="0.8"/>'
        ));
    }

    function _getInitials(string memory username) internal pure returns (string memory) {
        bytes memory b = bytes(username);
        if (b.length == 0) return "?";
        if (b.length == 1) return string(abi.encodePacked(b[0]));
        bytes memory result = new bytes(2);
        result[0] = b[0];
        result[1] = b[1];
        return string(result);
    }

    /// @notice Check if username available
    function isUsernameAvailable(string memory username) external view returns (bool) {
        return !usernameTaken[username];
    }

    /// @notice Get profile by wallet
    function getProfile(address wallet) external view returns (CreatorProfile memory) {
        uint256 tokenId = walletToToken[wallet];
        require(tokenId != 0, "No creator NFT");
        return profiles[tokenId];
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}