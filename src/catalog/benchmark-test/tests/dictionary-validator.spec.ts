import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { DictionaryValidator } from '../dictionary-validator';
import { CreateBenchmarkTestDto } from '../dto/createBenchmarkTest.dto';

describe('DictionaryValidator', () => {
  const singleFinder = () =>
    jest.fn(
      async ({ where }: { where: { id: string } }): Promise<{ id: string } | null> => ({
        id: where.id,
      })
    );
  const manyFinder = () =>
    jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id }))
    );

  const tx = {
    dictMacroGroup: { findFirst: singleFinder() },
    dictTaskType: { findFirst: singleFinder() },
    dictLanguage: { findFirst: singleFinder() },
    dictDifficulty: { findFirst: singleFinder() },
    dictAbilityTaxon: { findMany: manyFinder() },
    dictModality: { findMany: manyFinder() },
    dictCapability: { findMany: manyFinder() },
    dictDomain: { findMany: manyFinder() },
    dictSubGroup: { findMany: jest.fn() },
    dictSubdomain: { findMany: jest.fn() },
  };

  const validator = new DictionaryValidator();
  const transaction = tx as unknown as Prisma.TransactionClient;
  const payload = (
    overrides: Partial<CreateBenchmarkTestDto> = {}
  ): CreateBenchmarkTestDto =>
    ({
      suiteId: '11111111-1111-4111-8111-111111111111',
      name: 'Тест',
      nameEn: 'Test',
      description: 'Description',
      ...overrides,
    });

  beforeEach(() => {
    jest.clearAllMocks();

    for (const finder of [
      tx.dictMacroGroup.findFirst,
      tx.dictTaskType.findFirst,
      tx.dictLanguage.findFirst,
      tx.dictDifficulty.findFirst,
    ]) {
      finder.mockImplementation(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
      }));
    }

    for (const finder of [
      tx.dictAbilityTaxon.findMany,
      tx.dictModality.findMany,
      tx.dictCapability.findMany,
      tx.dictDomain.findMany,
    ]) {
      finder.mockImplementation(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id }))
      );
    }
  });

  it('does not query dictionaries for omitted references', async () => {
    await expect(validator.validate(transaction, payload())).resolves.toBeUndefined();

    expect(tx.dictMacroGroup.findFirst).not.toHaveBeenCalled();
    expect(tx.dictDomain.findMany).not.toHaveBeenCalled();
    expect(tx.dictSubGroup.findMany).not.toHaveBeenCalled();
    expect(tx.dictSubdomain.findMany).not.toHaveBeenCalled();
  });

  it('rejects a deleted or unknown single dictionary reference', async () => {
    tx.dictTaskType.findFirst.mockResolvedValue(null);

    await expect(
      validator.validate(transaction, payload({ taskTypeId: 'missing-task-type' }))
    ).rejects.toThrow(
      'taskTypeId: dictionary id "missing-task-type" does not exist or is deleted'
    );
  });

  it('reports every missing item from a multi-value dictionary reference', async () => {
    tx.dictDomain.findMany.mockResolvedValue([{ id: 'domain-a' }]);

    await expect(
      validator.validate(transaction, {
        ...payload(),
        domainIds: ['domain-a', 'domain-b', 'domain-c'],
      })
    ).rejects.toThrow(
      'domainIds: dictionary id(s) "domain-b, domain-c" do not exist or are deleted'
    );
  });

  it('deduplicates repeated IDs before checking their existence', async () => {
    await expect(
      validator.validate(transaction, {
        ...payload(),
        domainIds: ['domain-a', 'domain-a'],
      })
    ).resolves.toBeUndefined();

    expect(tx.dictDomain.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['domain-a'] }, deletedAt: null },
      select: { id: true },
    });
  });

  it('requires a macro group whenever subgroups are supplied', async () => {
    await expect(
      validator.validate(transaction, payload({ subGroupIds: ['subgroup-a'] }))
    ).rejects.toThrow(
      'subGroupIds: macroGroupId is required when subGroupIds is non-empty'
    );
  });

  it('rejects missing and cross-parent subgroups', async () => {
    tx.dictSubGroup.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'subgroup-a', macroGroupId: 'another-macro-group' },
      ]);

    const data = payload({
      macroGroupId: 'macro-group',
      subGroupIds: ['subgroup-a', 'subgroup-a'],
    });

    await expect(validator.validate(transaction, data)).rejects.toThrow(
      'subGroupIds: dictionary id(s) "subgroup-a" do not exist or are deleted'
    );
    await expect(validator.validate(transaction, data)).rejects.toThrow(
      'subGroupIds: ids "subgroup-a" do not belong to macroGroupId "macro-group"'
    );
  });

  it('accepts subgroups only when every item belongs to the selected macro group', async () => {
    tx.dictSubGroup.findMany.mockResolvedValue([
      { id: 'subgroup-a', macroGroupId: 'macro-group' },
      { id: 'subgroup-b', macroGroupId: 'macro-group' },
    ]);

    await expect(
      validator.validate(
        transaction,
        payload({
          macroGroupId: 'macro-group',
          subGroupIds: ['subgroup-a', 'subgroup-b'],
        })
      )
    ).resolves.toBeUndefined();
  });

  it('requires domains whenever subdomains are supplied', async () => {
    await expect(
      validator.validate(transaction, payload({ subdomainIds: ['subdomain-a'] }))
    ).rejects.toThrow(
      'subdomainIds: domainIds is required and must be non-empty when subdomainIds is non-empty'
    );
  });

  it('rejects missing and cross-parent subdomains', async () => {
    tx.dictSubdomain.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'subdomain-a', domainId: 'domain-b' }]);

    const data = payload({
      domainIds: ['domain-a'],
      subdomainIds: ['subdomain-a', 'subdomain-a'],
    });

    await expect(validator.validate(transaction, data)).rejects.toThrow(
      'subdomainIds: dictionary id(s) "subdomain-a" do not exist or are deleted'
    );
    await expect(validator.validate(transaction, data)).rejects.toThrow(
      'subdomainIds: ids "subdomain-a" do not belong to any of the supplied domainIds'
    );
  });

  it('accepts subdomains only when every item belongs to an allowed domain', async () => {
    tx.dictSubdomain.findMany.mockResolvedValue([
      { id: 'subdomain-a', domainId: 'domain-a' },
      { id: 'subdomain-b', domainId: 'domain-b' },
    ]);

    await expect(
      validator.validate(
        transaction,
        payload({
          domainIds: ['domain-a', 'domain-b'],
          subdomainIds: ['subdomain-a', 'subdomain-b'],
        })
      )
    ).resolves.toBeUndefined();
  });

  it('surfaces validation failures as client errors', async () => {
    tx.dictDifficulty.findFirst.mockResolvedValue(null);

    await expect(
      validator.validate(transaction, payload({ difficultyId: 'deleted' }))
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
