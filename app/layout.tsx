import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Siu Warehouse - University Inventory Management System",
  description: "Warehouse and inventory management system for educational purposes",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) inject
          attributes on <body>; this only ignores attribute mismatches on
          this element, not in its children. */}
      <body className={inter.className} suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
