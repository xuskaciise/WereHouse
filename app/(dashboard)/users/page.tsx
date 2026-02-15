"use client"

import { useState, useEffect } from "react"
import { Plus, MoreVertical, Edit, Trash2, Users, CheckCircle2, XCircle, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { formatDate } from "@/lib/utils"
// Mock users removed - use database API instead
const mockUsers: any[] = []
import { User, Role } from "@/lib/types"
import { useToast } from "@/components/ui/use-toast"
import { bulkApproveUsers, bulkRejectUsers } from "@/app/actions/users"

export default function UsersPage() {
  const { toast } = useToast()
  const [users, setUsers] = useState<any[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [currentUser, setCurrentUser] = useState<{ role: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (typeof window !== "undefined") {
      const userData = localStorage.getItem("user") || sessionStorage.getItem("user")
      if (userData) {
        setCurrentUser(JSON.parse(userData))
      }
    }
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("/api/users")
      if (response.ok) {
        const data = await response.json()
        setUsers(data || [])
      } else {
        const errorData = await response.json().catch(() => ({ error: "Failed to fetch users" }))
        console.error("API Error:", errorData)
        toast({
          title: "Error",
          description: errorData.error || "Failed to fetch users",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      console.error("Error fetching users:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to fetch users. Please check your connection.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Check if current user is admin
  const isAdmin = currentUser?.role === "ADMIN"

  // Count users that can be approved (PENDING + REJECTED)
  const usersToApproveCount = users.filter((u) => u.status === "PENDING" || u.status === "REJECTED").length
  
  // Count users that can be rejected (PENDING + APPROVED)
  const usersToRejectCount = users.filter((u) => u.status === "PENDING" || u.status === "APPROVED").length
  
  // Count pending users for display
  const pendingUsersCount = users.filter((u) => u.status === "PENDING").length

  // Handle bulk approve
  const handleBulkApprove = async () => {
    try {
      console.log("handleBulkApprove called, usersToApproveCount:", usersToApproveCount)
      
      // Check if there are any users to approve (PENDING or REJECTED)
      if (usersToApproveCount === 0) {
        toast({
          title: "No Users to Approve",
          description: "There are no pending or rejected users to approve.",
          variant: "destructive",
        })
        return
      }

      // Try API route first, fallback to server action
      let result
      try {
        const response = await fetch("/api/users/bulk-approve", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        })
        
        if (response.ok) {
          result = await response.json()
        } else {
          throw new Error("API route failed")
        }
      } catch (apiError) {
        console.log("API route failed, trying server action:", apiError)
        result = await bulkApproveUsers()
      }

      console.log("bulkApproveUsers result:", result)
      
      if (result.success) {
        toast({
          title: "Success",
          description: `${result.count} user(s) have been approved.`,
        })
        // Refresh users list after a short delay
        setTimeout(() => {
          fetchUsers()
        }, 500)
      } else {
        console.error("bulkApproveUsers failed:", result.error)
        toast({
          title: "Error",
          description: result.error || "Failed to approve users",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      console.error("Error approving users:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to approve users. Please check the console for details.",
        variant: "destructive",
      })
    }
  }

  // Handle bulk reject
  const handleBulkReject = async () => {
    try {
      console.log("handleBulkReject called, usersToRejectCount:", usersToRejectCount)
      
      // Check if there are any users to reject (PENDING or APPROVED)
      if (usersToRejectCount === 0) {
        toast({
          title: "No Users to Reject",
          description: "There are no pending or approved users to reject.",
          variant: "destructive",
        })
        return
      }

      // Try API route first, fallback to server action
      let result
      try {
        const response = await fetch("/api/users/bulk-reject", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        })
        
        if (response.ok) {
          result = await response.json()
        } else {
          throw new Error("API route failed")
        }
      } catch (apiError) {
        console.log("API route failed, trying server action:", apiError)
        result = await bulkRejectUsers()
      }

      console.log("bulkRejectUsers result:", result)
      
      if (result.success) {
        toast({
          title: "Success",
          description: `${result.count} user(s) have been rejected.`,
        })
        // Refresh users list after a short delay
        setTimeout(() => {
          fetchUsers()
        }, 500)
      } else {
        console.error("bulkRejectUsers failed:", result.error)
        toast({
          title: "Error",
          description: result.error || "Failed to reject users",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      console.error("Error rejecting users:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to reject users. Please check the console for details.",
        variant: "destructive",
      })
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      PENDING: "secondary",
      APPROVED: "default",
      REJECTED: "destructive",
    }
    return (
      <Badge variant={variants[status] || "secondary"}>
        {status}
      </Badge>
    )
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this user?")) {
      return
    }

    try {
      const response = await fetch(`/api/users/${id}`, {
        method: "DELETE",
      })

      if (response.ok) {
        setUsers(users.filter((u) => u.id !== id))
        toast({
          title: "User Deleted",
          description: "User has been successfully deleted.",
        })
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || "Failed to delete user",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error deleting user:", error)
      toast({
        title: "Error",
        description: "Failed to delete user",
        variant: "destructive",
      })
    }
  }

  const handleApproveUser = async (id: string) => {
    try {
      console.log("Approving user:", id)
      const response = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "APPROVED" }),
      })

      if (response.ok) {
        const updatedUser = await response.json()
        console.log("User approved successfully:", updatedUser)
        // Update the user in the list
        setUsers(users.map((u) => (u.id === id ? updatedUser : u)))
        toast({
          title: "User Approved",
          description: "User has been successfully approved.",
        })
        // Refresh the list to ensure consistency
        setTimeout(() => {
          fetchUsers()
        }, 500)
      } else {
        const error = await response.json()
        console.error("Failed to approve user:", error)
        toast({
          title: "Error",
          description: error.error || "Failed to approve user",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      console.error("Error approving user:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to approve user. Please check the console for details.",
        variant: "destructive",
      })
    }
  }

  const handleRejectUser = async (id: string) => {
    try {
      console.log("Rejecting user:", id)
      const response = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "REJECTED" }),
      })

      if (response.ok) {
        const updatedUser = await response.json()
        console.log("User rejected successfully:", updatedUser)
        // Update the user in the list
        setUsers(users.map((u) => (u.id === id ? updatedUser : u)))
        toast({
          title: "User Rejected",
          description: "User has been successfully rejected.",
        })
        // Refresh the list to ensure consistency
        setTimeout(() => {
          fetchUsers()
        }, 500)
      } else {
        const error = await response.json()
        console.error("Failed to reject user:", error)
        toast({
          title: "Error",
          description: error.error || "Failed to reject user",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      console.error("Error rejecting user:", error)
      toast({
        title: "Error",
        description: error.message || "Failed to reject user. Please check the console for details.",
        variant: "destructive",
      })
    }
  }

  const getRoleBadge = (role: Role) => {
    const variants: Record<Role, "default" | "secondary" | "success" | "warning"> = {
      ADMIN: "default",
      WAREHOUSE_MANAGER: "secondary",
      SALES_OFFICER: "success",
      ACCOUNTANT: "warning",
      STUDENT: "secondary",
    }
    return (
      <Badge variant={variants[role] || "default"}>
        {role.replace("_", " ")}
      </Badge>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-96">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You need admin privileges to access this page.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground">
            Manage system users and their roles
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingUser(null)}>
              <Plus className="mr-2 h-4 w-4" />
              Add New User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingUser ? "Edit User" : "Add New User"}
              </DialogTitle>
              <DialogDescription>
                {editingUser
                  ? "Update user information"
                  : "Create a new user account"}
              </DialogDescription>
            </DialogHeader>
            <UserForm
              user={editingUser}
              onSuccess={() => {
                setIsDialogOpen(false)
                setEditingUser(null)
                fetchUsers() // Refresh users list
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Users</CardTitle>
              <CardDescription>
                List of all users in the system ({users.length} total)
                {pendingUsersCount > 0 && ` • ${pendingUsersCount} pending approval`}
                {users.filter((u) => u.status === "REJECTED").length > 0 && ` • ${users.filter((u) => u.status === "REJECTED").length} rejected`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Bulk Actions - Only visible to ADMIN */}
          {isAdmin && (
            <div className="flex items-center gap-2 mb-6 pb-4 border-b">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="default" 
                    size="sm" 
                    className="bg-green-600 hover:bg-green-700"
                    disabled={usersToApproveCount === 0}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Approve All {usersToApproveCount > 0 && `(${usersToApproveCount})`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Approve All Users?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will approve all {usersToApproveCount} pending and rejected user(s). This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBulkApprove} className="bg-green-600 hover:bg-green-700">
                      Approve All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    disabled={usersToRejectCount === 0}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject All {usersToRejectCount > 0 && `(${usersToRejectCount})`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reject All Users?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will reject all {usersToRejectCount} pending and approved user(s). This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBulkReject} className="bg-red-600 hover:bg-red-700">
                      Reject All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading users...</div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No users found. Click "Add New User" to create your first user.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.username || user.email}</TableCell>
                  <TableCell>{getRoleBadge(user.role)}</TableCell>
                  <TableCell>{getStatusBadge(user.status || "PENDING")}</TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell>{formatDate(user.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditingUser(user)
                            setIsDialogOpen(true)
                          }}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        {user.status === "PENDING" && (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleApproveUser(user.id)}
                              className="text-green-600"
                            >
                              <Check className="mr-2 h-4 w-4" />
                              Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleRejectUser(user.id)}
                              className="text-red-600"
                            >
                              <X className="mr-2 h-4 w-4" />
                              Reject
                            </DropdownMenuItem>
                          </>
                        )}
                        {user.status === "REJECTED" && (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleApproveUser(user.id)}
                              className="text-green-600"
                            >
                              <Check className="mr-2 h-4 w-4" />
                              Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleRejectUser(user.id)}
                              className="text-red-600"
                            >
                              <X className="mr-2 h-4 w-4" />
                              Reject
                            </DropdownMenuItem>
                          </>
                        )}
                        {user.status === "APPROVED" && (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleApproveUser(user.id)}
                              className="text-green-600"
                            >
                              <Check className="mr-2 h-4 w-4" />
                              Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleRejectUser(user.id)}
                              className="text-red-600"
                            >
                              <X className="mr-2 h-4 w-4" />
                              Reject
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleDelete(user.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function UserForm({
  user,
  onSuccess,
}: {
  user: User | null
  onSuccess: () => void
}) {
  const { toast } = useToast()
  const [formData, setFormData] = useState({
    name: user?.name || "",
    username: user?.username || user?.email || "",
    password: "",
    role: user?.role || "STUDENT",
  })

  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name || !formData.username) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      })
      return
    }

    if (!user && !formData.password) {
      toast({
        title: "Validation Error",
        description: "Password is required for new users.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)

    try {
      const url = user ? `/api/users/${user.id}` : "/api/users"
      const method = user ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.name,
          username: formData.username,
          password: formData.password || undefined,
          role: formData.role,
        }),
      })

      if (response.ok) {
        toast({
          title: user ? "User Updated" : "User Created",
          description: `${formData.name} has been ${user ? "updated" : "created"} successfully.`,
        })
        onSuccess()
      } else {
        const error = await response.json()
        toast({
          title: "Error",
          description: error.error || `Failed to ${user ? "update" : "create"} user`,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error saving user:", error)
      toast({
        title: "Error",
        description: `Failed to ${user ? "update" : "create"} user`,
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Full Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
          placeholder="John Doe"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">Username *</Label>
        <Input
          id="username"
          type="text"
          value={formData.username}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          required
          placeholder="johndoe"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">
          Password {user ? "(leave blank to keep current)" : "*"}
        </Label>
        <Input
          id="password"
          type="password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          required={!user}
          placeholder={user ? "Enter new password or leave blank" : "Enter password"}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="role">Role *</Label>
        <Select
          value={formData.role}
          onValueChange={(value) =>
            setFormData({ ...formData, role: value as Role })
          }
        >
          <SelectTrigger id="role">
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ADMIN">Admin</SelectItem>
            <SelectItem value="WAREHOUSE_MANAGER">Warehouse Manager</SelectItem>
            <SelectItem value="SALES_OFFICER">Sales Officer</SelectItem>
            <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
            <SelectItem value="STUDENT">Student</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onSuccess} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : user ? "Update" : "Create"} User
        </Button>
      </DialogFooter>
    </form>
  )
}
