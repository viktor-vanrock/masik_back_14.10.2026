import { BadRequestException } from '@nestjs/common';
import { ExternalBenchmarkTestsProjectionService } from './external-benchmark-tests-projection.service';
import { ExternalBenchmarkTestsService } from './external-benchmark-tests.service';
import {
  EXTERNAL_BENCHMARK_TEST_FIELDS,
  ExternalBenchmarkTestField,
} from './types';

describe('ExternalBenchmarkTestsService', () => {
  const projection = {
    search: jest.fn(),
    findById: jest.fn(),
    findDistinctValues: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('uses only projections in production read mode', async () => {
    projection.search.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
    projection.findById.mockResolvedValue({ id: 'test-id' });
    projection.findDistinctValues.mockResolvedValue(['Test A']);
    const service = createService();

    await expect(service.search({})).resolves.toMatchObject({ total: 0 });
    await expect(service.findById('test-id')).resolves.toMatchObject({ id: 'test-id' });
    await expect(service.getFieldValues('name')).resolves.toEqual({
      field: 'name',
      values: ['Test A'],
    });

    expect(projection.search).toHaveBeenCalledWith({});
    expect(projection.findById).toHaveBeenCalledWith('test-id');
    expect(projection.findDistinctValues).toHaveBeenCalledWith(
      ExternalBenchmarkTestField.Name
    );
  });

  it('exposes the stable field contract and rejects unknown fields before delegation', async () => {
    const service = createService();

    expect(service.getAvailableFields()).toEqual({
      fields: EXTERNAL_BENCHMARK_TEST_FIELDS,
    });
    await expect(service.getFieldValues('password')).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(projection.findDistinctValues).not.toHaveBeenCalled();
  });

  function createService(): ExternalBenchmarkTestsService {
    return new ExternalBenchmarkTestsService(
      projection as unknown as ExternalBenchmarkTestsProjectionService
    );
  }
});
