import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";

const ARCADE_TOKEN_ADDRESS = import.meta.env.VITE_ARCADE_TOKEN_ADDRESS;

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
  const [balance, setBalance] = useState("0");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address || !publicClient) return;

    const fetchBalance = async () => {
      setLoading(true);
      try {
        const raw = await publicClient.readContract({
          address: ARCADE_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        });

        // 18 decimals — human readable
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
  }, [address, isConnected, publicClient]);

  return { balance, loading };
}