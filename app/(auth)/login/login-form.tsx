"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { signIn } from "next-auth/react"
import { Lock, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const MIN_PASSWORD_LENGTH = 8

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  pending: "Your account is pending approval. Please wait for an administrator to approve your account before you can log in.",
  rejected: "Your account has been rejected. Please contact an administrator for assistance.",
  rate_limited: "Too many failed attempts. Please wait 15 minutes and try again.",
}

export function LoginForm() {
  const { toast } = useToast()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
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

  // Show a message when redirected here with ?message=pending|rejected
  useEffect(() => {
    const message = new URLSearchParams(window.location.search).get("message")
    if (message && LOGIN_ERROR_MESSAGES[message]) {
      toast({
        title: "Sign-in not possible",
        description: LOGIN_ERROR_MESSAGES[message],
        variant: "destructive",
      })
      window.history.replaceState({}, "", "/login")
    }
  }, [toast])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const result = await signIn("credentials", { username, password, redirect: false })

      if (result?.ok && !result.error) {
        // Full reload so the server layout picks up the new session cookie.
        window.location.href = "/dashboard"
        return
      }

      toast({
        title: "Login Failed",
        description: (result?.code && LOGIN_ERROR_MESSAGES[result.code]) || "Invalid username or password",
        variant: "destructive",
      })
    } catch (error) {
      console.error("Login error:", error)
      toast({
        title: "Login Failed",
        description: "Unable to sign in right now. Please wait a minute and try again.",
        variant: "destructive",
      })
    }
    setIsLoading(false)
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

    if (signUpData.password.length < MIN_PASSWORD_LENGTH) {
      toast({
        title: "Validation Error",
        description: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
        variant: "destructive",
      })
      return
    }

    setIsSigningUp(true)

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: signUpData.name,
          username: signUpData.username,
          password: signUpData.password,
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
              <Image src="/siu_logo.png" alt="SIU Logo" width={48} height={48} className="h-full w-full object-cover" />
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
                        placeholder={`Enter your password (min ${MIN_PASSWORD_LENGTH} characters)`}
                        minLength={MIN_PASSWORD_LENGTH}
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
