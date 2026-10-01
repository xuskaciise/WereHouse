"use client"

import { useEffect, useState } from "react"
import type { BadgeKey } from "@/lib/navigation"

// Counts for the menu badges and the attention bell (/api/nav/attention),
// shared by all subscribers and refreshed every minute.

export type Attention = Partial<Record<BadgeKey, number>> & { unpaidCostsAmount?: string }

let current: Attention = {}
const listeners = new Set<(a: Attention) => void>()
let timer: ReturnType<typeof setInterval> | null = null

async function refresh() {
  try {
    const res = await fetch("/api/nav/attention")
    if (!res.ok) return
    current = await res.json()
    listeners.forEach((l) => l(current))
  } catch {
    // offline or signed out: keep the last counts
  }
}

export function refreshAttention() {
  return refresh()
}

export function useAttention(): Attention {
  const [value, setValue] = useState<Attention>(current)
  useEffect(() => {
    listeners.add(setValue)
    if (!timer) {
      refresh()
      timer = setInterval(refresh, 60_000)
    }
    return () => {
      listeners.delete(setValue)
      if (listeners.size === 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }, [])
  return value
}
