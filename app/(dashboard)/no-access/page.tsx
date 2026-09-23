import Link from "next/link"
import { ShieldX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

// Shown when a page is opened that the user's role may not view
// (lib/page-access.ts). Open to every signed-in user.
export default function NoAccessPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <ShieldX className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>No access</CardTitle>
          <CardDescription>
            Your role does not have permission to open this page. If you need it for your work, ask an
            administrator to change your role or its permissions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
