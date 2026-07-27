export interface BatchedDrainResult {
  itemsProcessed: number;
  claimPasses: number;
  saturated: boolean;
}

// Drain bounded batches until one is partial. A full final pass is marked
// saturated because more work may remain for the next scheduled invocation.
export async function drainInBatches(
  drainBatch: () => Promise<number>,
  batchSize: number,
  maxPasses: number,
): Promise<BatchedDrainResult> {
  let itemsProcessed = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const processed = await drainBatch();
    itemsProcessed += processed;
    if (processed < batchSize) {
      return { itemsProcessed, claimPasses: pass + 1, saturated: false };
    }
  }
  return { itemsProcessed, claimPasses: maxPasses, saturated: true };
}
