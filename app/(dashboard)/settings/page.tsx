"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/components/ui/use-toast"

export default function SettingsPage() {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
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

        <div className="flex justify-end">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  )
}
