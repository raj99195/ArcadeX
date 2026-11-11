// A Platform signature never expires. Persist the exact proof inputs before
// signing so concurrent requests and retries cannot authorize different scores.
const { ethers } = require("ethers");

async function reserveMstProof(db, sessionRef, { score, platformAddress, fallback }) {
  const requested = {
    route: fallback ? "arcade" : "mst",
    score: String(score),
    platformAddress: platformAddress.toLowerCase(),
    ...(fallback && { fallback }),
  };

  return db.runTransaction(async (transaction) => {
    const session = await transaction.get(sessionRef);
    if (!session.exists) return null;
    const data = session.data();
    const expiresAt = data.expiresAt?.toDate?.() || new Date(data.expiresAt);
    if (!(expiresAt.getTime() > Date.now())) return null;

    const existing = data.payoutProof;
    if (existing) {
      return existing.platformAddress === requested.platformAddress && existing.score === requested.score
        ? existing
        : null;
    }
    transaction.update(sessionRef, { payoutProof: requested });
    return requested;
  });
}

async function chooseFallback({ session, rpcUrl, platformAddress, gameId, score }) {
  const address = process.env.MST_FALLBACK_CONTRACT_ADDRESS;
  if (!session.arcadeFallbackEligible || !address) return null;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const platform = new ethers.Contract(platformAddress, [
    "function paused() view returns (bool)",
    "function getGame(uint256) view returns (tuple(uint256 gameId,string name,address creator,string iframeUrl,uint256 rewardRate,uint256 totalPlays,bool isActive))",
    "function gameMinScore(uint256) view returns (uint256)",
    "function playerSharePercent() view returns (uint256)",
    "function creatorSharePercent() view returns (uint256)",
  ], provider);
  const blockTag = await provider.getBlockNumber();
  const [game, balance, paused, minimum, playerShare, creatorShare] = await Promise.all([
    platform.getGame(gameId, { blockTag }), provider.getBalance(platformAddress, blockTag),
    platform.paused({ blockTag }), platform.gameMinScore(gameId, { blockTag }),
    platform.playerSharePercent({ blockTag }), platform.creatorSharePercent({ blockTag }),
  ]);
  if (paused || !game.isActive || BigInt(score) < minimum || balance >= game.rewardRate) return null;
  return {
    address: ethers.getAddress(address),
    creator: game.creator,
    playerReward: String(game.rewardRate * playerShare / 100n),
    creatorReward: String(game.rewardRate * creatorShare / 100n),
    deadline: Math.floor((session.expiresAt?.toDate?.() || new Date(session.expiresAt)).getTime() / 1000),
  };
}

async function signFallback(fallback, { chainId, nonce, player, gameId }) {
  const signer = new ethers.Wallet(process.env.MST_FALLBACK_SIGNER_PRIVATE_KEY);
  const playId = ethers.toBeHex(nonce, 32);
  const digest = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "bytes32", "address", "uint256", "address", "uint256", "uint256", "uint256"],
    [fallback.address, chainId, playId, player, gameId, fallback.creator,
      fallback.playerReward, fallback.creatorReward, fallback.deadline]
  ));
  return { ...fallback, playId, signature: await signer.signMessage(ethers.getBytes(digest)) };
}

exports.reserveMstProof = reserveMstProof;
exports.chooseFallback = chooseFallback;
exports.signFallback = signFallback;

const fallbackEvents = new ethers.Interface([
  "event FallbackClaimed(bytes32 indexed playId,address indexed player,uint256 indexed gameId,uint256 playerReward,uint256 creatorReward)",
]);

async function verifyFallbackReceipt(db, receipt, player, sessionToken) {
  if (typeof sessionToken !== "string" || !/^[\da-f-]{36}$/i.test(sessionToken)) return null;
  const session = (await db.collection("gameSessions").doc(sessionToken).get()).data();
  const payout = session?.payoutProof;
  if (session?.chain !== "mst" || session.player !== player.toLowerCase() || payout?.route !== "arcade") return null;
  const address = payout.fallback.address.toLowerCase();
  if (receipt.to?.toLowerCase() !== address) return null;
  const playId = ethers.id("sess:" + sessionToken);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address) continue;
    const event = fallbackEvents.parseLog(log);
    if (event?.args.playId === playId && event.args.player.toLowerCase() === session.player &&
        String(event.args.gameId) === session.gameId &&
        String(event.args.playerReward) === payout.fallback.playerReward &&
        String(event.args.creatorReward) === payout.fallback.creatorReward) {
      return { args: event.args, score: Number(payout.score) };
    }
  }
  return null;
}

exports.verifyFallbackReceipt = verifyFallbackReceipt;
