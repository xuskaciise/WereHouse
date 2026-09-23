"use client"

import { useState, useEffect } from "react"
import { Pencil, Plus, Power, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Combobox } from "@/components/ui/combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useToast } from "@/components/ui/use-toast"
import { useCan } from "@/components/providers/current-user-provider"
import {
  EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH,
  EXPENSE_CATEGORY_NAME_MAX_LENGTH,
} from "@/lib/expense-rules"

interface ExpenseCategory {
  id: string
  name: string
  description: string | null
  isActive: boolean
  _count?: { expenses: number }
}

const NEW_CATEGORY_VALUE = "__new_category__"

async function saveCategory(
  category: { name: string; description: string; isActive?: boolean },
  id?: string
): Promise<ExpenseCategory> {
  const response = await fetch(id ? `/api/expense-categories/${id}` : "/api/expense-categories", {
    method: id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(category),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || "Failed to save category")
  return data
}

export default function ExpensesPage() {
  const { toast } = useToast()
  // Same permissions the API checks (lib/permission-rules.ts).
  const canCreateExpense = useCan("expenses", "create")
  const canViewExpenses = useCan("expenses", "view")
  const canManage = useCan("expense_categories", "create")
  const canEditCategory = useCan("expense_categories", "edit")
  const canDeleteCategory = useCan("expense_categories", "delete")
  const showActions = canEditCategory || canDeleteCategory
  const [expenses, setExpenses] = useState<any[]>([])
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(canViewExpenses ? "expenses" : "categories")
  const [categoryDialog, setCategoryDialog] = useState<{ open: boolean; category: ExpenseCategory | null }>({
    open: false,
    category: null,
  })
  const [deleteTarget, setDeleteTarget] = useState<ExpenseCategory | null>(null)

  useEffect(() => {
    if (canViewExpenses) fetchExpenses()
    else setIsLoading(false)
    fetchExpenseCategories()
  }, [])

  const fetchExpenses = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("/api/expenses")
      if (response.ok) {
        const data = await response.json()
        setExpenses(data || [])
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch expenses",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error fetching expenses:", error)
      toast({
        title: "Error",
        description: "Failed to fetch expenses",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const fetchExpenseCategories = async () => {
    try {
      setCategoriesLoading(true)
      const response = await fetch("/api/expense-categories")
      if (response.ok) {
        const data = await response.json()
        setExpenseCategories(data || [])
      }
    } catch (error) {
      console.error("Error fetching expense categories:", error)
    } finally {
      setCategoriesLoading(false)
    }
  }

  const toggleActive = async (category: ExpenseCategory) => {
    try {
      await saveCategory(
        { name: category.name, description: category.description || "", isActive: !category.isActive },
        category.id
      )
      toast({
        title: category.isActive ? "Category deactivated" : "Category activated",
        description: category.isActive
          ? `"${category.name}" is hidden from new expenses; existing expenses keep it.`
          : `"${category.name}" can be used for new expenses again.`,
      })
      fetchExpenseCategories()
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" })
    }
  }

  const confirmDelete = async () => {
    const category = deleteTarget
    if (!category) return
    setDeleteTarget(null)
    try {
      const response = await fetch(`/api/expense-categories/${category.id}`, { method: "DELETE" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Failed to delete category")
      toast({ title: "Category deleted", description: `"${category.name}" has been deleted.` })
      fetchExpenseCategories()
    } catch (e) {
      toast({
        title: "Cannot delete category",
        description: e instanceof Error ? e.message : "Failed to delete category",
        variant: "destructive",
      })
    }
  }

  const openNewCategory = () => setCategoryDialog({ open: true, category: null })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground">
            Track and manage business expenses
          </p>
        </div>
        {canCreateExpense && (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Expense
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add New Expense</DialogTitle>
              <DialogDescription>
                Record a new business expense
              </DialogDescription>
            </DialogHeader>
            <ExpenseForm
              categories={expenseCategories.filter((c) => c.isActive)}
              canManageCategories={canManage}
              onCategoryCreated={(category) => setExpenseCategories((prev) => [category, ...prev])}
              onGoToCategories={() => {
                setIsDialogOpen(false)
                setActiveTab("categories")
              }}
              onCancel={() => setIsDialogOpen(false)}
              onSuccess={() => {
                setIsDialogOpen(false)
                fetchExpenses()
                fetchExpenseCategories()
              }}
            />
          </DialogContent>
        </Dialog>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          {canViewExpenses && <TabsTrigger value="expenses">Expenses</TabsTrigger>}
          <TabsTrigger value="categories">Expense Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All Expenses</CardTitle>
              <CardDescription>
                List of all recorded expenses
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-muted-foreground">Loading expenses...</div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Payment Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Created By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No expenses found. Click &quot;Add Expense&quot; to record your first expense.
                        </TableCell>
                      </TableRow>
                    ) : (
                      expenses.map((expense) => (
                        <TableRow key={expense.id}>
                          <TableCell className="font-medium">
                            {expense.category?.name || "N/A"}
                          </TableCell>
                          <TableCell>{expense.description}</TableCell>
                          <TableCell>{formatCurrency(expense.amount)}</TableCell>
                          <TableCell>{formatDate(expense.expenseDate)}</TableCell>
                          <TableCell>{expense.paymentMethod}</TableCell>
                          <TableCell>{expense.reference || "-"}</TableCell>
                          <TableCell>{expense.user?.username || expense.user?.name || "N/A"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Expense Categories</CardTitle>
                  <CardDescription>
                    {canManage
                      ? "Manage expense categories for better organization"
                      : "Categories are managed by admins and accountants"}
                  </CardDescription>
                </div>
                {canManage && (
                  <Button onClick={openNewCategory}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Category
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {categoriesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-muted-foreground">Loading categories...</div>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Expenses</TableHead>
                      <TableHead>Status</TableHead>
                      {showActions && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenseCategories.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={showActions ? 5 : 4} className="text-center text-muted-foreground py-8">
                          {canManage
                            ? 'No expense categories yet. Click "Add Category" to create the first one.'
                            : "No expense categories yet. Ask an admin or accountant to create one."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      expenseCategories.map((category) => {
                        const used = category._count?.expenses ?? 0
                        return (
                          <TableRow key={category.id} className={category.isActive ? "" : "text-muted-foreground"}>
                            <TableCell className="font-medium">{category.name}</TableCell>
                            <TableCell>{category.description || "-"}</TableCell>
                            <TableCell className="text-right">{used}</TableCell>
                            <TableCell>
                              <Badge variant={category.isActive ? "success" : "secondary"}>
                                {category.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            {showActions && (
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-0">
                                  {canEditCategory && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title="Edit"
                                      onClick={() => setCategoryDialog({ open: true, category })}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {canEditCategory && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title={category.isActive ? "Deactivate" : "Activate"}
                                      onClick={() => toggleActive(category)}
                                    >
                                      <Power className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {canDeleteCategory && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      title="Delete"
                                      onClick={() => setDeleteTarget(category)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CategoryDialog
        open={categoryDialog.open}
        category={categoryDialog.category}
        onOpenChange={(open) => setCategoryDialog((prev) => ({ ...prev, open }))}
        onSaved={() => {
          setCategoryDialog({ open: false, category: null })
          fetchExpenseCategories()
        }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              {(deleteTarget?._count?.expenses ?? 0) > 0
                ? `This category is used by ${deleteTarget?._count?.expenses} expense(s) and cannot be deleted. Deactivate it instead to hide it from new expenses; existing expenses are kept.`
                : "This category is not used by any expense and will be permanently deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {(deleteTarget?._count?.expenses ?? 0) > 0 ? (
              deleteTarget?.isActive && canEditCategory && (
                <AlertDialogAction
                  onClick={() => {
                    const target = deleteTarget
                    setDeleteTarget(null)
                    if (target) toggleActive(target)
                  }}
                >
                  Deactivate instead
                </AlertDialogAction>
              )
            ) : (
              <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CategoryFields({
  name,
  description,
  onChange,
  idPrefix,
}: {
  name: string
  description: string
  onChange: (patch: { name?: string; description?: string }) => void
  idPrefix: string
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-name`}>Name *</Label>
        <Input
          id={`${idPrefix}-name`}
          value={name}
          maxLength={EXPENSE_CATEGORY_NAME_MAX_LENGTH}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Utilities"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-description`}>Description</Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={description}
          maxLength={EXPENSE_CATEGORY_DESCRIPTION_MAX_LENGTH}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Optional"
          rows={2}
        />
      </div>
    </>
  )
}

function CategoryDialog({
  open,
  category,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  category: ExpenseCategory | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState({ name: "", description: "" })
  const [error, setError] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ name: category?.name ?? "", description: category?.description ?? "" })
      setError("")
    }
  }, [open, category])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError("Category name is required")
      return
    }
    setIsSaving(true)
    setError("")
    try {
      await saveCategory({ name: form.name, description: form.description }, category?.id)
      toast({ title: category ? "Category updated" : "Category created", description: form.name.trim() })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save category")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{category ? "Edit Category" : "Add Category"}</DialogTitle>
          <DialogDescription>Category names must be unique (not case-sensitive).</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <CategoryFields
            idPrefix="category"
            name={form.name}
            description={form.description}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : category ? "Save changes" : "Create Category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ExpenseForm({
  categories,
  canManageCategories,
  onCategoryCreated,
  onGoToCategories,
  onCancel,
  onSuccess,
}: {
  categories: ExpenseCategory[]
  canManageCategories: boolean
  onCategoryCreated: (category: ExpenseCategory) => void
  onGoToCategories: () => void
  onCancel: () => void
  onSuccess: () => void
}) {
  const { toast } = useToast()
  const [formData, setFormData] = useState({
    categoryId: "",
    amount: "",
    description: "",
    expenseDate: new Date().toISOString().split("T")[0],
    paymentMethod: "",
    reference: "",
  })
  const [isSaving, setIsSaving] = useState(false)
  const [newCategory, setNewCategory] = useState<{ name: string; description: string } | null>(null)
  const [newCategoryError, setNewCategoryError] = useState("")
  const [creatingCategory, setCreatingCategory] = useState(false)

  const startNewCategory = () => {
    setNewCategory({ name: "", description: "" })
    setNewCategoryError("")
  }

  const createInlineCategory = async () => {
    if (!newCategory) return
    if (!newCategory.name.trim()) {
      setNewCategoryError("Category name is required")
      return
    }
    setCreatingCategory(true)
    setNewCategoryError("")
    try {
      const category = await saveCategory(newCategory)
      onCategoryCreated(category)
      setFormData((prev) => ({ ...prev, categoryId: category.id }))
      setNewCategory(null)
      toast({ title: "Category created", description: `"${category.name}" is selected.` })
    } catch (e) {
      setNewCategoryError(e instanceof Error ? e.message : "Failed to create category")
    } finally {
      setCreatingCategory(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.categoryId || !formData.amount || !formData.description || !formData.paymentMethod) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields (Category, Amount, Description, Payment Method).",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        toast({
          title: "Expense Created",
          description: "Expense has been successfully recorded.",
        })
        onSuccess()
        // Reset form
        setFormData({
          categoryId: "",
          amount: "",
          description: "",
          expenseDate: new Date().toISOString().split("T")[0],
          paymentMethod: "",
          reference: "",
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to create expense",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error creating expense:", error)
      toast({
        title: "Error",
        description: "Failed to create expense",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const categoryOptions = [
    ...(canManageCategories ? [{ value: NEW_CATEGORY_VALUE, label: "+ New category" }] : []),
    ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="category">Category *</Label>
        {categories.length === 0 && !newCategory && (
          <div className="rounded-md border border-dashed p-3 text-sm">
            {canManageCategories ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  There are no expense categories yet. Create one to record this expense.
                </span>
                <Button type="button" size="sm" onClick={startNewCategory}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create category
                </Button>
              </div>
            ) : (
              <span className="text-muted-foreground">
                There are no expense categories yet. Ask an admin or accountant to create one.{" "}
                <button type="button" className="underline" onClick={onGoToCategories}>
                  View categories
                </button>
              </span>
            )}
          </div>
        )}
        {newCategory ? (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">New category</p>
            <CategoryFields
              idPrefix="inline-category"
              name={newCategory.name}
              description={newCategory.description}
              onChange={(patch) => setNewCategory((prev) => (prev ? { ...prev, ...patch } : prev))}
            />
            {newCategoryError && <p className="text-sm text-destructive">{newCategoryError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setNewCategory(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={createInlineCategory} disabled={creatingCategory}>
                {creatingCategory ? "Creating..." : "Create and select"}
              </Button>
            </div>
          </div>
        ) : (
          (categories.length > 0 || canManageCategories) && (
            <Combobox
              options={categoryOptions}
              value={formData.categoryId}
              onValueChange={(value) => {
                if (value === NEW_CATEGORY_VALUE) startNewCategory()
                else setFormData({ ...formData, categoryId: value })
              }}
              placeholder="Select category"
              searchPlaceholder="Search categories..."
              emptyMessage="No matching categories."
            />
          )
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="amount">Amount *</Label>
          <Input
            id="amount"
            type="number"
            step="0.01"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            required
            placeholder="0.00"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="expenseDate">Date *</Label>
          <Input
            id="expenseDate"
            type="date"
            value={formData.expenseDate}
            onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description *</Label>
        <Input
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          required
          placeholder="Enter expense description"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="paymentMethod">Payment Method *</Label>
          <Select
            value={formData.paymentMethod}
            onValueChange={(value) => setFormData({ ...formData, paymentMethod: value })}
          >
            <SelectTrigger id="paymentMethod">
              <SelectValue placeholder="Select payment method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CASH">Cash</SelectItem>
              <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
              <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
              <SelectItem value="CHECK">Check</SelectItem>
              <SelectItem value="OTHER">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="reference">Reference</Label>
          <Input
            id="reference"
            value={formData.reference}
            onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
            placeholder="Optional reference number"
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Create Expense"}
        </Button>
      </DialogFooter>
    </form>
  )
}
