"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export default function SettingsPage() {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [currentUser, setCurrentUser] = useState<{ id?: string; role?: string; user_type?: string } | null>(null)
  const [resetConfirmText, setResetConfirmText] = useState("")
  const [resetPassword, setResetPassword] = useState("")
  const [isResettingSystem, setIsResettingSystem] = useState(false)
  const [settings, setSettings] = useState({
    companyName: "",
    companyAddress: "",
    companyPhone: "",
    companyEmail: "",
    companyWebsite: "",
    defaultCurrency: "",
    defaultTaxRate: "",
    salesTaxRate: "",
    purchaseTaxRate: "",
    lowStockThreshold: "",
    dateFormat: "",
    timezone: "",
  })

  useEffect(() => {
    if (typeof window !== "undefined") {
      const userData = localStorage.getItem("user") || sessionStorage.getItem("user")
      if (userData) {
        setCurrentUser(JSON.parse(userData))
      }
    }
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const response = await fetch("/api/settings")
      if (response.ok) {
        const data = await response.json()
        setSettings(data)
      }
    } catch (error) {
      console.error("Error fetching settings:", error)
      toast({
        title: "Error",
        description: "Failed to load settings",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Settings saved successfully",
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to save settings",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error saving settings:", error)
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const normalizeRole = (value?: string) => (value || "").trim().toLowerCase()
  const isAdminUser =
    normalizeRole(currentUser?.role).includes("admin") ||
    normalizeRole(currentUser?.user_type).includes("admin")

  const isTruncateConfirmed = resetConfirmText.trim().toUpperCase() === "TRUNCATE"

  const canSubmitSystemReset =
    isTruncateConfirmed && resetPassword.trim().length > 0 && isAdminUser && !isResettingSystem

  const handleSystemReset = async () => {
    if (!isAdminUser) {
      toast({
        title: "Forbidden",
        description: "Only admin users can perform system reset.",
        variant: "destructive",
      })
      return
    }

    if (!isTruncateConfirmed) {
      toast({
        title: "Confirmation Required",
        description: "Type TRUNCATE in all caps to continue.",
        variant: "destructive",
      })
      return
    }

    if (!resetPassword.trim()) {
      toast({
        title: "Password Required",
        description: "Enter your admin password to continue.",
        variant: "destructive",
      })
      return
    }

    setIsResettingSystem(true)
    try {
      const response = await fetch("/api/admin/system-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": currentUser?.id || "",
          "x-user-role": currentUser?.role || "",
          "x-user-type": currentUser?.user_type || "",
        },
        body: JSON.stringify({
          password: resetPassword,
        }),
      })

      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to reset system data")
      }

      toast({
        title: "System Reset Complete",
        description: "All operational data was truncated successfully. Users were preserved.",
      })
      setResetConfirmText("")
      setResetPassword("")
    } catch (error: any) {
      toast({
        title: "Reset Failed",
        description: error.message || "Could not reset system data.",
        variant: "destructive",
      })
    } finally {
      setIsResettingSystem(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Manage your account settings and preferences
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">Loading settings...</div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
        {/* Company Information */}
        <Card>
          <CardHeader>
            <CardTitle>Company Information</CardTitle>
            <CardDescription>
              Update your company details and contact information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name *</Label>
              <Input
                id="companyName"
                value={settings.companyName}
                onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyAddress">Company Address</Label>
              <Textarea
                id="companyAddress"
                value={settings.companyAddress}
                onChange={(e) => setSettings({ ...settings, companyAddress: e.target.value })}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="companyPhone">Phone</Label>
                <Input
                  id="companyPhone"
                  value={settings.companyPhone}
                  onChange={(e) => setSettings({ ...settings, companyPhone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyEmail">Email</Label>
                <Input
                  id="companyEmail"
                  type="email"
                  value={settings.companyEmail}
                  onChange={(e) => setSettings({ ...settings, companyEmail: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyWebsite">Website</Label>
              <Input
                id="companyWebsite"
                type="url"
                value={settings.companyWebsite}
                onChange={(e) => setSettings({ ...settings, companyWebsite: e.target.value })}
                placeholder="https://example.com"
              />
            </div>
          </CardContent>
        </Card>

        {/* Financial Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Financial Settings</CardTitle>
            <CardDescription>
              Configure currency, tax rates, and financial preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="defaultCurrency">Default Currency *</Label>
                <Input
                  id="defaultCurrency"
                  value={settings.defaultCurrency}
                  onChange={(e) => setSettings({ ...settings, defaultCurrency: e.target.value })}
                  placeholder="USD"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultTaxRate">Default Tax Rate (%)</Label>
                <Input
                  id="defaultTaxRate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={settings.defaultTaxRate}
                  onChange={(e) => setSettings({ ...settings, defaultTaxRate: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="salesTaxRate">Sales Tax Rate (%)</Label>
                <Input
                  id="salesTaxRate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={settings.salesTaxRate}
                  onChange={(e) => setSettings({ ...settings, salesTaxRate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="purchaseTaxRate">Purchase Tax Rate (%)</Label>
                <Input
                  id="purchaseTaxRate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={settings.purchaseTaxRate}
                  onChange={(e) => setSettings({ ...settings, purchaseTaxRate: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inventory Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Inventory Settings</CardTitle>
            <CardDescription>
              Configure inventory management preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="lowStockThreshold">Low Stock Threshold</Label>
              <Input
                id="lowStockThreshold"
                type="number"
                min="0"
                value={settings.lowStockThreshold}
                onChange={(e) => setSettings({ ...settings, lowStockThreshold: e.target.value })}
                placeholder="10"
              />
              <p className="text-sm text-muted-foreground">
                Products below this quantity will be marked as low stock
              </p>
            </div>
          </CardContent>
        </Card>

        {/* System Settings */}
        <Card>
          <CardHeader>
            <CardTitle>System Settings</CardTitle>
            <CardDescription>
              Configure date format, timezone, and system preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dateFormat">Date Format</Label>
                <Input
                  id="dateFormat"
                  value={settings.dateFormat}
                  onChange={(e) => setSettings({ ...settings, dateFormat: e.target.value })}
                  placeholder="MM/DD/YYYY"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  value={settings.timezone}
                  onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                  placeholder="UTC"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              Permanently truncate operational data and reset auto-increment IDs. Users are never deleted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">
              This action will clear warehouses, products, categories, purchases, sales, stock movements, expenses,
              payments, and customers. This cannot be undone.
            </div>

            {!isAdminUser && (
              <p className="text-sm text-destructive">
                Only admin users can access this operation.
              </p>
            )}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={!isAdminUser}>
                  Reset System Data (TRUNCATE)
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm System Reset</AlertDialogTitle>
                  <AlertDialogDescription>
                    Type <span className="font-semibold text-foreground">TRUNCATE</span> in all caps to enable reset.
                    Users table will remain intact.
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="space-y-2">
                  <Label htmlFor="truncate-confirmation">Confirmation</Label>
                  <Input
                    id="truncate-confirmation"
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    placeholder="Type TRUNCATE"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="truncate-password">Admin Password</Label>
                  <Input
                    id="truncate-password"
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="Enter admin password"
                    autoComplete="current-password"
                  />
                </div>

                <AlertDialogFooter>
                  <AlertDialogCancel
                    onClick={() => {
                      setResetConfirmText("")
                      setResetPassword("")
                    }}
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleSystemReset}
                    disabled={!canSubmitSystemReset}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {isResettingSystem ? "Resetting..." : "Confirm Reset"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  )
}
