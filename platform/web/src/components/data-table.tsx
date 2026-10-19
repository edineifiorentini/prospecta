"use client";

import { useEffect, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function selectionColumn<T>(): ColumnDef<T> {
  return {
    id: "select",
    size: 36,
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Selecionar todos desta página"
        checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox aria-label="Selecionar linha" checked={row.getIsSelected()} disabled={!row.getCanSelect()} onCheckedChange={(v) => row.toggleSelected(!!v)} onClick={(e) => e.stopPropagation()} />
    ),
  };
}

type Props<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  loading?: boolean;
  getRowId: (row: T) => string;
  page?: number;
  pageCount?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  sorting?: SortingState;
  onSortingChange?: (s: SortingState) => void;
  selection?: RowSelectionState;
  onSelectionChange?: (s: RowSelectionState) => void;
  canSelect?: (row: T) => boolean;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  toolbar?: React.ReactNode;
  initialHidden?: VisibilityState;
  className?: string;
};

/** Tabela de dados com paginação no servidor, ordenação, seleção e colunas configuráveis. */
export function DataTable<T>({
  columns,
  data,
  loading,
  getRowId,
  page = 1,
  pageCount = 1,
  total,
  onPageChange,
  sorting,
  onSortingChange,
  selection,
  onSelectionChange,
  canSelect,
  onRowClick,
  empty,
  toolbar,
  initialHidden,
  className,
}: Props<T>) {
  const [visibility, setVisibility] = useState<VisibilityState>(initialHidden ?? {});
  const [localSel, setLocalSel] = useState<RowSelectionState>({});
  const rowSelection = selection ?? localSel;
  useEffect(() => {
    if (!selection) setLocalSel({});
  }, [page, selection]);

  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount,
    state: { rowSelection, columnVisibility: visibility, sorting: sorting ?? [] },
    enableRowSelection: canSelect ? (row) => canSelect(row.original) : true,
    onRowSelectionChange: (u) => {
      const next = typeof u === "function" ? u(rowSelection) : u;
      (onSelectionChange ?? setLocalSel)(next);
    },
    onColumnVisibilityChange: setVisibility,
    onSortingChange: (u) => {
      if (!onSortingChange) return;
      onSortingChange(typeof u === "function" ? u(sorting ?? []) : u);
    },
  });

  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());

  return (
    <div className={cn("card-soft overflow-hidden", className)}>
      {(toolbar || hideable.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {hideable.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  <Columns3 /> Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Mostrar colunas</DropdownMenuLabel>
                {hideable.map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}>
                    {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/40">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort() && !!onSortingChange;
                  const dir = h.column.getIsSorted();
                  return (
                    <TableHead key={h.id} style={{ width: h.column.columnDef.size }} className="h-10 text-xs font-medium text-muted-foreground">
                      {h.isPlaceholder ? null : sortable ? (
                        <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && !data.length ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {table.getVisibleLeafColumns().map((c) => (
                    <TableCell key={c.id}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-40 text-center text-sm text-muted-foreground">
                  {empty ?? "Nenhum registro encontrado."}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className={cn(onRowClick && "cursor-pointer", loading && "opacity-60")}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2.5 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {onPageChange && (
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span className="num">
            {total != null ? `${total.toLocaleString("pt-BR")} registro(s)` : ""}
            {Object.keys(rowSelection).length > 0 && ` · ${Object.keys(rowSelection).length} selecionado(s)`}
          </span>
          <div className="flex items-center gap-1">
            <span className="mr-2 num">
              Página {page} de {Math.max(1, pageCount)}
            </span>
            <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Página anterior">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="Próxima página">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
