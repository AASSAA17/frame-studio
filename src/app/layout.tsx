import type { Metadata } from "next";
import Script from "next/script";
import { connection } from "next/server";
import { StudioProvider } from "@/components/studio-provider";
import { db } from "@/lib/db";
import "./globals.css";
export async function generateMetadata(): Promise<Metadata> {
  // Read at request time so an owner can rename the studio without rebuilding.
  await connection();
  const settings = await db.studioSettings
    .findUnique({ where: { id: "studio" }, select: { name: true, city: true } })
    .catch(() => null);
  const name = settings?.name ?? "FRAME STUDIO";
  return {
    title: {
      default: `${name} — пространство для ваших идей`,
      template: `%s · ${name}`,
    },
    description: `${name}${settings?.city ? ` · ${settings.city}` : ""}. Локации, команда и онлайн-бронирование съёмок.`,
  };
}
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <Script id="frame-navigation-guard" strategy="beforeInteractive">
          {`(() => {
            if (window.__framePopGuards) return;
            const guards = new Set();
            window.__framePopGuards = guards;
            window.addEventListener('popstate', (event) => {
              for (const guard of Array.from(guards)) {
                guard(event);
                if (event.cancelBubble) break;
              }
            }, true);
          })();`}
        </Script>
        <StudioProvider>{children}</StudioProvider>
      </body>
    </html>
  );
}
