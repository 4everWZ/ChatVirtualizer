export function createRecordId(sessionId: string, index: number): string {
  return `${sessionId}:record:${index}`;
}

export function createCollapsedGroupId(sessionId: string, startIndex: number, endIndex: number): string {
  return `${sessionId}:collapsed:${startIndex}-${endIndex}`;
}
