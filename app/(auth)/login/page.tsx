"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Lock, User, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/components/ui/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Mock users - no database needed
const mockUsers = [
  { username: "admin", password: "admin123", role: "ADMIN" },
  { username: "manager", password: "manager123", role: "WAREHOUSE_MANAGER" },
  { username: "sales", password: "sales123", role: "SALES_OFFICER" },
  { username: "accountant", password: "accountant123", role: "ACCOUNTANT" },
  { username: "student", password: "student123", role: "STUDENT" },
]

export default function LoginPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  
  // Sign up form state
  const [isSignUp, setIsSignUp] = useState(false)
  const [signUpData, setSignUpData] = useState({
    name: "",
    username: "",
    password: "",
    confirmPassword: "",
  })
  const [isSigningUp, setIsSigningUp] = useState(false)

  // Check if user is already logged in and check URL for messages
  useEffect(() => {
    const checkAuth = () => {
      if (typeof window !== "undefined") {
        // Check for status messages in URL
        const urlParams = new URLSearchParams(window.location.search)
        const message = urlParams.get("message")
        
        if (message === "pending") {
          toast({
            title: "Account Pending Approval",
            description: "Your account is pending approval. Please wait for an administrator to approve your account before logging in.",
            variant: "destructive",
          })
          // Clean up URL
          window.history.replaceState({}, "", "/login")
        } else if (message === "rejected") {
          toast({
            title: "Account Rejected",
            description: "Your account has been rejected. Please contact an administrator for assistance.",
            variant: "destructive",
          })
          // Clean up URL
          window.history.replaceState({}, "", "/login")
        }
        
        const userData = localStorage.getItem("user") || sessionStorage.getItem("user")
        if (userData) {
          try {
            const user = JSON.parse(userData)
            // Only redirect if user is approved
            if (user.status === "APPROVED") {
              router.replace("/dashboard")
            } else {
              // Clear invalid user data
              localStorage.removeItem("user")
              sessionStorage.removeItem("user")
            }
          } catch (error) {
            // Invalid user data, clear it
            localStorage.removeItem("user")
            sessionStorage.removeItem("user")
          }
        }
      }
    }
    checkAuth()
  }, [router, toast])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      // Try to authenticate with API first
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      })

      if (response.ok) {
        const user = await response.json()
        
        // Store user in localStorage/sessionStorage
        if (rememberMe) {
          localStorage.setItem("user", JSON.stringify(user))
        } else {
          sessionStorage.setItem("user", JSON.stringify(user))
        }

        toast({
          title: "Login Successful",
          description: `Welcome back, ${user.username}!`,
        })

        // Small delay to ensure storage is set, then redirect
        await new Promise(resolve => setTimeout(resolve, 100))
        window.location.href = "/dashboard"
        return
      } else {
        // Handle API errors
        const error = await response.json()
        setIsLoading(false)
        toast({
          title: "Login Failed",
          description: error.error || "Invalid username or password",
          variant: "destructive",
        })
        return
      }
    } catch (error) {
      console.error("API login error:", error)
      setIsLoading(false)
      toast({
        title: "Login Failed",
        description: "Unable to connect to the server. Please try again later.",
        variant: "destructive",
      })
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    if (!signUpData.name || !signUpData.username || !signUpData.password) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      })
      return
    }

    if (signUpData.password !== signUpData.confirmPassword) {
      toast({
        title: "Validation Error",
        description: "Passwords do not match.",
        variant: "destructive",
      })
      return
    }

    if (signUpData.password.length < 6) {
      toast({
        title: "Validation Error",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      })
      return
    }

    setIsSigningUp(true)

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: signUpData.name,
          username: signUpData.username,
          password: signUpData.password,
          role: "STUDENT", // Default role for new registrations
        }),
      })

      if (response.ok) {
        toast({
          title: "Account Created",
          description: "Your account has been created successfully. Please wait for admin approval before logging in.",
        })
        
        // Reset form
        setSignUpData({
          name: "",
          username: "",
          password: "",
          confirmPassword: "",
        })
        
        // Switch to login tab
        setIsSignUp(false)
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to create account",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error creating account:", error)
      toast({
        title: "Error",
        description: "Failed to create account. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSigningUp(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border bg-white">
              <Image src="/siu-logo.png" alt="SIU Logo" width={48} height={48} className="h-full w-full object-cover" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">Siu Warehouse</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            University Inventory Management System
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{isSignUp ? "Student Register" : "Sign In"}</CardTitle>
            <CardDescription>
              {isSignUp 
                ? "Register as a student to access the system"
                : "Enter your credentials to access the system"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={isSignUp ? "signup" : "login"} onValueChange={(value) => setIsSignUp(value === "signup")}>
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="login">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Student Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="username"
                        type="text"
                        placeholder="Enter your username"
                        className="pl-9"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        autoComplete="username"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        className="pl-9"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        placeholder="Enter your password"
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="remember"
                      checked={rememberMe}
                      onCheckedChange={(checked) => setRememberMe(checked === true)}
                    />
                    <Label
                      htmlFor="remember"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Remember me
                    </Label>
                  </div>

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? "Signing in..." : "Sign In"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name *</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="name"
                        type="text"
                        placeholder="Enter your full name"
                        className="pl-9"
                        value={signUpData.name}
                        onChange={(e) => setSignUpData({ ...signUpData, name: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-username">ID Number *</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="signup-username"
                        type="text"
                        placeholder="131313"
                        className="pl-9"
                        value={signUpData.username}
                        onChange={(e) => setSignUpData({ ...signUpData, username: e.target.value })}
                        required
                        autoComplete="username"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password *</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type="password"
                        className="pl-9"
                        value={signUpData.password}
                        onChange={(e) => setSignUpData({ ...signUpData, password: e.target.value })}
                        required
                        autoComplete="new-password"
                        placeholder="Enter your password (min 6 characters)"
                        minLength={6}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm Password *</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="confirm-password"
                        type="password"
                        className="pl-9"
                        value={signUpData.confirmPassword}
                        onChange={(e) => setSignUpData({ ...signUpData, confirmPassword: e.target.value })}
                        required
                        autoComplete="new-password"
                        placeholder="Confirm your password"
                      />
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground bg-blue-50 p-3 rounded-md">
                    <p className="font-medium mb-1">Note:</p>
                    <p>Your account will be created with PENDING status. An administrator will need to approve your account before you can log in.</p>
                  </div>

                  <Button type="submit" className="w-full" disabled={isSigningUp}>
                    {isSigningUp ? "Registering..." : "Student Register"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
