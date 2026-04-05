import { createPlaceholderElement } from '@/content/virtualization/placeholders';

describe('placeholders', () => {
  test('creates an equal-height placeholder with the record id metadata', () => {
    const placeholder = createPlaceholderElement({
      placeholderId: 'placeholder-1',
      recordId: 'record-1',
      height: 824,
      summary: 'Question 1'
    });

    expect(placeholder.dataset.recordId).toBe('record-1');
    expect(placeholder.dataset.placeholderId).toBe('placeholder-1');
    expect(placeholder.style.height).toBe('824px');
    expect(placeholder.hidden).toBe(false);
  });
});
