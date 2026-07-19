import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useChain } from "../context/ChainContext";

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

export function useArcadeBalance() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { contracts, rewardType } = useChain(); // Fetching rewardType here
  const ARCADE_TOKEN_ADDRESS = contracts?.token;
  const [balance, setBalance] = useState("0");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address || !publicClient) return;
    
    // For ERC20 chains, we must have a token address
    if (rewardType !== "native" && !ARCADE_TOKEN_ADDRESS) return;

    const fetchBalance = async () => {
      setLoading(true);
      try {
        let raw;
        
        // Dynamic Check: Native vs ERC-20
        if (rewardType === "native") {
          // Native token balance (MSTC)
          raw = await publicClient.getBalance({ address });
        } else {
          // ERC-20 token balance (ARCADE)
          raw = await publicClient.readContract({
            address: ARCADE_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          });
        }

        const formatted = (Number(raw) / 1e18).toFixed(2);
        setBalance(formatted);
      } catch (err) {
        console.error("Balance fetch failed:", err);
        setBalance("0");
      } finally {
        setLoading(false);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [address, isConnected, publicClient, ARCADE_TOKEN_ADDRESS, rewardType]);

  return { balance, loading };
}