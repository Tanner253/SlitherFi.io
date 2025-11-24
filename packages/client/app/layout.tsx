import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SolanaWalletProvider } from "./components/WalletProvider";
// import { DebugConsole } from "./components/DebugConsole"; // Hidden - uncomment for debugging

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SnekFi.io | Play. Slither. Earn.",
  description: "SnekFi: The ultimate crypto snake arena. Slither through the jungle, devour rivals, and claim real USDC prizes. Play free hourly tournaments or enter paid battles for bigger stakes. 80% pot goes to the winner. Instant Solana payouts. No luck, pure skill.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SolanaWalletProvider>
          {children}
          {/* <DebugConsole /> */}
        </SolanaWalletProvider>
      </body>
    </html>
  );
}

