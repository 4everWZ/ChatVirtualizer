import type { QARecord, SearchHit } from '@/shared/contracts';

export function searchRecords(records: QARecord[], rawQuery: string): SearchHit[] {
  const query = normalize(rawQuery);
  if (!query) {
    return [];
  }

  const tokens = query.split(' ');

  return records
    .map((record) => scoreRecord(record, query, tokens))
    .filter((hit): hit is SearchHit => hit !== null)
    .sort((left, right) => right.score - left.score);
}

function scoreRecord(record: QARecord, query: string, tokens: string[]): SearchHit | null {
  const fields: Array<{ kind: SearchHit['matchedIn']; value: string }> = [
    { kind: 'assistant', value: record.textAssistant },
    { kind: 'user', value: record.textUser },
    { kind: 'combined', value: record.textCombined }
  ];

  let bestField: SearchHit['matchedIn'] | null = null;
  let bestScore = 0;
  let snippetSource = '';

  for (const field of fields) {
    const normalizedField = normalize(field.value);
    if (!normalizedField) {
      continue;
    }

    const exactIndex = normalizedField.indexOf(query);
    let score = exactIndex >= 0 ? 100 : 0;
    for (const token of tokens) {
      if (token && normalizedField.includes(token)) {
        score += 10;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestField = field.kind;
      snippetSource = field.value;
    }
  }

  if (!bestField || bestScore === 0) {
    return null;
  }

  return {
    recordId: record.id,
    score: bestScore,
    matchedIn: bestField,
    snippet: createSnippet(snippetSource, query)
  };
}

function createSnippet(source: string, query: string): string {
  const normalizedSource = source.replace(/\s+/g, ' ').trim();
  const index = normalize(normalizedSource).indexOf(query);

  if (index < 0) {
    return normalizedSource.slice(0, 140);
  }

  const start = Math.max(0, index - 30);
  const end = Math.min(normalizedSource.length, index + query.length + 30);
  return normalizedSource.slice(start, end);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}
