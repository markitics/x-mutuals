import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "True Mutuals",
  description: "See who your X connections have in common with anyone you want to meet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
