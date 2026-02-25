import { jest, describe, it, expect, beforeAll } from "@jest/globals";
import { CfsStateSchema, setGraphMessagingConfig } from "../infra.js";
import { mergeStatePatch, patchSessionContext } from "../core/helpers/state.js";
import {
  normalizeOptionalString,
  normalizePillarValues,
  normalizeUseCasePillarEntries,
  mergeDiscoveryQuestions,
  normalizeDiscoveryQuestions,
  buildCaseInsensitiveLookupMap,
} from "../core/helpers/normalization.js";
import { truncateTextToWordLimit, sanitizeDiscoveryAnswer } from "../core/helpers/text.js";
import {
  parseNumericSelectionIndices,
  sanitizeNumericSelectionInput,
  parsePillarsFromAi,
  parseCompositeQuestions,
  extractStringValuesFromMixedArray,
} from "../core/helpers/parsing.js";
import { isAffirmativeAnswer } from "../core/helpers/sentiment.js";
import { buildCanonicalReadoutDocument } from "../core/helpers/template.js";
import { invokeChatModelWithFallback } from "../core/services/ai/invoke.js";
import { resolvePersonaGroupFromRole } from "../core/services/ai/resolve-persona.js";

const testGraphMessagingConfig = {
  exampleGenerator: () => [],
  overlayPrefix: () => "",
  clarifierRetryText: {
    step1Ready: "Please answer with yes or no.",
    step2ConfirmPlan: "Please provide a short focus area.",
    step2Obstacle: "Please pick the biggest obstacle.",
  },
  clarificationAcknowledgement: "Thank you for the clarification.",
  messagePolicy: {
    intro: { allowAIRephrase: false, forbidFirstPerson: false },
    name: { allowAIRephrase: false, forbidFirstPerson: false },
    industry: { allowAIRephrase: false, forbidFirstPerson: false },
    role: { allowAIRephrase: false, forbidFirstPerson: false },
    industryClarifier: { allowAIRephrase: true, forbidFirstPerson: true },
    roleClarifier: { allowAIRephrase: true, forbidFirstPerson: true },
    default: { allowAIRephrase: false, forbidFirstPerson: false },
  },
  aiPrompts: {
    selectPersonaGroup: "Select a persona_group and return JSON.",
    selectMarketSegment: "Select a market_segment and return JSON.",
    selectUseCaseGroups: "Select use_case_groups and return JSON.",
    selectOutcomeName: "Select an outcome_name and return the string only.",
    selectPillars: "Select pillar names and return JSON.",
    sanitizeUserInput: "Sanitize user input and return only the cleaned value.",
    reviewResponse: "Review responses and fix grammar/spelling only.",
    assessRisk: "Assess risk and return JSON only.",
  },
};

beforeAll(() => {
  setGraphMessagingConfig(testGraphMessagingConfig);
});

function createTestState() {
  return CfsStateSchema.parse({
    session_context: {
      session_id: "test-infra-1",
      step: "STEP1_KNOW_YOUR_CUSTOMER",
      awaiting_user: false,
      last_question_key: null,
    },
    user_context: {
      first_name: "Alex",
      industry: "Technology",
      persona_role: "CTO",
      timeframe: "Q2",
    },
    use_case_context: {
      objective_normalized: "Improve data governance",
    },
  });
}

// ── mergeStatePatch ──────────────────────────────────────────────────

describe("mergeStatePatch", () => {
  it("merges a single patch onto base state", () => {
    const base = createTestState();
    const result = mergeStatePatch(base, { user_context: { ...base.user_context, first_name: "Jordan" } });
    expect(result.user_context.first_name).toBe("Jordan");
    expect(result.user_context.industry).toBe("Technology");
  });

  it("applies multiple patches in order (last wins)", () => {
    const base = createTestState();
    const patch1 = { user_context: { ...base.user_context, first_name: "Jordan" } };
    const patch2 = { user_context: { ...base.user_context, first_name: "Sam" } };
    const result = mergeStatePatch(base, patch1, patch2);
    expect(result.user_context.first_name).toBe("Sam");
  });

  it("does not mutate the original state object", () => {
    const base = createTestState();
    const originalName = base.user_context.first_name;
    mergeStatePatch(base, { user_context: { ...base.user_context, first_name: "Changed" } });
    expect(base.user_context.first_name).toBe(originalName);
  });

  it("handles empty patches gracefully", () => {
    const base = createTestState();
    const result = mergeStatePatch(base);
    expect(result.user_context.first_name).toBe(base.user_context.first_name);
    expect(result.session_context.session_id).toBe(base.session_context.session_id);
  });
});

