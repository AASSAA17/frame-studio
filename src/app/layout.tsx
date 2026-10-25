import type { Metadata } from "next";
import { StudioProvider } from "@/components/studio-provider";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "FRAME STUDIO — пространство для ваших идей",
    template: "%s · FRAME STUDIO",
  },
  description:
    "Демонстрационная фотостудия в Астане. Локации, команда и онлайн-бронирование съёмок.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>
        <StudioProvider>{children}</StudioProvider>
      </body>
    </html>
  );
}
