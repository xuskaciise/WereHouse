"use client"

import { Suspense, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"

// Reacts to ?new=1 ("+ New" menu) and ?q= (global search results) on list
// pages. Rendered inside the page; has its own Suspense boundary.
export function UrlActions(props: { onNew?: () => void; onQuery?: (q: string) => void }) {
  return (
    <Suspense>
      <Inner {...props} />
    </Suspense>
  )
}

function Inner({ onNew, onQuery }: { onNew?: () => void; onQuery?: (q: string) => void }) {
  const params = useSearchParams()
  const handlers = useRef({ onNew, onQuery })
  handlers.current = { onNew, onQuery }
  useEffect(() => {
    if (params.get("new") === "1") handlers.current.onNew?.()
    const q = params.get("q")
    if (q !== null) handlers.current.onQuery?.(q)
  }, [params])
  return null
}
