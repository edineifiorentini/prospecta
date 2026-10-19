import { Queue, type JobsOptions } from "bullmq";
import { bullConnection } from "../lib/redis.ts";

export const QUEUES = {
  search: "search",
  enrichment: "enrichment",
  audit: "audit",
  messaging: "messaging",
  maintenance: "maintenance",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type SearchJobData = { searchJobId: string };
export type EnrichmentJobData = { enrichmentJobId: string };
export type AuditJobData = { auditId: string };
export type MessagingJobData = { messageId: string };
export type MaintenanceJobData = { task: "retention" | "reminders" | "messaging-status" | "stale-jobs" };

const defaults: JobsOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 15_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 2000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

const cache = new Map<string, Queue>();
export function queue(name: QueueName): Queue {
  let q = cache.get(name);
  if (!q) {
    q = new Queue(name, { connection: bullConnection(), defaultJobOptions: defaults });
    cache.set(name, q);
  }
  return q;
}

export const enqueueSearch = (data: SearchJobData) =>
  queue(QUEUES.search).add("search.run", data, { jobId: `search-${data.searchJobId}`, attempts: 1 });

export const enqueueEnrichment = (data: EnrichmentJobData) =>
  queue(QUEUES.enrichment).add("enrichment.run", data, { jobId: `enrich-${data.enrichmentJobId}`, attempts: 2 });

export const enqueueAudit = (data: AuditJobData) =>
  queue(QUEUES.audit).add("audit.run", data, { jobId: `audit-${data.auditId}`, attempts: 1 });

export const enqueueMessage = (data: MessagingJobData) =>
  queue(QUEUES.messaging).add("message.send", data, { jobId: `msg-${data.messageId}`, attempts: 3, backoff: { type: "exponential", delay: 30_000 } });

export async function closeQueues() {
  await Promise.all([...cache.values()].map((q) => q.close()));
  cache.clear();
}
