/** Offline tests for Apollo response parsing. No API calls, no credits. */

import { describe, expect, it } from "vitest";
import { chunk, extractRequestId } from "./apollo";

describe("extractRequestId", () => {
  /**
   * Apollo's request_id is a signed 64-bit integer, larger than
   * Number.MAX_SAFE_INTEGER. JSON.parse rounds it, and polling the rounded
   * value returns 404 — the waterfall result becomes unreachable. So the id
   * must be read from the raw response text.
   */
  it("preserves precision that JSON.parse would destroy", () => {
    const raw = '{"status":"success","request_id":-13768839000940095}';
    expect(extractRequestId(raw)).toBe("-13768839000940095");

    // Demonstrate the bug this guards against.
    const rounded = String(JSON.parse(raw).request_id);
    expect(rounded).not.toBe("-13768839000940095");
  });

  it("handles a positive id", () => {
    expect(extractRequestId('{"request_id":8766128268480655130}')).toBe(
      "8766128268480655130",
    );
  });

  it("handles an id sent as a string", () => {
    expect(extractRequestId('{"request_id":"-4409788833414264321"}')).toBe(
      "-4409788833414264321",
    );
  });

  it("tolerates whitespace", () => {
    expect(extractRequestId('{ "request_id" :  -123 }')).toBe("-123");
  });

  it("falls back to the parsed value when the pattern is absent", () => {
    expect(extractRequestId("{}", 42)).toBe("42");
    expect(extractRequestId("{}", null)).toBeNull();
    expect(extractRequestId("{}")).toBeNull();
  });
});

describe("chunk", () => {
  // bulk_match accepts at most 10 people per call.
  it("splits into batches of 10 by default", () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const batches = chunk(items);
    expect(batches.map((b) => b.length)).toEqual([10, 10, 5]);
  });

  it("returns nothing for an empty list", () => {
    expect(chunk([])).toEqual([]);
  });

  it("keeps a short list in one batch", () => {
    expect(chunk([1, 2, 3])).toEqual([[1, 2, 3]]);
  });
});
