import { useSignMessage, useAccount } from "wagmi";

export default function SignMessageButton() {
  const { signMessageAsync } = useSignMessage();
  const { address, isConnected } = useAccount();

  const handleSign = async () => {
    try {
      const signature = await signMessageAsync({
        message: "Hello from Initia 🚀",
        account: address,
      });

      console.log("Signature:", signature);
      alert("Message Signed ✅");
    } catch (err) {
      console.error(err);
      alert("Signing Failed ❌");
    }
  };

  if (!isConnected) return <p>Connect wallet first</p>;

  return (
    <button onClick={handleSign}>
      ✍️ Sign Message
    </button>
  );
}