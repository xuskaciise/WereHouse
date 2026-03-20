import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const settings = await prisma.setting.findMany()
    
    // Convert array to object for easier access
    const settingsObj: Record<string, string> = {}
    settings.forEach((setting) => {
      settingsObj[setting.key] = setting.value
    })

    // Set defaults if not found
    const defaultSettings = {
      companyName: settingsObj.companyName || "Siu Warehouse",
      companyAddress: settingsObj.companyAddress || "",
      companyPhone: settingsObj.companyPhone || "",
      companyEmail: settingsObj.companyEmail || "",
      companyWebsite: settingsObj.companyWebsite || "",
      defaultCurrency: settingsObj.defaultCurrency || "USD",
      defaultTaxRate: settingsObj.defaultTaxRate || "8",
      salesTaxRate: settingsObj.salesTaxRate || "5",
      purchaseTaxRate: settingsObj.purchaseTaxRate || "8",
      lowStockThreshold: settingsObj.lowStockThreshold || "10",
      dateFormat: settingsObj.dateFormat || "MM/DD/YYYY",
      timezone: settingsObj.timezone || "UTC",
    }

    return NextResponse.json(defaultSettings)
  } catch (error) {
    console.error("Error fetching settings:", error)
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    
    // Use transaction to update all settings
    await prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(body)) {
        await tx.setting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      }
    })

    return NextResponse.json({ message: "Settings updated successfully" })
  } catch (error: any) {
    console.error("Error updating settings:", error)
    return NextResponse.json(
      { error: error.message || "Failed to update settings" },
      { status: 500 }
    )
  }
}
