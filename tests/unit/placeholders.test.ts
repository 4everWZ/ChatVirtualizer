import { createCollapsedGroupElement } from '@/content/virtualization/placeholders';

describe('collapsed groups', () => {
  test('creates a compact collapsed group with until-found search reservoirs', () => {
    const group = createCollapsedGroupElement({
      groupId: 'group-1',
      records: [
        { recordId: 'record-1', summary: 'Question 1', textCombined: 'Question 1 Answer 1' },
        { recordId: 'record-2', summary: 'Question 2', textCombined: 'Question 2 Answer 2' }
      ]
    });

    expect(group.dataset.groupId).toBe('group-1');
    expect(group.classList.contains('ecv-collapsed-group')).toBe(true);
    expect(group.textContent).toContain('Earlier messages');
    expect(group.textContent).toContain('2');
    expect(group.querySelectorAll('[hidden="until-found"][data-record-id]')).toHaveLength(2);
    expect(group.style.height).not.toBe('824px');
  });
});
