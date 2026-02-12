# EduWarehouse - University Inventory Management System

A modern, full-featured warehouse and inventory management system designed for educational purposes. This system helps university business students learn how warehouse and inventory systems work through hands-on experience.

## 🚀 Features

### Authentication
- Role-based login system
- Support for multiple user roles (Admin, Warehouse Manager, Sales Officer, Accountant, Student)

### Dashboard
- Key performance indicators (KPIs)
- Sales vs Purchases chart
- Recent stock movements
- Recent sales overview

### Master Data Management
- **Products**: Full CRUD operations with categories, pricing, and stock tracking
- **Categories**: Organize products by category
- **Suppliers**: Manage supplier contacts and information
- **Customers**: Track customer information and balances
- **Warehouses**: Manage multiple warehouse locations

### Inventory Management
- **Stock Overview**: View stock across all warehouses
- **Stock Movements**: Complete audit log of all inventory movements (IN/OUT/TRANSFER/ADJUSTMENT)
- **Low Stock Alerts**: Identify products below reorder level

### Purchase Management
- Create and manage purchase orders
- Track supplier orders
- Order line items with dynamic calculations
- Order status tracking

### Sales Management
- Create sales orders
- Real-time invoice preview
- Customer order tracking
- Stock availability checking

### Financial Management
- **Payments**: Track customer and supplier payments
- **Expenses**: Record and categorize business expenses
- **Reports**: Comprehensive analytics and reporting

## 🛠️ Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Icons**: Lucide React
- **Charts**: Recharts
- **Future Database**: Prisma + PostgreSQL (Neon) - Ready for integration

## 📁 Project Structure

```
/app
  /(auth)              # Authentication pages
    /login
  /(dashboard)         # Main application pages
    /dashboard
    /products
    /categories
    /suppliers
    /customers
    /warehouses
    /inventory
      /movements
      /low-stock
    /purchases
      /new
    /sales
      /new
    /payments
    /expenses
    /reports
    /settings

/components
  /ui                  # shadcn/ui components
  /layout              # Layout components (Sidebar, Navbar)

/lib
  /types.ts           # TypeScript types (Prisma-ready)
  /mock-data.ts      # Mock data for UI development
  /utils.ts          # Utility functions
```

## 🎨 Design System

- **Color Scheme**: Soft blue, white, and gray theme
- **Components**: Card-based UI with rounded corners and subtle shadows
- **Layout**: Left sidebar navigation with top navbar
- **Responsive**: Mobile-friendly design

## 🚦 Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd wearhouse
```

2. Install dependencies
```bash
npm install
```

3. Run the development server
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### Login

For demo purposes, you can log in with any credentials. The system will redirect you to the dashboard.

## 📊 Database Schema (Future Integration)

The project includes TypeScript types that match the planned Prisma schema:

- `users` - User accounts and roles
- `categories` - Product categories
- `products` - Product catalog
- `suppliers` - Supplier information
- `customers` - Customer information
- `warehouses` - Warehouse locations
- `stock` - Current stock levels
- `stock_movements` - Inventory movement history
- `purchase_orders` - Purchase order management
- `sales_orders` - Sales order management
- `supplier_payments` - Supplier payment tracking
- `customer_payments` - Customer payment tracking
- `stock_transfers` - Inter-warehouse transfers
- `expense_categories` - Expense categorization
- `expenses` - Business expense records

## 🎯 User Roles

- **Admin**: Full system access
- **Warehouse Manager**: Inventory and warehouse management
- **Sales Officer**: Sales order creation and management
- **Accountant**: Financial tracking and reporting
- **Student**: View-only access for learning purposes

## 🔄 Next Steps for Backend Integration

1. Set up Prisma with PostgreSQL (Neon)
2. Create database schema matching the TypeScript types
3. Implement Server Actions for data mutations
4. Add API routes for data fetching
5. Implement authentication with NextAuth.js
6. Add form validation with Zod
7. Set up real-time updates (optional)

## 📝 Notes

- This is a **UI-first** implementation with mock data
- No backend logic is implemented yet
- All data is stored in memory (mock data)
- Ready for seamless Prisma integration
- All components are modular and reusable

## 🤝 Contributing

This is an educational project. Feel free to use it as a learning resource or starting point for your own projects.

## 📄 License

This project is for educational purposes.

---

**Built with ❤️ for educational purposes**
