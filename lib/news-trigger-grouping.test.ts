import { describe, expect, it } from "vitest";
import { groupNewsTriggersByCompany } from "./news-trigger-grouping";

type FakeTrigger = {
  id: string;
  score: { company: string | null; relevanceScore: number };
};

function trigger(id: string, company: string | null, relevanceScore: number): FakeTrigger {
  return { id, score: { company, relevanceScore } };
}

describe("groupNewsTriggersByCompany", () => {
  it("groups two articles about the same company into one group", () => {
    const groups = groupNewsTriggersByCompany([
      trigger("sia-quarter", "Singapore Airlines", 82),
      trigger("sia-hiring", "Singapore Airlines", 76),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].articles).toHaveLength(2);
    expect(groups[0].company).toBe("Singapore Airlines");
  });

  it("uses the highest-scoring article as the group's primary", () => {
    const [group] = groupNewsTriggersByCompany([
      trigger("sia-hiring", "Singapore Airlines", 76),
      trigger("sia-quarter", "Singapore Airlines", 82),
    ]);

    expect(group.primary.id).toBe("sia-quarter");
    // Primary should sort first within the group's own article list too.
    expect(group.articles[0].id).toBe("sia-quarter");
  });

  it("normalizes legal suffixes so 'X Pte Ltd' and 'X' land in the same group", () => {
    const groups = groupNewsTriggersByCompany([
      trigger("a", "DBS Bank Ltd", 80),
      trigger("b", "DBS Bank", 75),
    ]);

    expect(groups).toHaveLength(1);
  });

  it("keeps articles with no identified company as separate, ungrouped entries", () => {
    const groups = groupNewsTriggersByCompany([
      trigger("a", null, 80),
      trigger("b", null, 75),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("does not merge different companies", () => {
    const groups = groupNewsTriggersByCompany([
      trigger("a", "Singapore Airlines", 80),
      trigger("b", "Changi Airport", 75),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("orders groups by their best article's score, descending", () => {
    const groups = groupNewsTriggersByCompany([
      trigger("a", "Company A", 70),
      trigger("b", "Company B", 95),
    ]);

    expect(groups[0].company).toBe("Company B");
    expect(groups[1].company).toBe("Company A");
  });
});