// ── patchSessionContext ──────────────────────────────────────────────

describe("patchSessionContext", () => {
  it("overrides specified fields while preserving others", () => {
    const base = createTestState();
    const result = patchSessionContext(base, { awaiting_user: true, last_question_key: "S1_NAME" });
    expect(result.session_context.awaiting_user).toBe(true);
    expect(result.session_context.last_question_key).toBe("S1_NAME");
    expect(result.session_context.session_id).toBe("test-infra-1");
    expect(result.session_context.step).toBe("STEP1_KNOW_YOUR_CUSTOMER");
  });

  it("returns only session_context key", () => {
    const base = createTestState();
    const result = patchSessionContext(base, { awaiting_user: true });
    const keys = Object.keys(result);
    expect(keys).toEqual(["session_context"]);
  });

  it("handles empty patch (returns identical session_context)", () => {
    const base = createTestState();
    const result = patchSessionContext(base, {});
    expect(result.session_context).toEqual(base.session_context);
  });

  it("does not mutate the original state", () => {
    const base = createTestState();
    patchSessionContext(base, { awaiting_user: true });
    expect(base.session_context.awaiting_user).toBe(false);
  });
});

// ── invokeChatModelWithFallback ──────────────────────────────────────

describe("invokeChatModelWithFallback", () => {
  it("returns trimmed model response on success", async () => {
    const mockModel = {
      invoke: jest.fn<any>().mockResolvedValue({ content: "  Hello World  " }),
    } as any;
    const result = await invokeChatModelWithFallback(mockModel, "system", "user", {
      runName: "test",
    });
    expect(result).toBe("Hello World");
  });

  it("returns fallback on model error", async () => {
    const mockModel = {
      invoke: jest.fn<any>().mockRejectedValue(new Error("API error")),
    } as any;
    const result = await invokeChatModelWithFallback(mockModel, "system", "user", {
      runName: "test",
      fallback: "fallback-value",
    });
    expect(result).toBe("fallback-value");
  });

  it("returns fallback on empty model response", async () => {
    const mockModel = {
      invoke: jest.fn<any>().mockResolvedValue({ content: "   " }),
    } as any;
    const result = await invokeChatModelWithFallback(mockModel, "system", "user", {
      runName: "test",
      fallback: "empty-fallback",
    });
    expect(result).toBe("empty-fallback");
  });

  it("returns empty string when no fallback and model errors", async () => {
    const mockModel = {
      invoke: jest.fn<any>().mockRejectedValue(new Error("API error")),
    } as any;
    const result = await invokeChatModelWithFallback(mockModel, "system", "user", {
      runName: "test",
    });
    expect(result).toBe("");
  });

  it("passes runName through to model.invoke options", async () => {
    const mockModel = {
      invoke: jest.fn<any>().mockResolvedValue({ content: "ok" }),
    } as any;
    await invokeChatModelWithFallback(mockModel, "sys", "usr", { runName: "myRunName" });
    expect(mockModel.invoke).toHaveBeenCalledTimes(1);
    const callArgs = mockModel.invoke.mock.calls[0];
    expect(callArgs[1]).toEqual({ runName: "myRunName" });
  });
});

// ── Moved parsers & helpers ──────────────────────────────────────────

describe("normalizeOptionalString", () => {
  it("returns null for empty/null/undefined", () => {
    expect(normalizeOptionalString(null)).toBeNull();
    expect(normalizeOptionalString(undefined)).toBeNull();
    expect(normalizeOptionalString("")).toBeNull();
    expect(normalizeOptionalString("   ")).toBeNull();
  });

  it("returns null for the literal string 'default'", () => {
    expect(normalizeOptionalString("default")).toBeNull();
    expect(normalizeOptionalString("Default")).toBeNull();
    expect(normalizeOptionalString("DEFAULT")).toBeNull();
  });

  it("trims whitespace from valid values", () => {
    expect(normalizeOptionalString("  hello  ")).toBe("hello");
    expect(normalizeOptionalString("Technology")).toBe("Technology");
  });
});

describe("truncateTextToWordLimit", () => {
  it("truncates at 12 words by default", () => {
    const longText = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen";
    expect(truncateTextToWordLimit(longText).split(/\s+/).length).toBe(12);
  });

  it("passes through short strings", () => {
    const shortText = "hello world";
    expect(truncateTextToWordLimit(shortText)).toBe("hello world");
  });

  it("supports custom word limit", () => {
    const text = "one two three four five";
    expect(truncateTextToWordLimit(text, 3)).toBe("one two three");
  });
});

