import { useAccount } from "wagmi";

export default function Wallet() {
  const { address, isConnected } = useAccount();

  return (
    <div>
      {isConnected ? (
        <p>Connected: {address}</p>
      ) : (
        <p>Wallet not connected</p>
      )}
    </div>
  );
}
