import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';

import {
  MetricDefinition,
  MetricDirectionLookup,
  MetricPriorityLookup,
  MetricResult,
  Model,
} from '@/generated/prisma/client';
import { CreateMetricDefinitionDto } from '../dto/create-metric-definition.dto';
import { CreateMetricResultDto } from '../dto/create-metric-result.dto';
import { CreateModelDto } from '../dto/create-model.dto';
import { UpdateMetricDefinitionDto } from '../dto/update-metric-definition.dto';

export type MetricUsage = {
  testAssignments: number;
  results: number;
};

export abstract class IMetricsRepository {
  abstract findAllMetrics(
    query: PaginationDto
  ): Promise<InfiniteDataResponseType<MetricDefinition>>;

  abstract findMetricById(id: string): Promise<Nullable<MetricDefinition>>;

  abstract findMetricByName(name: string): Promise<Nullable<MetricDefinition>>;

  abstract createMetric(
    data: CreateMetricDefinitionDto
  ): Promise<MetricDefinition>;

  abstract updateMetricById(
    id: string,
    updateData: UpdateMetricDefinitionDto
  ): Promise<MetricDefinition>;

  abstract deleteMetricById(id: string): Promise<void>;

  abstract findMetricUsageById(
    id: string
  ): Promise<Nullable<MetricUsage>>;

  abstract existsPriority(priorityId: string): Promise<boolean>;

  abstract existsDirection(directionId: string): Promise<boolean>;

  abstract findAllPriorities(): Promise<MetricPriorityLookup[]>;

  abstract findAllDirections(): Promise<MetricDirectionLookup[]>;

  abstract ensureDefaultLookups(): Promise<void>;

  abstract createModel(data: CreateModelDto): Promise<Model>;

  abstract findAllModels(): Promise<Model[]>;

  abstract findModelById(id: string): Promise<Nullable<Model>>;

  abstract createMetricResult(
    data: CreateMetricResultDto
  ): Promise<MetricResult>;

  abstract isPublishedTest(testId: string): Promise<boolean>;

  abstract findMetricResultsByTestId(
    testId: string,
    queryParams: PaginationDto
  ): Promise<InfiniteDataResponseType<MetricResult>>;
}
