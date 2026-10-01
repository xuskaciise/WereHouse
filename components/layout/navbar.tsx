"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { signOut } from "next-auth/react"
import { Bell, Menu, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { useCurrentUser } from "@/components/providers/current-user-provider"
import { ROLE_LABELS, can, canOpenPage } from "@/lib/permission-rules"
import { QUICK_ACTIONS } from "@/lib/navigation"
import { formatCurrency } from "@/lib/utils"
import { SidebarContent } from "@/components/layout/sidebar"
import { GlobalSearch } from "@/components/layout/global-search"
import { useAttention } from "@/components/layout/use-attention"

export function Navbar() {
  const user = useCurrentUser()
  const attention = useAttention()
  const [menuOpen, setMenuOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const actions = QUICK_ACTIONS.filter((a) => can(user.permissions, a.module, a.action))
  const alerts = [
    attention.lowStock ? { label: `${attention.lowStock} product(s) at or below the reorder level`, href: "/inventory/low-stock" } : null,
    attention.expiredReservations ? { label: `${attention.expiredReservations} expired reservation(s)`, href: "/sales/reservations" } : null,
    attention.unpaidCosts
      ? { label: `${attention.unpaidCosts} unpaid landed / transfer cost(s) · ${formatCurrency(attention.unpaidCostsAmount ?? 0)}`, href: "/payments?tab=suppliers" }
      : null,
  ].filter(Boolean) as { label: string; href: string }[]
  const initials = (user.name?.trim() || user.username).split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase()

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b bg-background px-3 sm:gap-4 sm:px-6 print:hidden">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
        <Menu className="h-5 w-5" />
      </Button>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Suspense>
            <SidebarContent onNavigate={() => setMenuOpen(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 items-center">
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {actions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Create</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {actions.map((a) => (
                <DropdownMenuItem key={a.href} asChild>
                  <Link href={a.href}>{a.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Needs attention">
              <Bell className="h-5 w-5" />
              {alerts.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Needs attention</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {alerts.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">Nothing needs attention right now.</div>
            ) : (
              alerts.map((a) => (
                <DropdownMenuItem key={a.href} asChild>
                  <Link href={a.href}>{a.label}</Link>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-10 w-10 rounded-full" aria-label="Account">
              <Avatar>
                <AvatarFallback>{initials || "U"}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user.name?.trim() || user.username}</p>
                <p className="text-xs leading-none text-muted-foreground">{ROLE_LABELS[user.role]}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setProfileOpen(true)}>My profile</DropdownMenuItem>
            {canOpenPage(user.permissions, "/settings") && (
              <DropdownMenuItem asChild>
                <Link href="/settings">Settings</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut({ redirectTo: "/login" })}>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </header>
  )
}

/** The user's own profile: default warehouse (unless an admin locked it). */
function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast()
  const user = useCurrentUser()
  const [profile, setProfile] = useState<any | null>(null)
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [warehouseId, setWarehouseId] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    fetch("/api/profile").then(async (r) => {
      if (!r.ok) return
      const p = await r.json()
      setProfile(p)
      setWarehouseId(p.defaultWarehouseId ?? "")
    })
    fetch("/api/warehouses").then(async (r) => r.ok && setWarehouses(await r.json()))
  }, [open])

  const save = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultWarehouseId: warehouseId || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed")
      toast({ title: "Profile saved", description: "The default warehouse applies to new forms." })
      onOpenChange(false)
      // The signed-in user (and its default) is loaded with the page.
      window.location.reload()
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>My profile</DialogTitle>
          <DialogDescription>
            {user.name || user.username} · {ROLE_LABELS[user.role]}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="profile-warehouse">Default warehouse</Label>
          <Select value={warehouseId || "__none"} disabled={!profile || profile.defaultWarehouseLocked} onValueChange={(v) => setWarehouseId(v === "__none" ? "" : v)}>
            <SelectTrigger id="profile-warehouse"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">None (use the last one I picked)</SelectItem>
              {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {profile?.defaultWarehouseLocked ? "Set by an administrator; it cannot be changed here." : "Preselected in sales, purchases and transfers."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {!profile?.defaultWarehouseLocked && <Button disabled={busy || !profile} onClick={save}>Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
