"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminApi } from "@/lib/admin-api";

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (Array.isArray(val)) return `[Array: ${val.length}]`;
  if (typeof val === "object") return "[Object]";
  const s = String(val);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

export default function DatabasePage() {
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedDoc, setSelectedDoc] = useState<Record<string, unknown> | null>(null);

  const { data: collections = [], isLoading: colsLoading } = useQuery({
    queryKey: ["admin-db-collections"],
    queryFn: adminApi.listDbCollections,
    staleTime: 60_000,
  });

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ["admin-db-docs", selectedCollection, page],
    queryFn: () => adminApi.listDbDocs(selectedCollection!, page),
    enabled: !!selectedCollection,
    staleTime: 30_000,
  });

  const columns = docsData?.items[0] ? Object.keys(docsData.items[0]).slice(0, 8) : [];
  const totalPages = docsData ? Math.ceil(docsData.total / docsData.pageSize) : 1;

  function selectCollection(name: string) {
    setSelectedCollection(name);
    setPage(1);
    setSelectedDoc(null);
  }

  return (
    <div className="flex h-full gap-0 -mx-6 -my-8 md:-mx-10">
      {/* Left panel — collection list */}
      <aside className="w-56 shrink-0 border-r border-border flex flex-col bg-background">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Collections
          </h2>
        </div>
        {colsLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <nav className="flex flex-col overflow-y-auto">
            {collections.map((c) => (
              <button
                key={c.name}
                onClick={() => selectCollection(c.name)}
                className={cn(
                  "flex items-center justify-between px-4 py-2.5 text-sm text-left w-full transition-colors",
                  selectedCollection === c.name
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
                )}
              >
                <span className="truncate">{c.name}</span>
                <span className="ml-2 text-[11px] tabular-nums text-muted-foreground/50">
                  {c.count.toLocaleString()}
                </span>
              </button>
            ))}
          </nav>
        )}
      </aside>

      {/* Right panel — document browser */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!selectedCollection ? (
          <div className="flex flex-1 items-center justify-center flex-col gap-2 text-muted-foreground">
            <Database className="h-10 w-10 opacity-15" />
            <p className="text-sm">Select a collection to browse documents</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <div>
                <h1 className="text-sm font-semibold">{selectedCollection}</h1>
                {docsData && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {docsData.total.toLocaleString()} documents
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded px-2.5 py-1 text-xs border border-border disabled:opacity-40 hover:bg-secondary transition-colors"
                >
                  Prev
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded px-2.5 py-1 text-xs border border-border disabled:opacity-40 hover:bg-secondary transition-colors"
                >
                  Next
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {docsLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !docsData || docsData.items.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  No documents found.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-border bg-secondary/40 text-left">
                      {columns.map((col) => (
                        <th
                          key={col}
                          className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate max-w-[180px]"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {docsData.items.map((doc, i) => (
                      <tr
                        key={i}
                        onClick={() => setSelectedDoc(doc)}
                        className="hover:bg-secondary/20 transition-colors cursor-pointer"
                      >
                        {columns.map((col) => (
                          <td
                            key={col}
                            className="px-4 py-3 font-mono text-xs text-muted-foreground truncate max-w-[200px]"
                          >
                            {formatValue(doc[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* JSON document modal */}
      {selectedDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelectedDoc(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-background shadow-2xl flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <h2 className="font-semibold text-sm">Document</h2>
              <button
                onClick={() => setSelectedDoc(null)}
                className="rounded-full p-1 text-muted-foreground hover:bg-secondary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto p-5">
              <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
                {JSON.stringify(selectedDoc, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
