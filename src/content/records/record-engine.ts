import type { QARecord, TurnCandidate } from '@/shared/contracts';
import { createRecordId } from '@/shared/ids';

export type { TurnCandidate } from '@/shared/contracts';

export function buildQaRecordsFromTurns(turns: TurnCandidate[], sessionId: string): QARecord[] {
  const records: QARecord[] = [];
  let current: QARecord | undefined;

  for (const turn of turns) {
    if (turn.role === 'user') {
      if (current) {
        finalizeRecord(current);
        records.push(current);
      }

      current = {
        id: createRecordId(sessionId, records.length),
        index: records.length,
        sessionId,
        userTurnIds: [turn.id],
        assistantTurnIds: [],
        textUser: normalizeText(turn.text),
        textAssistant: '',
        textCombined: normalizeText(turn.text),
        height: estimateHeight([turn.element]),
        mounted: true,
        renderMode: 'live',
        stable: false,
        generating: isTurnBusy(turn),
        anchorSignature: createAnchorSignature(turn.text),
        elements: [turn.element],
        rootElement: null
      };
      continue;
    }

    if (!current) {
      current = {
        id: createRecordId(sessionId, records.length),
        index: records.length,
        sessionId,
        userTurnIds: [],
        assistantTurnIds: [],
        textUser: '',
        textAssistant: '',
        textCombined: '',
        height: 0,
        mounted: true,
        renderMode: 'live',
        stable: false,
        generating: false,
        anchorSignature: createAnchorSignature(turn.text),
        elements: [],
        rootElement: null
      };
    }

    current.assistantTurnIds.push(turn.id);
    current.textAssistant = joinText(current.textAssistant, turn.text);
    current.textCombined = joinText(current.textCombined, turn.text);
    current.generating = current.generating || isTurnBusy(turn);
    current.elements?.push(turn.element);
    current.height = estimateHeight(current.elements ?? []);
    current.anchorSignature = current.anchorSignature || createAnchorSignature(current.textCombined);
  }

  if (current) {
    finalizeRecord(current);
    records.push(current);
  }

  normalizeTailGeneration(records);

  return records;
}

function finalizeRecord(record: QARecord): void {
  record.stable = record.assistantTurnIds.length > 0 && !record.generating;
  record.textUser = normalizeText(record.textUser);
  record.textAssistant = normalizeText(record.textAssistant);
  record.textCombined = normalizeText(joinText(record.textUser, record.textAssistant));
  record.anchorSignature = record.anchorSignature || createAnchorSignature(record.textCombined);
  record.height = estimateHeight(record.elements ?? []);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function joinText(left: string, right: string): string {
  return [left, normalizeText(right)].filter(Boolean).join(' ').trim();
}

function estimateHeight(elements: HTMLElement[]): number {
  if (elements.length === 0) {
    return 0;
  }

  return elements.length * 120;
}

function createAnchorSignature(text: string): string {
  return normalizeText(text).slice(0, 80).toLowerCase();
}

function isTurnBusy(turn: TurnCandidate): boolean {
  return turn.busySignal !== undefined ? turn.busySignal !== 'none' : Boolean(turn.generating);
}

function normalizeTailGeneration(records: QARecord[]): void {
  if (records.length === 0) {
    return;
  }

  let activeTailStart = records.length;

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (!record) {
      continue;
    }

    const isTailUserOnly = index === records.length - 1 && record.assistantTurnIds.length === 0;
    if (!record.generating && !isTailUserOnly) {
      break;
    }

    activeTailStart = index;
  }

  const hasTailGenerating = records.slice(activeTailStart).some((record) => record.generating);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) {
      continue;
    }

    record.generating = hasTailGenerating && index >= activeTailStart && record.generating;
    record.stable = record.assistantTurnIds.length > 0 && !record.generating;
  }
}
