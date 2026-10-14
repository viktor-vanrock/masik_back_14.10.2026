import { CatalogTestProjectionQueryService } from '@/catalog/projection/catalog-test-projection-query.service';
import { CatalogService } from '../catalog.service';

describe('CatalogService', () => {
  it('serves grouped projection reads without legacy persistence providers', async () => {
    const page = { data: [], total: 0 };
    const projectionQuery = {
      findGrouped: jest.fn().mockResolvedValue(page),
    };
    const service = new CatalogService(
      projectionQuery as unknown as CatalogTestProjectionQueryService
    );
    const query = { page: 1, limit: 20 };

    await expect(service.findGrouped(query)).resolves.toBe(page);
    expect(projectionQuery.findGrouped).toHaveBeenCalledWith(query);
  });
});
