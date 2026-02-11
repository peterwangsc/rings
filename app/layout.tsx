import type { Metadata } from "next";
import { Bungee, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jumpDisplay = Bungee({
  variable: "--font-jump-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "JUMP MAN",
  description: "3D character rig sandbox",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jumpDisplay.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
