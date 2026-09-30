// Display labels for the chart of accounts (UI only).

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const

export const TYPE_LABEL: Record<string, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expense",
}

export const GROUP_LABEL: Record<string, string> = {
  CASH_AND_BANK: "Cash & bank",
  RECEIVABLE: "Receivables",
  INVENTORY: "Inventory",
  OTHER_ASSET: "Other assets",
  PAYABLE: "Payables",
  TAX: "Tax",
  OTHER_LIABILITY: "Other liabilities",
  EQUITY: "Equity",
  SALES: "Sales",
  SALES_RETURNS: "Sales returns",
  OTHER_INCOME: "Other income",
  COGS: "Cost of goods sold",
  OPERATING_EXPENSE: "Operating expenses",
  LOSS: "Losses",
  OTHER_EXPENSE: "Other expenses",
}

export const GROUPS_OF: Record<string, string[]> = {
  ASSET: ["CASH_AND_BANK", "RECEIVABLE", "INVENTORY", "OTHER_ASSET"],
  LIABILITY: ["PAYABLE", "TAX", "OTHER_LIABILITY"],
  EQUITY: ["EQUITY"],
  INCOME: ["SALES", "SALES_RETURNS", "OTHER_INCOME"],
  EXPENSE: ["COGS", "OPERATING_EXPENSE", "LOSS", "OTHER_EXPENSE"],
}

export const SOURCE_LABEL: Record<string, string> = {
  VALUATION: "Stock valuation",
  PURCHASE_ORDER: "Purchase receipt",
  LANDED_COST: "Landed cost",
  TRANSFER_COST: "Transfer cost",
  SALES_DELIVERY: "Sales delivery",
  SALES_RETURN: "Sales return",
  PURCHASE_RETURN: "Purchase return",
  CUSTOMER_PAYMENT: "Customer payment",
  SUPPLIER_PAYMENT: "Supplier payment",
  EXPENSE: "Expense",
  OPENING_BALANCE: "Opening balance",
}
