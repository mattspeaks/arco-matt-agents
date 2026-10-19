import { useCallback, useSyncExternalStore } from 'react';

// Approval cards render in two places (the chat and the Approvals panel). Everything a card holds before it's
// decided (typed notes, hours, picks, "opened", "working…") lives here, keyed by approval id, so both copies are
// the same card: a change in one shows in the other at once.

const values = new Map<string, unknown>();
const listeners = new Set<() => void>();
const loads = new Map<string, Promise<unknown>>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const emit = () => listeners.forEach((l) => l());

// Fields that should survive a page reload (localStorage is optional: private windows may refuse it).
const PERSISTED = new Set(['opened']);
const storageKey = (key: string) => `arco.card.${key}`;
function readPersisted(key: string): unknown {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}
function writePersisted(key: string, value: unknown) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function getCardValue<T>(approvalId: string, field: string, initial: T): T {
  const key = `${approvalId}:${field}`;
  if (!values.has(key)) {
    const saved = PERSISTED.has(field) ? readPersisted(key) : undefined;
    values.set(key, saved === undefined ? initial : saved);
  }
  return values.get(key) as T;
}

export function setCardValue<T>(approvalId: string, field: string, value: T | ((prev: T) => T), initial?: T) {
  const key = `${approvalId}:${field}`;
  const prev = getCardValue(approvalId, field, initial as T);
  const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value;
  values.set(key, next);
  if (PERSISTED.has(field)) writePersisted(key, next);
  emit();
}

/** Like useState, but shared by every copy of the same approval card. */
export function useCardState<T>(approvalId: string, field: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  getCardValue(approvalId, field, initial); // seed once, so the snapshot is stable
  const value = useSyncExternalStore(subscribe, () => values.get(`${approvalId}:${field}`) as T);
  const set = useCallback((v: T | ((prev: T) => T)) => setCardValue(approvalId, field, v, initial), [approvalId, field]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set];
}

/** Runs a load once per key, however many copies of the card ask for it. */
export function loadOnce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!loads.has(key)) loads.set(key, fn().catch((err) => (loads.delete(key), Promise.reject(err))));
  return loads.get(key) as Promise<T>;
}
