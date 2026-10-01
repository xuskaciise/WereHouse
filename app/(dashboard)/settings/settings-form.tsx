"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { useCurrentUser } from "@/components/providers/current-user-provider"
import { can } from "@/lib/permission-rules"
import { CURRENCIES } from "@/lib/utils"
import { PaymentMethodsCard } from "./payment-methods-card"

export type SettingsSection = "general" | "financial" | "payment-methods" | "inventory"

// Keys saved by each tab (a tab never overwrites another tab's settings).
const SECTION_KEYS: Record<SettingsSection, string[]> = {
  general: ["companyName", "companyAddress", "companyPhone", "companyEmail", "companyWebsite", "paymentTerms", "walkInCustomerId", "dateFormat", "timezone"],
  financial: ["defaultCurrency", "defaultTaxRate", "salesTaxRate", "purchaseTaxRate"],
  "payment-methods": ["paymentMethodConfig"],
  inventory: ["lowStockThreshold", "salesReservationDays"],
}

const SECTION_TITLE: Record<SettingsSection, string> = {
  general: "General",
  financial: "Financial & tax",
  "payment-methods": "Payment methods",
  inventory: "Stock & reservations",
}
const SECTION_DESCRIPTION: Record<SettingsSection, string> = {
  general: "Company details, logo, payment terms and the walk-in customer",
  financial: "Currency and tax rates",
  "payment-methods": "Enabled payment methods and mobile money prefixes",
  inventory: "Low stock threshold and how long confirmed orders hold stock",
}

