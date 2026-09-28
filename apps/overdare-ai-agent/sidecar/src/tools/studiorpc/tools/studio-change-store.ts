// @summary Bounded shared RAM journal, session markers, authorship and temporary detail ranges.

import { randomUUID } from "node:crypto";
import type { EditLogEnvelope } from "./edit-log";

export interface StudioChangeConsumer {
  sessionId: string;
  rootSessionId: string;
  resumed: boolean;
}

export interface StudioChangeStoreLimits {
  maxBytes: number;
  maxRecords: number;
  maxConsumers: number;
  maxIdentities: number;
  maxBatches: number;
}

export interface StudioChangeRead {
  fromSeq: number;
  throughSeq: number;
  envelopes: EditLogEnvelope[];
  gaps: string[];
  batchId?: string;
  acknowledge(): void;
}

interface Marker {
  seq: number;
  gap: boolean;
  active: number;
  batchId?: string;
}
interface JournalRecord {
  seq: number;
  bytes: number;
  envelope?: EditLogEnvelope;
  authorRoot?: string;
  gap?: string;
}
interface BatchDescriptor {
  fromSeq: number;
  throughSeq: number;
  consumer: StudioChangeConsumer;
}

const HISTORY_GAP =
  "Studio change history is no longer fully retained in RAM. Inspect current Studio state before editing.";

export class StudioChangeStore {
  private readonly limits: StudioChangeStoreLimits;
  private readonly epoch = randomUUID();
  private readonly journal: JournalRecord[] = [];
  private readonly consumers = new Map<string, Marker>();
  private readonly identities = new Map<string, { root: string; active: number }>();
  private readonly batches = new Map<string, BatchDescriptor>();
  private sequence = 0;
  private floor = 0;
  private bytes = 0;
  private markersEvicted = false;

  constructor(options: { limits?: Partial<StudioChangeStoreLimits> } = {}) {
    this.limits = {
      maxBytes: 16 * 1024 * 1024,
      maxRecords: 10_000,
      maxConsumers: 4096,
      maxIdentities: 4096,
      maxBatches: 256,
      ...options.limits,
    };
    for (const limit of Object.values(this.limits)) {
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error("Studio change store limits must be positive integers");
    }
  }

  private admit<T extends { active: number }>(map: Map<string, T>, limit: number) {
    if (map.size < limit) return false;
    const candidate = [...map].find(([, value]) => value.active === 0);
    if (!candidate) throw new Error("Studio change session capacity reached; inspect current Studio state.");
    map.delete(candidate[0]);
    return true;
  }

  private marker(consumer: StudioChangeConsumer): Marker {
    let marker = this.consumers.get(consumer.sessionId);
    if (!marker) {
      if (this.admit(this.consumers, this.limits.maxConsumers)) this.markersEvicted = true;
      marker = { seq: this.floor, gap: consumer.resumed || this.floor > 0 || this.markersEvicted, active: 0 };
    }
    this.consumers.delete(consumer.sessionId);
    this.consumers.set(consumer.sessionId, marker);
    return marker;
  }

  registerSession(consumer: StudioChangeConsumer): () => void {
    let identity = this.identities.get(consumer.sessionId);
    if (!identity) {
      this.admit(this.identities, this.limits.maxIdentities);
      identity = { root: consumer.rootSessionId, active: 0 };
    }
    const marker = this.marker(consumer);
    this.identities.delete(consumer.sessionId);
    this.identities.set(consumer.sessionId, identity);
    identity.active++;
    marker.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      identity.active--;
      marker.active--;
    };
  }

  append(envelopes: readonly EditLogEnvelope[]): void {
    for (const envelope of envelopes) {
      const authorRoot =
        envelope.origin?.kind === "mcp" && envelope.origin.sessionId
          ? this.identities.get(envelope.origin.sessionId)?.root
          : undefined;
      this.appendRecord({ envelope, authorRoot, bytes: Buffer.byteLength(JSON.stringify(envelope)) });
    }
  }

  recordGap(reason: string): void {
    const gap = reason.slice(0, 1000);
    this.appendRecord({ gap, bytes: Buffer.byteLength(gap) });
  }

  private appendRecord(record: Omit<JournalRecord, "seq">): void {
    this.journal.push({ ...record, seq: ++this.sequence });
    this.bytes += record.bytes;
    while (this.bytes > this.limits.maxBytes || this.journal.length > this.limits.maxRecords) {
      const removed = this.journal.shift()!;
      this.bytes -= removed.bytes;
      this.floor = removed.seq;
    }
  }

  private visible(record: JournalRecord, consumer: StudioChangeConsumer): boolean {
    const origin = record.envelope?.origin;
    return (
      origin?.kind !== "mcp" ||
      (origin.sessionId !== consumer.sessionId &&
        origin.sessionId !== consumer.rootSessionId &&
        record.authorRoot !== consumer.rootSessionId)
    );
  }

  read(consumer: StudioChangeConsumer): StudioChangeRead {
    const marker = this.marker(consumer);
    const fromSeq = Math.max(marker.seq, this.floor);
    const throughSeq = this.sequence;
    const records = this.journal.filter((record) => record.seq > fromSeq && record.seq <= throughSeq);
    const envelopes = records
      .filter((record) => record.envelope && this.visible(record, consumer))
      .map((record) => record.envelope!);
    const gaps = [...new Set(records.flatMap((record) => (record.gap ? [record.gap] : [])))];
    if (marker.seq < this.floor || marker.gap) gaps.unshift(HISTORY_GAP);
    let batchId: string | undefined;
    if (envelopes.length > 0) {
      batchId = `${this.epoch}:${randomUUID()}`;
      this.batches.set(batchId, { fromSeq, throughSeq, consumer: { ...consumer } });
      while (this.batches.size > this.limits.maxBatches) this.batches.delete(this.batches.keys().next().value!);
      marker.batchId = batchId;
    }
    return {
      fromSeq,
      throughSeq,
      envelopes,
      gaps,
      batchId,
      acknowledge: () => {
        if (this.consumers.get(consumer.sessionId) !== marker) return;
        marker.seq = Math.max(marker.seq, throughSeq);
        marker.gap = false;
      },
    };
  }

  readBatch(id: string, consumer: StudioChangeConsumer): EditLogEnvelope[] {
    const batch = this.batches.get(id);
    if (!batch || batch.fromSeq < this.floor) {
      throw new Error("Studio change batch expired or unavailable after restart. Inspect current Studio state.");
    }
    if (batch.consumer.sessionId !== consumer.sessionId)
      throw new Error("Studio change batch belongs to another consumer");
    return this.journal
      .filter(
        (record) =>
          record.seq > batch.fromSeq &&
          record.seq <= batch.throughSeq &&
          record.envelope &&
          this.visible(record, batch.consumer),
      )
      .map((record) => record.envelope!);
  }

  latestBatch(consumer: StudioChangeConsumer): string | undefined {
    const id = this.consumers.get(consumer.sessionId)?.batchId;
    const batch = id ? this.batches.get(id) : undefined;
    return batch && batch.fromSeq >= this.floor ? id : undefined;
  }
}