describe("parseNumericSelectionIndices", () => {
  it("parses comma-separated indices", () => {
    expect(parseNumericSelectionIndices("1,3", 4)).toEqual([1, 3]);
  });

  it("rejects out-of-range indices", () => {
    expect(parseNumericSelectionIndices("5", 4)).toBeNull();
    expect(parseNumericSelectionIndices("0", 4)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseNumericSelectionIndices("", 4)).toBeNull();
  });

  it("deduplicates repeated indices", () => {
    expect(parseNumericSelectionIndices("2,2,3", 4)).toEqual([2, 3]);
  });
});

describe("sanitizeNumericSelectionInput", () => {
  it("strips letters and flags invalid input", () => {
    const result = sanitizeNumericSelectionInput("1, abc, 3");
    expect(result.invalid).toBe(true);
    expect(result.normalized).toMatch(/1/);
    expect(result.normalized).toMatch(/3/);
  });

  it("passes clean numeric input", () => {
    const result = sanitizeNumericSelectionInput("1, 3");
    expect(result.invalid).toBe(false);
    expect(result.normalized).toBe("1, 3");
  });
});

describe("isAffirmativeAnswer", () => {
  it("returns true for yes/yeah/sure/correct", () => {
    expect(isAffirmativeAnswer("yes")).toBe(true);
    expect(isAffirmativeAnswer("Yeah")).toBe(true);
    expect(isAffirmativeAnswer("sure")).toBe(true);
    expect(isAffirmativeAnswer("correct")).toBe(true);
    expect(isAffirmativeAnswer("exactly")).toBe(true);
  });

  it("returns false for no/maybe/other", () => {
    expect(isAffirmativeAnswer("no")).toBe(false);
    expect(isAffirmativeAnswer("maybe")).toBe(false);
    expect(isAffirmativeAnswer("I think so possibly")).toBe(false);
  });
});

describe("mergeDiscoveryQuestions", () => {
  it("merges without duplicates", () => {
    const existing = [{ question: "Q1", response: "A1", risk: null, risk_domain: null }];
    const next = [
      { question: "Q2", response: null, risk: null, risk_domain: null },
      { question: "Q1", response: null, risk: null, risk_domain: null },
    ];
    const result = mergeDiscoveryQuestions(existing, next);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.question)).toEqual(["Q2", "Q1"]);
  });

  it("preserves existing responses when question not in next", () => {
    const existing = [{ question: "Q1", response: "A1", risk: "R1", risk_domain: "compliance" }];
    const next = [{ question: "Q2", response: null, risk: null, risk_domain: null }];
    const result = mergeDiscoveryQuestions(existing, next);
    expect(result).toHaveLength(2);
    expect(result[0].response).toBe("A1");
    expect(result[0].risk).toBe("R1");
  });
});

describe("normalizeUseCasePillarEntries", () => {
  it("normalizes mixed string/object arrays", () => {
    const input = [
      "Data Governance",
      { name: "Security", confidence: 0.8 },
      { name: "data governance", confidence: 0.5 },
    ];
    const result = normalizeUseCasePillarEntries(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "Data Governance", confidence: 1 });
    expect(result[1]).toEqual({ name: "Security", confidence: 0.8 });
  });

  it("deduplicates case-insensitively", () => {
    const result = normalizeUseCasePillarEntries(["Alpha", "alpha", "ALPHA"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha");
  });
});

describe("parsePillarsFromAi", () => {
  it("parses valid AI JSON with pillars array", () => {
    const json = JSON.stringify({ pillars: [{ name: "Gov", confidence: 0.9 }, { name: "Sec", confidence: 0.5 }] });
    const result = parsePillarsFromAi(json);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "Gov", confidence: 0.9 });
  });

  it("returns empty array on invalid JSON", () => {
    expect(parsePillarsFromAi("not json")).toEqual([]);
    expect(parsePillarsFromAi("{}")).toEqual([]);
  });
});

describe("parseCompositeQuestions", () => {
  it("splits multi-line numbered questions", () => {
    const text = "1. Question one?\n2. Question two?\n3. Question three?";
    const result = parseCompositeQuestions(text);
    expect(result).toEqual(["Question one?", "Question two?", "Question three?"]);
  });

  it("limits to 3 questions", () => {
    const text = "A\nB\nC\nD\nE";
    expect(parseCompositeQuestions(text)).toHaveLength(3);
  });
});

