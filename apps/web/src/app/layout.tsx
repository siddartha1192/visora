import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visora — AI Visual Content Studio",
  description:
    "Orchestrate, generate, enhance, and schedule multi-platform social media visuals with agentic AI.",
};

// Inline script runs before React hydrates to apply the saved theme immediately,
// preventing a flash of the default dark theme on light/grey preference.
const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('visora-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch(e){}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
