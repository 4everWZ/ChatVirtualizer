export function createRecordId(sessionId: string, index: number): string {
  return `${sessionId}:record:${index}`;
}

export function createPlaceholderId(recordId: string): string {
  return `${recordId}:placeholder`;
}
