-- CreateIndex
CREATE UNIQUE INDEX "benchmarks_name_key" ON "benchmarks"("name");

-- CreateIndex
CREATE UNIQUE INDEX "benchmarks_name_en_key" ON "benchmarks"("name_en");

-- CreateIndex
CREATE UNIQUE INDEX "benchmark_tests_benchmark_id_name_key" ON "benchmark_tests"("benchmark_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "benchmark_tests_benchmark_id_name_en_key" ON "benchmark_tests"("benchmark_id", "name_en");
