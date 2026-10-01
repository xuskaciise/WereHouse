"use client"

import { createContext, useCallback, useContext, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

// App-wide confirmation dialog (instead of window.confirm / window.prompt):
//   const confirm = useConfirm()
//   if (await confirm({ title, description, destructive: true })) ...
//   const reason = await confirm({ title, reasonLabel: "Reason" })  // string | false

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  /** Ask for a (required) text, e.g. a reason; the promise resolves to it. */
  reasonLabel?: string
}
type Resolve = (value: string | boolean) => void

const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<string | boolean>) | null>(null)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [reason, setReason] = useState("")
  const resolver = useRef<Resolve | null>(null)

  const confirm = useCallback((o: ConfirmOptions) => {
    setOptions(o)
    setReason("")
    return new Promise<string | boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])
  const close = (value: string | boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOptions(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={options !== null} onOpenChange={(open) => !open && close(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{options?.title}</DialogTitle>
            {options?.description && <DialogDescription>{options.description}</DialogDescription>}
          </DialogHeader>
          {options?.reasonLabel && (
            <div className="space-y-1">
              <Label htmlFor="confirm-reason">{options.reasonLabel} *</Label>
              <Input id="confirm-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
            <Button
              variant={options?.destructive ? "destructive" : "default"}
              disabled={!!options?.reasonLabel && !reason.trim()}
              onClick={() => close(options?.reasonLabel ? reason.trim() : true)}
            >
              {options?.confirmLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider")
  return confirm
}
