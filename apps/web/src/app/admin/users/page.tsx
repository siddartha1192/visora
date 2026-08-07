"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, type AdminUser } from "@/lib/admin-api";
import { Plus, Trash2, ShieldCheck, Crown, AlertCircle, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Add User modal ────────────────────────────────────────────────────────────

function AddUserModal({ onClose, canGrantAdmin }: { onClose: () => void; canGrantAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => adminApi.createUser({ name, email, password, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-elevate-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-semibold">Add User</h2>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
          <Field label="Name">
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={inputCls} />
          </Field>
          <Field label="Email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className={inputCls} />
          </Field>
          <Field label="Password">
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" className={inputCls} />
          </Field>
          {canGrantAdmin ? (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={role === "admin"}
                onChange={(e) => setRole(e.target.checked ? "admin" : "user")}
                className="h-4 w-4 rounded border border-border accent-primary"
              />
              <span className="text-sm">Grant admin access</span>
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">Only root can grant admin access.</p>
          )}
          {error && <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity">
              {mutation.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Users page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);

  const { data: me } = useQuery({ queryKey: ["admin-me"], queryFn: adminApi.me });
  const isRoot = me?.role === "root";

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: adminApi.listUsers,
  });

  const toggleStatus = useMutation({
    mutationFn: (u: AdminUser) =>
      adminApi.updateUser(u.id, { status: u.status === "active" ? "suspended" : "active" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-users"] }); setConfirmDelete(null); },
  });

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Users</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{users.length} account{users.length !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">
            <Plus className="h-4 w-4" /> Add User
          </button>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : users.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => {
                  // Non-root admins can only manage plain user accounts —
                  // matches the server-side rule in admin.controller.ts.
                  const canManage = isRoot || u.role === "user";
                  return (
                    <tr key={u.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="px-4 py-3 font-medium">{u.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleStatus.mutate(u)}
                          disabled={!canManage}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                            u.status === "active"
                              ? "bg-success/15 text-success hover:bg-success/25"
                              : "bg-warning/15 text-warning hover:bg-warning/25",
                          )}
                        >
                          {u.status}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {u.role === "root" ? (
                          <span className="flex items-center gap-1 text-amber-500 text-xs font-medium">
                            <Crown className="h-3.5 w-3.5" /> Root
                          </span>
                        ) : u.role === "admin" ? (
                          <span className="flex items-center gap-1 text-primary text-xs font-medium">
                            <ShieldCheck className="h-3.5 w-3.5" /> Admin
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">User</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setConfirmDelete(u)}
                          disabled={!canManage}
                          className="rounded p-1 text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-30 disabled:hover:text-muted-foreground/40 disabled:cursor-not-allowed"
                          title={canManage ? "Delete user" : "Only root can delete an admin or root account"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} canGrantAdmin={isRoot} />}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setConfirmDelete(null)}>
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-elevate-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold">Delete user?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{confirmDelete.name}</span> ({confirmDelete.email}) will be permanently removed.
            </p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 rounded-lg border border-border py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors">Cancel</button>
              <button
                onClick={() => deleteUser.mutate(confirmDelete.id)}
                disabled={deleteUser.isPending}
                className="flex-1 rounded-lg bg-destructive py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                {deleteUser.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
