import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lima's Locações",
  description: "Gestão de Locações e Eventos",
  applicationName: "Lima's Locações",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icones/icone-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icones/icone-512.png", sizes: "512x512", type: "image/png" },
    ],
    // o iOS ignora o manifesto e usa esta tag ao adicionar a tela de inicio
    apple: [{ url: "/icones/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Lima's",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Desenha ate as bordas do aparelho. Sem isso o Safari/PWA reporta
  // env(safe-area-inset-bottom) = 0 e a barra inferior encosta na Home Bar do
  // iPhone — toques na borda caem na area reservada aos gestos do iOS.
  viewportFit: "cover",
  themeColor: "#051094",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
