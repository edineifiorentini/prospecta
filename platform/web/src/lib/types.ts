// Tipos espelhando as respostas da API.

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number; pageCount: number };

export type JobStatus = "QUEUED" | "SUBMITTED" | "RUNNING" | "DOWNLOADING" | "IMPORTING" | "COMPLETED" | "FAILED" | "CANCELLED";
export const ACTIVE_STATUSES: JobStatus[] = ["QUEUED", "SUBMITTED", "RUNNING", "DOWNLOADING", "IMPORTING"];

export type SearchProgress = {
  phase?: string;
  message?: string;
  elapsedSec?: number;
  maxTimeSec?: number;
  found?: number;
  processed?: number;
  imported?: number;
  duplicates?: number;
  filteredOut?: number;
  percent?: number;
  updatedAt?: string;
};

export type SearchJob = {
  id: string;
  provider: "OSM_OVERPASS" | "GOOGLE_MAPS_SCRAPER" | "CSV_IMPORT";
  name: string;
  status: JobStatus;
  params?: Record<string, unknown>;
  progress: SearchProgress;
  error: string | null;
  resultCount: number;
  newCount: number;
  duplicateCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy?: string | null;
};

export type Source = { id: string; label: string; license: string; warning: string | null; available: boolean; reason: string | null };

export type CompanySummary = {
  id: string;
  name: string;
  category: string | null;
  website: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
  address: string | null;
  neighborhood?: string | null;
  city: string | null;
  state: string | null;
  rating: number | null;
  reviewCount: number | null;
  sourceUrl?: string | null;
  enrichmentStatus: string;
  status: string;
  _count?: { contacts: number; socialProfiles: number; deals: number };
};

export type SearchResultRow = {
  id: string;
  position: number;
  title: string;
  isNew: boolean;
  matchedBy: string | null;
  companyId: string | null;
  company: CompanySummary | null;
};

export type CompanyList = { id: string; name: string; description: string | null; count: number; createdAt: string; updatedAt: string };