describe("normalizeDiscoveryQuestions", () => {
  it("converts strings to DiscoveryQuestionItem objects", () => {
    const result = normalizeDiscoveryQuestions(["Q1?", "Q2?"]);
    expect(result).toEqual([
      { question: "Q1?", response: null, risk: null, risk_domain: null },
      { question: "Q2?", response: null, risk: null, risk_domain: null },
    ]);
  });

  it("filters out blank strings", () => {
    expect(normalizeDiscoveryQuestions(["Q1?", "", "  "])).toHaveLength(1);
  });
});

describe("sanitizeDiscoveryAnswer", () => {
  it("strips control characters and trims", () => {
    expect(sanitizeDiscoveryAnswer("hello\x00world")).toBe("hello world");
  });

  it("truncates at 600 characters", () => {
    const long = "a".repeat(700);
    expect(sanitizeDiscoveryAnswer(long)).toHaveLength(600);
  });
});

describe("normalizePillarValues", () => {
  it("deduplicates and cleans values", () => {
    expect(normalizePillarValues(["Gov", " Gov ", "Sec"])).toEqual(["Gov", "Sec"]);
  });
});

describe("buildCaseInsensitiveLookupMap", () => {
  it("maps lowercased keys to original-cased values", () => {
    const map = buildCaseInsensitiveLookupMap(["Data Governance", "Security"]);
    expect(map.get("data governance")).toBe("Data Governance");
    expect(map.get("security")).toBe("Security");
  });
});

describe("extractStringValuesFromMixedArray", () => {
  it("extracts string values from strings and objects", () => {
    const input = ["risk1", { key: "risk2" }, 42, null, { a: "risk3", b: 10 }];
    const result = extractStringValuesFromMixedArray(input as unknown[]);
    expect(result).toEqual(["risk1", "risk2", "risk3"]);
  });
});

// ── buildCanonicalReadoutDocument ────────────────────────────────────

describe("buildCanonicalReadoutDocument", () => {
  it("builds document with required fields", () => {
    const doc = buildCanonicalReadoutDocument({
      documentId: "doc-1",
      metadata: { author: "test" },
      sections: [{ id: "s1", title: "Intro", markdown: "# Hello" }],
    });
    expect(doc.document_id).toBe("doc-1");
    expect(doc.version).toBe("1.0");
    expect(doc.metadata).toEqual({ author: "test" });
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].title).toBe("Intro");
  });

  it("defaults tables/citations/evidenceRefs to empty arrays", () => {
    const doc = buildCanonicalReadoutDocument({
      documentId: "doc-2",
      metadata: {},
      sections: [],
    });
    expect(doc.tables).toEqual([]);
    expect(doc.citations).toEqual([]);
    expect(doc.evidence_refs).toEqual([]);
  });

  it("passes through optional arrays when provided", () => {
    const doc = buildCanonicalReadoutDocument({
      documentId: "doc-3",
      metadata: {},
      sections: [],
      tables: [{ col: "val" }],
      citations: [{ ref: "cite1" }],
      evidenceRefs: ["ev1"],
    });
    expect(doc.tables).toEqual([{ col: "val" }]);
    expect(doc.citations).toEqual([{ ref: "cite1" }]);
    expect(doc.evidence_refs).toEqual(["ev1"]);
  });
});

// ── resolvePersonaGroupFromRole ──────────────────────────────────────

describe("resolvePersonaGroupFromRole", () => {
  it("returns existing values when roleText is empty", async () => {
    const result = await resolvePersonaGroupFromRole({
      roleText: "",
      queryText: "some query",
      vectorDocType: "persona_usecase_document",
      personaGroups: ["Group A", "Group B"],
      existingGroup: "Group A",
      existingConfidence: 0.7,
    });
    expect(result.persona_group).toBe("Group A");
    expect(result.confidence).toBe(0.7);
    expect(result.context_examples).toEqual([]);
  });

  it("returns existing values when queryText is empty", async () => {
    const result = await resolvePersonaGroupFromRole({
      roleText: "CTO",
      queryText: "",
      vectorDocType: "persona_usecase_document",
      personaGroups: ["Group A"],
      existingGroup: "Group A",
      existingConfidence: 0.5,
    });
    expect(result.persona_group).toBe("Group A");
    expect(result.confidence).toBe(0.5);
  });
});
