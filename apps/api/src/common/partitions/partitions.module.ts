import { Module } from '@nestjs/common';
import { PartitionRangeRepository } from './partition-range.repository.js';
import { PartitionRangeService } from './partition-range.service.js';

/** Shared by the two ingest paths that write to partitioned tables (activity, screenshots). */
@Module({
  providers: [PartitionRangeRepository, PartitionRangeService],
  exports: [PartitionRangeService],
})
export class PartitionsModule {}
