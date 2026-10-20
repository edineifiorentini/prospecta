"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { ChecklistKey } from "./content";

export type TourStatus = "active" | "completed" | "dismissed";
export type Onboarding = {
  tour: { status: TourStatus; step: number };
  checklistHidden: boolean;
  checklist: Record<ChecklistKey, { done: boolean; count: number }>;
};
type Patch = { tour?: { status: TourStatus; step: number }; checklistHidden?: boolean };

export const onboardingKey = ["onboarding"] as const;

export function useOnboarding() {
  const qc = useQueryClient();
  const { session } = useSession();
  const query = useQuery({ queryKey: onboardingKey, queryFn: () => api<Onboarding>("/me/onboarding"), staleTime: 30_000, enabled: !!session && !session.mustChangePassword });
  const mutation = useMutation({
    mutationFn: (patch: Patch) => api<Omit<Onboarding, "checklist">>("/me/onboarding", { method: "PATCH", body: patch }),
    // atualização otimista: o tour muda de passo na hora, sem esperar a API
    onMutate: (patch) => {
      qc.setQueryData<Onboarding>(onboardingKey, (old) => (old ? { ...old, ...patch, tour: patch.tour ?? old.tour } : old));
    },
  });
  return {
    data: query.data,
    update: (patch: Patch) => mutation.mutate(patch),
    startTour: (step = 0) => mutation.mutate({ tour: { status: "active", step } }),
  };
}