export function SettingsForm({ section }: { section: SettingsSection }) {
  const show = (s: SettingsSection) => s === section
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  // Logo: null = unchanged, "" = remove, data URL = new image.
  const [logo, setLogo] = useState<string | null>(null)
  const [logoVersion, setLogoVersion] = useState(0)
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([])
  const currentUser = useCurrentUser()
  const [resetConfirmText, setResetConfirmText] = useState("")
  const [resetPassword, setResetPassword] = useState("")
  const [isResettingSystem, setIsResettingSystem] = useState(false)
  // null = unknown / not an admin; false = locked on this server (production).
  const [resetEnabled, setResetEnabled] = useState<boolean | null>(null)
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
    salesReservationDays: "",
    dateFormat: "",
    timezone: "",
    paymentMethodConfig: "",
    paymentTerms: "",
    walkInCustomerId: "",
    hasCompanyLogo: false as boolean,
  })

  useEffect(() => {
    if (section !== "general") return
    fetch("/api/customers").then(async (r) => r.ok && setCustomers(await r.json()))
  }, [section])

  const pickLogo = (file: File | undefined) => {
    if (!file) return
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast({ title: "Logo", description: "Use a PNG, JPEG or WebP image", variant: "destructive" })
      return
    }
    if (file.size > 290_000) {
      toast({ title: "Logo", description: "The image is too large (max. about 300 KB)", variant: "destructive" })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setLogo(String(reader.result))
    reader.readAsDataURL(file)
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  useEffect(() => {
    if (currentUser.role !== "ADMIN") return
    fetch("/api/admin/system-reset")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setResetEnabled(data ? data.enabled === true : false))
      .catch(() => setResetEnabled(false))
  }, [currentUser.role])

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
        body: JSON.stringify({
          ...Object.fromEntries(SECTION_KEYS[section].map((k) => [k, (settings as any)[k] ?? ""])),
          ...(section === "general" && logo !== null && { companyLogo: logo }),
        }),
      })

      if (response.ok) {
        toast({
          title: "Success",
          description: "Settings saved successfully",
        })
        if (logo !== null) {
          setSettings((prev) => ({ ...prev, hasCompanyLogo: logo !== "" }))
          setLogo(null)
          setLogoVersion(Date.now())
        }
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

  // UI hints only; the server enforces the same rules. Saving needs the
  // settings "edit" permission; the system reset is a fixed ADMIN-only operation.
  const canEditSettings = can(currentUser.permissions, "settings", "edit")
  const isAdminUser = currentUser.role === "ADMIN"

  const isTruncateConfirmed = resetConfirmText.trim().toUpperCase() === "TRUNCATE"

  const canSubmitSystemReset =
    isTruncateConfirmed && resetPassword.trim().length > 0 && isAdminUser && resetEnabled === true && !isResettingSystem

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
        description: "All business data was deleted. Users, permissions, settings and landed cost types were kept.",
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
          <h1 className="text-3xl font-bold tracking-tight">{SECTION_TITLE[section]}</h1>
          <p className="text-muted-foreground">
            {SECTION_DESCRIPTION[section]}
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
        <h1 className="text-3xl font-bold tracking-tight">{SECTION_TITLE[section]}</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
        {/* Company Information */}
        {show("general") && <Card>
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
            <div className="space-y-2">
              <Label>Logo (printed on invoices and notes)</Label>
              <div className="flex flex-wrap items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logo ? logo : logo === "" || !settings.hasCompanyLogo ? "/siu_logo.png" : `/api/company/logo?v=${logoVersion}`}
                  alt="Company logo"
                  className="h-16 w-auto rounded border bg-white p-1"
                />
                <Input type="file" accept="image/png,image/jpeg,image/webp" className="max-w-xs" onChange={(e) => pickLogo(e.target.files?.[0])} />
                {(settings.hasCompanyLogo || logo) && logo !== "" && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setLogo("")}>Use default logo</Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to about 300 KB. Saved with “Save Changes”.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentTerms">Payment terms (printed on invoices)</Label>
              <Textarea
                id="paymentTerms"
                rows={2}
                maxLength={300}
                value={settings.paymentTerms}
                onChange={(e) => setSettings({ ...settings, paymentTerms: e.target.value })}
                placeholder="e.g. Payment due on receipt / Net 30 days"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="walkIn">Walk-in customer (counter sales)</Label>
              <Select value={settings.walkInCustomerId || "__auto"} onValueChange={(v) => setSettings({ ...settings, walkInCustomerId: v === "__auto" ? "" : v })}>
                <SelectTrigger id="walkIn"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">Automatic (“Walk-in customer”)</SelectItem>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Preselected in “Sell now”. Walk-in sales must be paid in full at the sale; sales on credit need a named customer.
              </p>
            </div>
          </CardContent>
        </Card>}

        {/* Financial Settings */}
        {show("financial") && <Card>
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
                <Select
                  value={CURRENCIES.includes(settings.defaultCurrency as never) ? settings.defaultCurrency : "USD"}
                  onValueChange={(defaultCurrency) => setSettings({ ...settings, defaultCurrency })}
                >
                  <SelectTrigger id="defaultCurrency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD – US Dollar ($)</SelectItem>
                    <SelectItem value="SOS">SOS – Somali Shilling</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">All amounts in the app are shown in this currency.</p>
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
        </Card>}

        {/* Inventory Settings */}
        {show("inventory") && <Card>
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
            <div className="space-y-2">
              <Label htmlFor="salesReservationDays">Sales reservation (days)</Label>
              <Input
                id="salesReservationDays"
                type="number"
                min="1"
                max="365"
                value={settings.salesReservationDays}
                onChange={(e) => setSettings({ ...settings, salesReservationDays: e.target.value })}
                placeholder="7"
              />
              <p className="text-sm text-muted-foreground">
                A confirmed sales order holds its stock this many days. Expired reservations are listed under Sales →
                Reservations (they are never released automatically).
              </p>
            </div>
          </CardContent>
        </Card>}

        {show("payment-methods") && <PaymentMethodsCard
          value={settings.paymentMethodConfig}
          onChange={(paymentMethodConfig) => setSettings({ ...settings, paymentMethodConfig })}
          disabled={!canEditSettings}
        />}

        {/* System Settings */}
        {show("general") && <Card>
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
        </Card>}

        {/* Danger Zone */}
        {show("general") && <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              Permanently delete all business data. Users, permissions, settings and landed cost types are kept.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">
              This action will clear warehouses, products, categories, suppliers, customers, purchases, landed costs,
              sales, payments, stock, stock movements, transfers, expenses and expense categories. This cannot be undone.
            </div>

            {isAdminUser && resetEnabled === false && (
              <p className="text-sm text-muted-foreground">
                The system reset is locked on this server (ALLOW_SYSTEM_RESET is not enabled). Production data resets
                are done by the operator with a verified backup (scripts/reset/reset-test-data.sh).
              </p>
            )}

            {!isAdminUser && (
              <p className="text-sm text-destructive">
                Only admin users can access this operation.
              </p>
            )}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" disabled={!isAdminUser || resetEnabled !== true}>
                  Reset System Data (TRUNCATE)
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm System Reset</AlertDialogTitle>
                  <AlertDialogDescription>
                    Type <span className="font-semibold text-foreground">TRUNCATE</span> in all caps to enable reset.
                    Users, permissions and settings will remain intact.
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
        </Card>}

        <div className="flex justify-end">
          <Button type="submit" disabled={isSaving || !canEditSettings} title={canEditSettings ? undefined : "Your role cannot change settings"}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  )
}
