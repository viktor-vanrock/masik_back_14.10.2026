import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { CreateBenchmarkTestDto } from './dto/createBenchmarkTest.dto';
import { UpdateBenchmarkTestDto } from './dto/updateBenchmarkTest.dto';

type DictRowWithId = { id: string };

/**
 * Validates dictionary FK references in a BenchmarkTest write payload.
 *
 * Two kinds of checks (per ticket §4.12):
 *  1. **Existence**: every supplied id must point to an active row in the
 *     matching `taxonomy_*` table. Missing ids are echoed in the error.
 *  2. **Parent-child consistency**:
 *     - if `subGroupIds` non-empty → `macroGroupId` required and every
 *       referenced sub-group must have `macroGroupId === dto.macroGroupId`;
 *     - if `subdomainIds` non-empty → `domainIds` non-empty and every
 *       referenced subdomain must have `domainId ∈ dto.domainIds`.
 *
 * Runs inside the caller's `$transaction` so the validation snapshot matches
 * the write. Each finder closes over its concrete Prisma delegate to keep
 * the per-table types intact (no `any`, no `as` casts).
 */
@Injectable()
export class DictionaryValidator {
  async validate(
    tx: Prisma.TransactionClient,
    dto: CreateBenchmarkTestDto | UpdateBenchmarkTestDto
  ): Promise<void> {
    await Promise.all([
      this.assertSingleFk(
        (id) =>
          tx.dictMacroGroup.findFirst({
            where: { id, deletedAt: null },
            select: { id: true },
          }),
        dto.macroGroupId,
        'macroGroupId'
      ),
      this.assertSingleFk(
        (id) =>
          tx.dictTaskType.findFirst({
            where: { id, deletedAt: null },
            select: { id: true },
          }),
        dto.taskTypeId,
        'taskTypeId'
      ),
      this.assertSingleFk(
        (id) =>
          tx.dictLanguage.findFirst({
            where: { id, deletedAt: null },
            select: { id: true },
          }),
        dto.languageId,
        'languageId'
      ),
      this.assertSingleFk(
        (id) =>
          tx.dictDifficulty.findFirst({
            where: { id, deletedAt: null },
            select: { id: true },
          }),
        dto.difficultyId,
        'difficultyId'
      ),
      this.assertManyFk(
        (ids) =>
          tx.dictAbilityTaxon.findMany({
            where: { id: { in: ids }, deletedAt: null },
            select: { id: true },
          }),
        dto.abilityTaxonIds,
        'abilityTaxonIds'
      ),
      this.assertManyFk(
        (ids) =>
          tx.dictModality.findMany({
            where: { id: { in: ids }, deletedAt: null },
            select: { id: true },
          }),
        dto.modalityIds,
        'modalityIds'
      ),
      this.assertManyFk(
        (ids) =>
          tx.dictCapability.findMany({
            where: { id: { in: ids }, deletedAt: null },
            select: { id: true },
          }),
        dto.capabilityIds,
        'capabilityIds'
      ),
      this.assertManyFk(
        (ids) =>
          tx.dictDomain.findMany({
            where: { id: { in: ids }, deletedAt: null },
            select: { id: true },
          }),
        dto.domainIds,
        'domainIds'
      ),
    ]);

    await this.assertSubGroupConsistency(tx, dto);
    await this.assertSubdomainConsistency(tx, dto);
  }

  private async assertSingleFk(
    finder: (id: string) => Promise<DictRowWithId | null>,
    id: string | null | undefined,
    fieldName: string
  ): Promise<void> {
    if (id === undefined || null === id) return;
    const row = await finder(id);
    if (!row) {
      throw new BadRequestException(
        `${fieldName}: dictionary id "${id}" does not exist or is deleted`
      );
    }
  }

  private async assertManyFk(
    finder: (ids: string[]) => Promise<DictRowWithId[]>,
    ids: string[] | undefined,
    fieldName: string
  ): Promise<void> {
    if (!ids || !ids.length) return;
    const uniqueIds = [...new Set(ids)];
    const rows = await finder(uniqueIds);
    if (rows.length === uniqueIds.length) return;

    const found = new Set(rows.map((r) => r.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    throw new BadRequestException(
      `${fieldName}: dictionary id(s) "${missing.join(', ')}" do not exist or are deleted`
    );
  }

  private async assertSubGroupConsistency(
    tx: Prisma.TransactionClient,
    dto: CreateBenchmarkTestDto | UpdateBenchmarkTestDto
  ): Promise<void> {
    if (!dto.subGroupIds || !dto.subGroupIds.length) return;

    if (!dto.macroGroupId) {
      throw new BadRequestException(
        'subGroupIds: macroGroupId is required when subGroupIds is non-empty'
      );
    }

    const uniqueIds = [...new Set(dto.subGroupIds)];
    const rows = await tx.dictSubGroup.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true, macroGroupId: true },
    });

    if (rows.length !== uniqueIds.length) {
      const found = new Set(rows.map((r) => r.id));
      const missing = uniqueIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `subGroupIds: dictionary id(s) "${missing.join(', ')}" do not exist or are deleted`
      );
    }

    const mismatched = rows.filter((r) => r.macroGroupId !== dto.macroGroupId);
    if (mismatched.length) {
      throw new BadRequestException(
        `subGroupIds: ids "${mismatched.map((r) => r.id).join(', ')}" do not belong to macroGroupId "${dto.macroGroupId}"`
      );
    }
  }

  private async assertSubdomainConsistency(
    tx: Prisma.TransactionClient,
    dto: CreateBenchmarkTestDto | UpdateBenchmarkTestDto
  ): Promise<void> {
    if (!dto.subdomainIds || !dto.subdomainIds.length) return;

    if (!dto.domainIds || !dto.domainIds.length) {
      throw new BadRequestException(
        'subdomainIds: domainIds is required and must be non-empty when subdomainIds is non-empty'
      );
    }

    const uniqueIds = [...new Set(dto.subdomainIds)];
    const rows = await tx.dictSubdomain.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true, domainId: true },
    });

    if (rows.length !== uniqueIds.length) {
      const found = new Set(rows.map((r) => r.id));
      const missing = uniqueIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `subdomainIds: dictionary id(s) "${missing.join(', ')}" do not exist or are deleted`
      );
    }

    const allowedDomains = new Set(dto.domainIds);
    const mismatched = rows.filter((r) => !allowedDomains.has(r.domainId));
    if (mismatched.length) {
      throw new BadRequestException(
        `subdomainIds: ids "${mismatched.map((r) => r.id).join(', ')}" do not belong to any of the supplied domainIds`
      );
    }
  }

}
