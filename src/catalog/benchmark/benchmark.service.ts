import { Injectable, NotFoundException } from '@nestjs/common';
import { BenchmarkCommandReceiptDto } from '@/benchmark-service/integration/benchmark-command-receipt.dto';
import { BenchmarkRemoteWriteService } from '@/benchmark-service/integration/benchmark-remote-write.service';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import { CatalogBenchmarkProjectionQueryService } from '../projection/catalog-benchmark-projection-query.service';
import { BenchmarkQueryDto } from './dto/benchmarkQuery.dto';
import { CreateBenchmarkDto } from './dto/createBenchmark.dto';
import { UpdateBenchmarkDto } from './dto/updateBenchmark.dto';
import { BenchmarkOptionType, BenchmarkResponseType } from './types';

@Injectable()
export class BenchmarkService {
  constructor(
    private readonly remoteWrites: BenchmarkRemoteWriteService,
    private readonly projectionQuery: CatalogBenchmarkProjectionQueryService
  ) {}

  findAll(
    query: BenchmarkQueryDto
  ): Promise<InfiniteDataResponseType<BenchmarkResponseType>> {
    return this.projectionQuery.findAll(query);
  }

  findOptions(): Promise<BenchmarkOptionType[]> {
    return this.projectionQuery.findOptions();
  }

  async findById(id: string): Promise<BenchmarkResponseType> {
    const benchmark = await this.projectionQuery.findById(id);
    if (!benchmark) {
      throw new NotFoundException(
        `Benchmark suite with id "${id}" was not found`
      );
    }
    return benchmark;
  }

  create(
    dto: CreateBenchmarkDto
  ): Promise<BenchmarkResponseType | BenchmarkCommandReceiptDto> {
    return this.remoteWrites.createSuite(dto);
  }

  updateById(
    id: string,
    dto: UpdateBenchmarkDto
  ): Promise<BenchmarkResponseType | BenchmarkCommandReceiptDto> {
    return this.remoteWrites.updateSuite(id, dto);
  }

  restoreById(
    id: string
  ): Promise<BenchmarkResponseType | BenchmarkCommandReceiptDto> {
    return this.remoteWrites.restoreSuite(id);
  }

  softDeleteById(
    id: string
  ): Promise<void | BenchmarkCommandReceiptDto> {
    return this.remoteWrites.deleteSuite(id);
  }
}
