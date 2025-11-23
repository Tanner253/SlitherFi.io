import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SolanaWalletProvider } from "./components/WalletProvider";
import { GlobalChat } from "./components/GlobalChat";
// import { DebugConsole } from "./components/DebugConsole"; // Hidden - uncomment for debugging

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SlitherFi | Compete. Slither. Earn.",
  description: "Multiplayer snake game where skill pays. Compete for real USDC prizes on Solana.",
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
          <div className="fixed bottom-4 right-4 z-40">
            <GlobalChat />
          </div>
          {/* <DebugConsole /> */}
        </SolanaWalletProvider>
      </body>
    </html>
  );
}

