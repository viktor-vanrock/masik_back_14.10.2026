import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateConversationDto } from './updateConversation.dto';

describe('UpdateConversationDto', () => {
  it('requires a field and accepts false as an explicit pin update', () => {
    expect(validateSync(plainToInstance(UpdateConversationDto, {}))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(UpdateConversationDto, { isPinned: false }))).toHaveLength(0);
  });

  it.each(['isPinned', 'isArchived', 'title'])('rejects null for %s', (field) => {
    const errors = validateSync(plainToInstance(UpdateConversationDto, { [field]: null }));
    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});
