# EduWarehouse - User Guide

Welcome to the EduWarehouse Inventory Management System! This guide will help you learn how to use the system step by step.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Login](#login)
3. [Dashboard Overview](#dashboard-overview)
4. [Managing Products](#managing-products)
5. [Managing Categories](#managing-categories)
6. [Managing Suppliers](#managing-suppliers)
7. [Managing Customers](#managing-customers)
8. [Managing Warehouses](#managing-warehouses)
9. [Inventory Management](#inventory-management)
10. [Creating Purchase Orders](#creating-purchase-orders)
11. [Creating Sales Orders](#creating-sales-orders)
12. [Recording Payments](#recording-payments)
13. [Managing Expenses](#managing-expenses)
14. [User Management](#user-management)
15. [Settings](#settings)

---

## Getting Started

### What is EduWarehouse?

EduWarehouse is a warehouse and inventory management system designed for educational purposes. It helps you:
- Track products and inventory
- Manage suppliers and customers
- Create purchase and sales orders
- Record payments and expenses
- Monitor stock levels and alerts

---

## Login

### How to Log In

1. Open your web browser
2. Go to the login page
3. Enter your **Username** (e.g., admin, manager, sales)
4. Enter your **Password**
5. Check "Remember me" if you want to stay logged in
6. Click **"Sign In"**

### Demo Credentials

For testing purposes, you can use these accounts:
- **Admin**: username: `admin` / password: `admin123`
- **Manager**: username: `manager` / password: `manager123`
- **Sales**: username: `sales` / password: `sales123`
- **Accountant**: username: `accountant` / password: `accountant123`
- **Student**: username: `student` / password: `student123`

---

## Dashboard Overview

The Dashboard is the first page you see after logging in. It shows:

### Key Information Cards

- **Total Products**: Number of products in your system
- **Total Stock Value**: Total value of all inventory
- **Total Sales**: Total sales amount
- **Total Purchases**: Total purchase amount
- **Low Stock Alert**: Number of products that need restocking

### Charts and Tables

- **Sales vs Purchases Chart**: Shows sales and purchases for the last 6 months
- **Recent Activities**: Latest stock movements
- **Recent Sales**: Latest sales orders

---

## Managing Products

### Adding a New Product

1. Go to **Products** in the left sidebar
2. Click **"Add New Product"** button (top right)
3. Fill in the form:
   - **Product Name** (required): Enter the product name
   - **SKU** (required): Enter a unique product code
   - **Category** (required): Select a category from the dropdown
   - **Description**: Add product description (optional)
   - **Cost Price**: Enter the price you pay to buy this product
   - **Selling Price**: Enter the price you sell this product for
   - **Reorder Level**: Enter the minimum quantity before restocking (e.g., 10)
4. Click **"Create Product"**

### Editing a Product

1. Go to **Products** page
2. Find the product in the table
3. Click the **three dots (⋮)** button on the right
4. Select **"Edit"**
5. Update the information
6. Click **"Update Product"**

### Deleting a Product

1. Go to **Products** page
2. Find the product in the table
3. Click the **three dots (⋮)** button
4. Select **"Delete"**
5. Confirm the deletion

### Searching and Filtering Products

- Use the **search box** to find products by name or SKU
- Use the **category dropdown** to filter by category

---

## Managing Categories

### Adding a Category

1. Go to **Categories** in the left sidebar
2. Click **"Add Category"** button
3. Enter:
   - **Category Name** (required)
   - **Description** (optional)
4. Click **"Create Category"**

### Editing a Category

1. Go to **Categories** page
2. Click **"Edit"** button next to the category
3. Update the information
4. Click **"Update Category"**

### Deleting a Category

1. Go to **Categories** page
2. Click **"Delete"** button next to the category
3. Confirm the deletion

**Note**: You cannot delete a category if it has products assigned to it.

---

## Managing Suppliers

### Adding a Supplier

1. Go to **Suppliers** in the left sidebar
2. Click **"Add Supplier"** button
3. Fill in the form:
   - **Name** (required)
   - **Email** (optional)
   - **Phone** (optional)
   - **Address** (optional)
   - **City** (optional)
   - **State** (optional)
   - **Contact Person** (optional)
4. Click **"Create Supplier"**

### Viewing Supplier Details

1. Go to **Suppliers** page
2. Click the **"Eye" icon** 👁️ next to a supplier
3. View all supplier information in the side panel

### Editing a Supplier

1. Go to **Suppliers** page
2. Click **"Edit"** button next to the supplier
3. Update the information
4. Click **"Update Supplier"**

### Deleting a Supplier

1. Go to **Suppliers** page
2. Click **"Delete"** button next to the supplier
3. Confirm the deletion

**Note**: You cannot delete a supplier if they have purchase orders or payments.

---

## Managing Customers

### Adding a Customer

1. Go to **Customers** in the left sidebar
2. Click **"Add Customer"** button
3. Fill in the form:
   - **Name** (required)
   - **Email** (optional)
   - **Phone** (optional)
   - **Address** (optional)
   - **City** (optional)
   - **State** (optional)
4. Click **"Create Customer"**

### Viewing Customer Details

1. Go to **Customers** page
2. Click the **"Eye" icon** 👁️ next to a customer
3. View customer information and balance

### Editing a Customer

1. Go to **Customers** page
2. Click **"Edit"** button next to the customer
3. Update the information
4. Click **"Update Customer"**

### Deleting a Customer

1. Go to **Customers** page
2. Click **"Delete"** button next to the customer
3. Confirm the deletion

**Note**: You cannot delete a customer if they have sales orders or payments.

---

## Managing Warehouses

### Adding a Warehouse

1. Go to **Warehouses** in the left sidebar
2. Click **"Add Warehouse"** button
3. Fill in the form:
   - **Name** (required)
   - **Code** (required): Unique warehouse code
   - **Address** (optional)
   - **City** (optional)
   - **State** (optional)
   - **Capacity** (optional): Maximum storage capacity
4. Click **"Create Warehouse"**

### Viewing Warehouse Details

1. Go to **Warehouses** page
2. Click on a warehouse card
3. View warehouse details and stock inside

### Editing a Warehouse

1. Go to **Warehouses** page
2. Click **"Edit"** button on the warehouse card
3. Update the information
4. Click **"Update Warehouse"**

### Deleting a Warehouse

1. Go to **Warehouses** page
2. Click **"Delete"** button on the warehouse card
3. Confirm the deletion

---

## Inventory Management

### Viewing Stock

1. Go to **Inventory** → **Stock** in the left sidebar
2. View all products and their stock levels
3. See:
   - Product name
   - Warehouse location
   - Current quantity
   - Reorder level
   - Stock status (In Stock / Low / Out of Stock)

### Adjusting Stock

1. Go to **Inventory** → **Stock**
2. Click **"Adjust Stock"** button
3. Select:
   - **Product**: Choose the product
   - **Warehouse**: Choose the warehouse
   - **Adjustment Type**:
     - **Set**: Set exact quantity
     - **Add**: Add to current quantity
     - **Subtract**: Remove from current quantity
   - **Quantity**: Enter the amount
   - **Reference**: Add a reference number (optional)
4. Click **"Apply Adjustment"**

### Viewing Stock Movements

1. Go to **Inventory** → **Stock Movements**
2. View all stock movements (IN, OUT, TRANSFER, ADJUSTMENT)
3. See who made the change and when

### Low Stock Alerts

1. Go to **Inventory** → **Low Stock**
2. View all products below their reorder level
3. Click **"Create Purchase Order"** to quickly order more stock

---

## Creating Purchase Orders

### Step 1: Create a New Purchase Order

1. Go to **Purchases** in the left sidebar
2. Click **"New Purchase Order"** button
3. Fill in the order details:
   - **Supplier**: Select a supplier (searchable)
   - **Warehouse**: Select destination warehouse
   - **Expected Delivery Date**: Choose a date (optional)
   - **Notes**: Add any notes (optional)

### Step 2: Add Products

1. Click **"Add Item"** button
2. For each product:
   - **Product**: Select a product (searchable)
   - **Quantity**: Enter how many you want to buy
   - **Unit Price**: Enter the cost per unit
   - The **Total** is calculated automatically
3. Click **"Add Item"** again to add more products
4. Click the **trash icon** 🗑️ to remove an item

### Step 3: Review and Save

1. Check the **Order Summary** on the right:
   - Subtotal
   - Tax (8%)
   - Grand Total
2. Choose an option:
   - **"Save as Draft"**: Save for later editing
   - **"Issue Purchase Order"**: Finalize and create the order

### Viewing Purchase Orders

1. Go to **Purchases** page
2. View all purchase orders in the table
3. Click the **Eye icon** 👁️ to view full details

---

## Creating Sales Orders

### Step 1: Create a New Sales Order

1. Go to **Sales** in the left sidebar
2. Click **"New Sales Order"** button
3. Fill in the order details:
   - **Customer**: Select a customer (searchable)
   - **Warehouse**: Select source warehouse
   - **Expected Delivery Date**: Choose a date (optional)

### Step 2: Add Products

1. Click **"Add Another Item"** button
2. For each product:
   - **Product**: Select a product (searchable)
   - **Quantity**: Enter how many to sell
   - The system shows:
     - **Status**: In Stock / Low Stock / Out of Stock
     - **Price**: Selling price (auto-filled)
     - **Total**: Calculated automatically
3. Click **"Add Another Item"** to add more products
4. Click the **trash icon** 🗑️ to remove an item

### Step 3: Review and Save

1. Check the **Live Invoice Preview** on the right
2. Review the totals:
   - Subtotal
   - Tax (5%)
   - Grand Total
3. Choose an option:
   - **"Save Draft"**: Save for later editing
   - **"Finalize & Post"**: Complete the order

**Note**: When you finalize a sales order, the customer's balance increases (they owe you money).

### Viewing Sales Orders

1. Go to **Sales** page
2. View all sales orders in the table
3. Click the **Eye icon** 👁️ to view full details

---

## Recording Payments

### Recording Customer Payments

1. Go to **Payments** in the left sidebar
2. Make sure **"Customer Payments"** tab is selected
3. Click **"Record Payment"** button
4. Fill in the form:
   - **Customer**: Select a customer (shows current balance)
   - **Sales Order** (optional): Link to a specific order
   - **Amount**: Enter payment amount
   - **Payment Date**: Select the date
   - **Payment Method**: Choose (Cash, Bank Transfer, Check, Credit Card, Other)
   - **Reference**: Enter reference number (optional)
   - **Notes**: Add notes (optional)
5. Review the **New Balance After Payment**
6. Click **"Record Payment"**

**Note**: When a customer pays, their balance decreases.

### Recording Supplier Payments

1. Go to **Payments** page
2. Click **"Supplier Payments"** tab
3. Click **"Record Payment"** button
4. Fill in the form (same as customer payment)
5. Click **"Record Payment"**

**Note**: When you pay a supplier, their balance decreases (you owe less).

### Payment Actions

For each payment, you can:
- **View Details**: Click the Eye icon 👁️
- **Print Invoice**: Click the three dots (⋮) → Print Invoice
- **Edit**: Click the three dots (⋮) → Edit
- **Delete**: Click the three dots (⋮) → Delete

---

## Managing Expenses

### Adding an Expense

1. Go to **Expenses** in the left sidebar
2. Make sure **"Expenses"** tab is selected
3. Click **"Add Expense"** button
4. Fill in the form:
   - **Category**: Select an expense category
   - **Description**: Describe the expense
   - **Amount**: Enter the amount
   - **Date**: Select the expense date
   - **Payment Method**: Choose payment method
   - **Reference**: Enter reference number (optional)
5. Click **"Create Expense"**

### Adding Expense Categories

1. Go to **Expenses** page
2. Click **"Categories"** tab
3. Click **"Add Category"** button
4. Enter:
   - **Category Name** (required)
   - **Description** (optional)
5. Click **"Create Category"**

### Editing and Deleting Expenses

- Click **"Edit"** to update an expense
- Click **"Delete"** to remove an expense

---

## User Management

**Note**: Only Admin users can access this section.

### Adding a New User

1. Go to **Users** in the left sidebar
2. Click **"Add New User"** button
3. Fill in the form:
   - **Name**: Full name
   - **Username** (required): Unique username
   - **Password** (required): User's password
   - **Email** (optional)
   - **Role**: Select role (Admin, Warehouse Manager, Sales Officer, Accountant, Student)
4. Click **"Create User"**

### Editing a User

1. Go to **Users** page
2. Click **"Edit"** button next to the user
3. Update the information
4. Leave password blank if you don't want to change it
5. Click **"Update User"**

### Deleting a User

1. Go to **Users** page
2. Click **"Delete"** button next to the user
3. Confirm the deletion

---

## Settings

### Updating System Settings

1. Go to **Settings** in the left sidebar
2. Update any settings:

   **Company Information:**
   - Company Name
   - Company Address
   - Phone, Email, Website

   **Financial Settings:**
   - Default Currency (e.g., USD)
   - Default Tax Rate
   - Sales Tax Rate
   - Purchase Tax Rate

   **Inventory Settings:**
   - Low Stock Threshold

   **Order Settings:**
   - Invoice Prefix
   - Purchase Order Prefix
   - Sales Order Prefix

   **System Settings:**
   - Date Format
   - Timezone

3. Click **"Save Changes"** at the bottom

---

## Tips and Best Practices

### General Tips

1. **Always check stock levels** before creating sales orders
2. **Set appropriate reorder levels** to avoid running out of stock
3. **Record payments promptly** to keep balances accurate
4. **Use searchable dropdowns** - type to find items quickly
5. **Save drafts** if you're not ready to finalize orders

### Understanding Balances

- **Customer Balance**: Positive = customer owes you money, Negative = customer has credit
- **Supplier Balance**: Positive = you owe supplier money, Negative = supplier owes you

### Stock Status Colors

- **Green (In Stock)**: Good quantity available
- **Yellow (Low Stock)**: Below reorder level
- **Red (Out of Stock)**: No stock available

### Navigation Tips

- Use the **left sidebar** to navigate between sections
- The **top navbar** shows your name and role
- Click your name in the top right to **logout**

---

## Common Tasks Quick Reference

### Daily Tasks

1. **Check Dashboard** - Review KPIs and alerts
2. **Check Low Stock** - Review items that need restocking
3. **Create Sales Orders** - Process customer orders
4. **Record Payments** - Record customer and supplier payments

### Weekly Tasks

1. **Review Stock Movements** - Check inventory changes
2. **Create Purchase Orders** - Order new stock
3. **Review Expenses** - Track business expenses
4. **Update Settings** - Adjust system preferences if needed

### Monthly Tasks

1. **Review Reports** - Check sales and purchase reports
2. **Update Product Prices** - Adjust selling prices if needed
3. **Review Customer Balances** - Follow up on outstanding payments
4. **Update User Accounts** - Add or remove users if needed

---

## Getting Help

If you need help:

1. **Check this guide** - Most questions are answered here
2. **Contact your system administrator** - For account or permission issues
3. **Check the Dashboard** - For system status and alerts

---

## Glossary

- **SKU**: Stock Keeping Unit - A unique code for each product
- **Reorder Level**: Minimum quantity before you need to order more
- **Balance**: Amount owed (positive) or credit (negative)
- **Draft**: A saved but not finalized order
- **Finalize**: Complete and confirm an order
- **Stock Movement**: Any change in inventory quantity
- **Purchase Order**: Order to buy products from suppliers
- **Sales Order**: Order to sell products to customers

---

**Last Updated**: 2024

**Version**: 1.0

---

## Quick Start Checklist

For new users, follow these steps to get started:

- [ ] Log in with your credentials
- [ ] Explore the Dashboard
- [ ] Add at least one Category
- [ ] Add at least one Product
- [ ] Add at least one Supplier
- [ ] Add at least one Customer
- [ ] Add at least one Warehouse
- [ ] Adjust stock for a product
- [ ] Create a test Purchase Order
- [ ] Create a test Sales Order
- [ ] Record a test Payment
- [ ] Review the Settings page

Congratulations! You're now ready to use the EduWarehouse system! 🎉
