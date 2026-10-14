export type BenchmarkResponseType = {
  id: string;
  name: string;
  nameEn: string;
  description: string | null;
  descriptionEn: string | null;
  benchmarkTestsCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BenchmarkOptionType = {
  id: string;
  name: string;
  nameEn: string;
};
