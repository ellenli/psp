import type { Metadata } from "next";
import "./globals.css";

const SITE_NAME = "PlayScore Plus";
const DESCRIPTION =
  "Explore Toronto neighbourhoods by playability, walk, transit, and biking scores, and the places you care about.";

export const metadata: Metadata = {
  // Base for resolving the social-preview image to an absolute URL. Set
  // NEXT_PUBLIC_SITE_URL in .env.local / your host when deploying.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: SITE_NAME,
  description: DESCRIPTION,
  openGraph: {
    title: SITE_NAME,
    description: DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
    locale: "en_CA",
    images: [
      {
        url: "/preview.png",
        width: 1280,
        height: 640,
        alt: "PlayScore Plus — interactive map of Toronto neighbourhood playability scores",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: DESCRIPTION,
    images: ["/preview.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
