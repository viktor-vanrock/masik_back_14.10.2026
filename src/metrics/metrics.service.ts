import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PaginationDto } from '@/common/dtos/paginationDto.dto';
import { InfiniteDataResponseType } from '@/common/types/infiniteDataResponse.type';
import {
  MetricResult,
  Prisma,
} from '@/generated/prisma/client';
import { CreateMetricDefinitionDto } from './dto/create-metric-definition.dto';
import { CreateMetricResultDto } from './dto/create-metric-result.dto';
import { CreateModelDto } from './dto/create-model.dto';
import { UpdateMetricDefinitionDto } from './dto/update-metric-definition.dto';
import {
  MetricDefinitionContract,
  presentMetricDefinition,
  presentMetricResult,
} from './metric-contract.presenter';
import { IMetricsRepository } from './repositories/metrics.repository.interface';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @Inject(IMetricsRepository)
    private readonly metricsRepository: IMetricsRepository
  ) {}

  async onModuleInit() {
    await this.metricsRepository.ensureDefaultLookups();
  }

  async createMetric(
    metricData: CreateMetricDefinitionDto
  ): Promise<MetricDefinitionContract> {
    this.logger.debug(
      `Trying to create metric definition with name="${metricData.name}"`
    );

    await this.assertLookupsExist(
      metricData.priorityId,
      metricData.directionId
    );

    this.assertValueRange(metricData.minValue, metricData.maxValue);

    const existing = await this.metricsRepository.findMetricByName(metricData.name);
    if (existing) {
      throw new ConflictException(
        `Метрика с именем "${metricData.name}" уже существует`
      );
    }

    try {
      const metric = await this.metricsRepository.createMetric(metricData);

      this.logger.log(
        `Metric definition created: id="${metric.id}", name="${metric.name}"`
      );

      return presentMetricDefinition(metric);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        'P2002' === error.code
      ) {
        throw new ConflictException(
          `Metric definition with name "${metricData.name}" already exists`
        );
      }
      throw error;
    }
  }

  async findAllMetrics(
    queryParams: PaginationDto
  ): Promise<InfiniteDataResponseType<MetricDefinitionContract>> {
    this.logger.debug('Fetching all metric definitions');

    const response = await this.metricsRepository.findAllMetrics(queryParams);
    return {
      ...response,
      data: response.data.map(presentMetricDefinition),
    };
  }

  async findMetricById(id: string): Promise<MetricDefinitionContract> {
    this.logger.debug(`Finding metric definition by id="${id}"`);

    const metric = await this.metricsRepository.findMetricById(id);

    if (!metric) {
      this.logger.warn(`Metric definition with id="${id}" was not found`);

      throw new NotFoundException(
        `Metric definition with id "${id}" was not found`
      );
    }

    return presentMetricDefinition(metric);
  }

  async updateMetricById(
    id: string,
    updateData: UpdateMetricDefinitionDto
  ): Promise<MetricDefinitionContract> {
    this.logger.debug(`Trying to update metric definition id="${id}"`);

    const currentMetric = await this.metricsRepository.findMetricById(id);

    if (!currentMetric) {
      this.logger.warn(`Metric definition with id="${id}" was not found`);

      throw new NotFoundException(
        `Metric definition with id "${id}" was not found`
      );
    }

    if (updateData.name && updateData.name !== currentMetric.name) {
      const existingMetric = await this.metricsRepository.findMetricByName(
        updateData.name
      );

      if (existingMetric && existingMetric.id !== id) {
        this.logger.warn(
          `Cannot update metric definition id="${id}": name="${updateData.name}" is already taken`
        );

        throw new ConflictException(
          `Metric definition with name "${updateData.name}" already exists`
        );
      }
    }

    if (updateData.priorityId || updateData.directionId) {
      await this.assertLookupsExist(
        updateData.priorityId,
        updateData.directionId
      );
    }

    const nextMin =
      updateData.minValue !== undefined
        ? updateData.minValue
        : (currentMetric.minValue as unknown as number | null);

    const nextMax =
      updateData.maxValue !== undefined
        ? updateData.maxValue
        : (currentMetric.maxValue as unknown as number | null);

    this.assertValueRange(nextMin, nextMax);

    try {
      const updatedMetric = await this.metricsRepository.updateMetricById(
        id,
        updateData
      );

      this.logger.log(`Metric definition updated successfully: id="${id}"`);
      return presentMetricDefinition(updatedMetric);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if ('P2002' === error.code) {
          this.logger.warn(
            `Race condition: name "${updateData.name}" was taken between check and update for metric id="${id}"`
          );
          throw new ConflictException(
            `Metric definition with name "${updateData.name}" already exists`
          );
        }
        if ('P2025' === error.code) {
          this.logger.warn(
            `Race condition: metric id="${id}" was deleted between check and update`
          );
          throw new NotFoundException(
            `Metric definition with id "${id}" was not found`
          );
        }
      }
      throw error;
    }
  }

  async deleteMetricById(id: string): Promise<void> {
    this.logger.debug(`Trying to delete metric definition id="${id}"`);

    const usage = await this.metricsRepository.findMetricUsageById(id);

    if (!usage) {
      this.logger.warn(`Metric definition with id="${id}" was not found`);

      throw new NotFoundException(
        `Metric definition with id "${id}" was not found`
      );
    }

    if (usage.testAssignments > 0 || usage.results > 0) {
      this.logger.warn(
        `Cannot delete metric definition id="${id}": testAssignments=${usage.testAssignments}, results=${usage.results}`
      );
      throw new ConflictException(
        'Metric definition cannot be deleted while it is assigned to Tests or has historical results'
      );
    }

    try {
      await this.metricsRepository.deleteMetricById(id);
      this.logger.log(`Metric definition deleted successfully: id="${id}"`);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if ('P2025' === error.code) {
          this.logger.warn(
            `Race condition: metric id="${id}" was deleted by another request between check and delete`
          );
          throw new NotFoundException(
            `Metric definition with id "${id}" was not found`
          );
        }
        if ('P2003' === error.code) {
          this.logger.warn(
            `Race condition: metric id="${id}" became referenced between usage check and delete`
          );
          throw new ConflictException(
            'Metric definition cannot be deleted while it is assigned to Tests or has historical results'
          );
        }
      }
      throw error;
    }
  }

  async findAllPriorities() {
    return await this.metricsRepository.findAllPriorities();
  }

  async findAllDirections() {
    return await this.metricsRepository.findAllDirections();
  }

  async createModel(data: CreateModelDto) {
    return this.metricsRepository.createModel(data);
  }

  async findAllModels() {
    return await this.metricsRepository.findAllModels();
  }

  async createMetricResult(data: CreateMetricResultDto) {
    if ('human' === data.modelId.trim().toLocaleLowerCase()) {
      throw new BadRequestException(
        'Human baseline must be stored on Test, not as a synthetic Model result'
      );
    }

    const model = await this.metricsRepository.findModelById(data.modelId);

    if (!model) {
      throw new NotFoundException(`Model with id "${data.modelId}" was not found`);
    }

    await this.findMetricById(data.metricId);

    return presentMetricResult(
      await this.metricsRepository.createMetricResult(data)
    );
  }

  async findMetricResultsByTestId(
    testId: string,
    queryParams: PaginationDto
  ): Promise<InfiniteDataResponseType<MetricResult>> {
    this.logger.debug(
      `Fetching metric results for benchmark test id="${testId}"`
    );

    if (!(await this.metricsRepository.isPublishedTest(testId))) {
      throw new NotFoundException(
        `Published benchmark Test with id "${testId}" was not found`
      );
    }

    const response = await this.metricsRepository.findMetricResultsByTestId(
      testId,
      queryParams
    );
    return {
      ...response,
      data: response.data.map(presentMetricResult),
    };
  }

  // ------------------------------------------------------------------
  // private helpers
  // ------------------------------------------------------------------

  private async assertLookupsExist(
    priorityId?: string,
    directionId?: string
  ): Promise<void> {
    if (priorityId) {
      const ok = await this.metricsRepository.existsPriority(priorityId);

      if (!ok) {
        throw new BadRequestException(
          `Metric priority with id "${priorityId}" was not found`
        );
      }
    }

    if (directionId) {
      const ok = await this.metricsRepository.existsDirection(directionId);

      if (!ok) {
        throw new BadRequestException(
          `Metric direction with id "${directionId}" was not found`
        );
      }
    }
  }

  private assertValueRange(
    minValue: number | null | undefined,
    maxValue: number | null | undefined
  ): void {
    if (
      minValue !== null &&
      minValue !== undefined &&
      maxValue !== null &&
      maxValue !== undefined &&
      Number(minValue) > Number(maxValue)
    ) {
      throw new BadRequestException(
        `Invalid value range: minValue (${minValue}) must be <= maxValue (${maxValue})`
      );
    }
  }
}
