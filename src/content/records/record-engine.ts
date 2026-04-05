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
        height: measureElements([turn.element]),
        mounted: true,
        stable: false,
        generating: Boolean(turn.generating),
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
    current.generating = current.generating || Boolean(turn.generating);
    current.elements?.push(turn.element);
    current.height = measureElements(current.elements ?? []);
    current.anchorSignature = current.anchorSignature || createAnchorSignature(current.textCombined);
  }

  if (current) {
    finalizeRecord(current);
    records.push(current);
  }

  return records;
}

function finalizeRecord(record: QARecord): void {
  record.stable = record.assistantTurnIds.length > 0 && !record.generating;
  record.textUser = normalizeText(record.textUser);
  record.textAssistant = normalizeText(record.textAssistant);
  record.textCombined = normalizeText(joinText(record.textUser, record.textAssistant));
  record.anchorSignature = record.anchorSignature || createAnchorSignature(record.textCombined);
  record.height = measureElements(record.elements ?? []);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function joinText(left: string, right: string): string {
  return [left, normalizeText(right)].filter(Boolean).join(' ').trim();
}

function measureElements(elements: HTMLElement[]): number {
  const measured = elements.reduce((total, element) => total + element.getBoundingClientRect().height, 0);
  return measured || elements.length * 120;
}

function createAnchorSignature(text: string): string {
  return normalizeText(text).slice(0, 80).toLowerCase();
}
