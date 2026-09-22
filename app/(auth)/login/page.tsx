import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth-guard"
import { LoginForm } from "./login-form"

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard")
  return <LoginForm />
}
