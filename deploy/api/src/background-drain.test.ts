import { describe, expect, it, vi } from "vitest";

import { drainInBatches } from "./background-drain";

describe("drainInBatches", () => {
  it("reports the empty claim pass without processed items", async () => {
    const drain = vi.fn().mockResolvedValue(0);
    await expect(drainInBatches(drain, 100, 20)).resolves.toEqual({
      itemsProcessed: 0,
      claimPasses: 1,
      saturated: false,
    });
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it("stops after the first partial batch", async () => {
    const drain = vi.fn().mockResolvedValueOnce(100).mockResolvedValueOnce(25);
    await expect(drainInBatches(drain, 100, 20)).resolves.toEqual({
      itemsProcessed: 125,
      claimPasses: 2,
      saturated: false,
    });
  });

  it("marks a fully consumed pass budget as saturated", async () => {
    const drain = vi.fn().mockResolvedValue(100);
    await expect(drainInBatches(drain, 100, 2)).resolves.toEqual({
      itemsProcessed: 200,
      claimPasses: 2,
      saturated: true,
    });
  });
});
