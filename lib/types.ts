// TypeScript types matching future Prisma schema

export type Role = "ADMIN" | "WAREHOUSE_MANAGER" | "SALES_OFFICER" | "ACCOUNTANT" | "STUDENT"

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK"

export type MovementType = "IN" | "OUT" | "TRANSFER" | "ADJUSTMENT"

export type OrderStatus = "PENDING" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED"

export type PaymentStatus = "PENDING" | "PAID" | "PARTIAL" | "OVERDUE"

export interface User {
  id: string
  email: string | null
  name: string
  username: string
  password: string | null
  role: Role
  createdAt: Date
  updatedAt: Date
}

export interface Category {
  id: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Product {
  id: string
  name: string
  sku: string
  description: string | null
  categoryId: string
  category: Category
  costPrice: number
  sellingPrice: number
  reorderLevel: number
  createdAt: Date
  updatedAt: Date
}

export interface Supplier {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  country: string | null
  contactPerson: string | null
  balance: number
  createdAt: Date
  updatedAt: Date
}

export interface Customer {
  id: string
  name: string
  email: string
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  country: string | null
  balance: number
  createdAt: Date
  updatedAt: Date
}

export interface Warehouse {
  id: string
  name: string
  code: string
  address: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  country: string | null
  capacity: number | null
  createdAt: Date
  updatedAt: Date
}

export interface Stock {
  id: string
  productId: string
  product: Product
  warehouseId: string
  warehouse: Warehouse
  quantity: number
  reservedQuantity: number
  status: StockStatus
  createdAt: Date
  updatedAt: Date
}

export interface StockMovement {
  id: string
  productId: string
  product: Product
  warehouseId: string
  warehouse: Warehouse
  type: MovementType
  quantity: number
  reference: string | null
  referenceId: string | null
  notes: string | null
  userId: string
  user: User
  createdAt: Date
}

export interface PurchaseOrder {
  id: string
  orderNumber: string
  supplierId: string
  supplier: Supplier
  warehouseId: string
  warehouse: Warehouse
  orderDate: Date
  expectedDeliveryDate: Date | null
  status: OrderStatus
  subtotal: number
  tax: number
  discount: number
  total: number
  notes: string | null
  userId: string
  user: User
  createdAt: Date
  updatedAt: Date
  items: PurchaseOrderItem[]
}

export interface PurchaseOrderItem {
  id: string
  purchaseOrderId: string
  productId: string
  product: Product
  quantity: number
  unitPrice: number
  subtotal: number
  createdAt: Date
}

export interface SupplierPayment {
  id: string
  supplierId: string
  supplier: Supplier
  purchaseOrderId: string | null
  purchaseOrder: PurchaseOrder | null
  amount: number
  paymentDate: Date
  paymentMethod: string
  reference: string | null
  notes: string | null
  userId: string
  user: User
  createdAt: Date
}

export interface SalesOrder {
  id: string
  orderNumber: string
  customerId: string
  customer: Customer
  warehouseId: string
  warehouse: Warehouse
  orderDate: Date
  expectedDeliveryDate: Date | null
  status: OrderStatus
  subtotal: number
  tax: number
  discount: number
  total: number
  notes: string | null
  userId: string
  user: User
  createdAt: Date
  updatedAt: Date
  items: SalesOrderItem[]
}

export interface SalesOrderItem {
  id: string
  salesOrderId: string
  productId: string
  product: Product
  quantity: number
  unitPrice: number
  subtotal: number
  createdAt: Date
}

export interface CustomerPayment {
  id: string
  customerId: string
  customer: Customer
  salesOrderId: string | null
  salesOrder: SalesOrder | null
  amount: number
  paymentDate: Date
  paymentMethod: string
  reference: string | null
  notes: string | null
  userId: string
  user: User
  createdAt: Date
}

export interface StockTransfer {
  id: string
  transferNumber: string
  fromWarehouseId: string
  fromWarehouse: Warehouse
  toWarehouseId: string
  toWarehouse: Warehouse
  transferDate: Date
  status: OrderStatus
  notes: string | null
  userId: string
  user: User
  createdAt: Date
  updatedAt: Date
  items: StockTransferItem[]
}

export interface StockTransferItem {
  id: string
  stockTransferId: string
  productId: string
  product: Product
  quantity: number
  createdAt: Date
}

export interface ExpenseCategory {
  id: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Expense {
  id: string
  categoryId: string
  category: ExpenseCategory
  amount: number
  description: string
  expenseDate: Date
  paymentMethod: string
  reference: string | null
  userId: string
  user: User
  createdAt: Date
  updatedAt: Date
}
