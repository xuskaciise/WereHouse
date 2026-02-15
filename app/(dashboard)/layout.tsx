"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Navbar } from "@/components/layout/navbar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    // Check authentication on mount and when pathname changes
    const checkAuth = () => {
      if (typeof window !== "undefined") {
        const userData = localStorage.getItem("user") || sessionStorage.getItem("user")
        if (userData) {
          try {
            const user = JSON.parse(userData)
            // Check if user is approved - block PENDING and REJECTED users
            if (user.status === "PENDING") {
              // Clear user data and redirect to login
              localStorage.removeItem("user")
              sessionStorage.removeItem("user")
              setIsAuthenticated(false)
              router.replace("/login?message=pending")
              return
            }
            if (user.status === "REJECTED") {
              // Clear user data and redirect to login
              localStorage.removeItem("user")
              sessionStorage.removeItem("user")
              setIsAuthenticated(false)
              router.replace("/login?message=rejected")
              return
            }
            // User is approved, allow access
            setIsAuthenticated(true)
          } catch (error) {
            // Invalid user data, redirect to login
            setIsAuthenticated(false)
            router.replace("/login")
          }
        } else {
          setIsAuthenticated(false)
          // Only redirect if not already on login page
          if (pathname !== "/login") {
            router.replace("/login")
          }
        }
      }
    }
    
    // Small delay to ensure localStorage is available
    const timer = setTimeout(checkAuth, 100)
    return () => clearTimeout(timer)
  }, [router, pathname])

  // Show loading state while checking authentication
  if (isAuthenticated === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  // Don't render dashboard if not authenticated
  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-y-auto bg-muted/50 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
