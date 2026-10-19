"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskComposer, TaskList } from "@/components/tasks/task-list";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function TasksPage() {
  const { can } = useSession();
  const [when, setWhen] = useState("all");
  const [scope, setScope] = useState("mine");
  const [status, setStatus] = useState("OPEN");
  const summary = useQuery({ queryKey: ["tasks-summary"], queryFn: () => api<{ overdue: number; today: number; open: number }>("/tasks/summary"), refetchInterval: 60_000 });
  return (
    <>
      <PageHeader
        title="Tarefas"
        description={summary.data ? `${summary.data.open} abertas · ${summary.data.today} para hoje · ${summary.data.overdue} atrasadas` : "Lembretes e próximas atividades comerciais."}
      />
      <div className="mb-4 grid gap-4">
        {can("tasks:write") && <TaskComposer />}
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={when} onValueChange={setWhen}>
            <TabsList>
              <TabsTrigger value="all">Todas</TabsTrigger>
              <TabsTrigger value="overdue">Atrasadas {summary.data?.overdue ? `(${summary.data.overdue})` : ""}</TabsTrigger>
              <TabsTrigger value="today">Hoje</TabsTrigger>
              <TabsTrigger value="upcoming">Próximas</TabsTrigger>
              <TabsTrigger value="nodate">Sem prazo</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="h-8 w-40" aria-label="Escopo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">Minhas tarefas</SelectItem>
              <SelectItem value="all">Toda a equipe</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-36" aria-label="Situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OPEN">Abertas</SelectItem>
              <SelectItem value="DONE">Concluídas</SelectItem>
              <SelectItem value="ALL">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <TaskList query={{ when, scope, status, pageSize: 100 }} />
    </>
  );
}
