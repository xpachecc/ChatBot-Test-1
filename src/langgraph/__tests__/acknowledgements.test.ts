import {
  ACKNOWLEDGEMENT_PHRASES,
  prependClarificationAcknowledgement,
  selectClarificationAcknowledgement,
} from "../acknowledgements.js";

describe("acknowledgements", () => {
  it("selects a phrase from the approved list", () => {
    const selected = selectClarificationAcknowledgement(ACKNOWLEDGEMENT_PHRASES, { random: () => 0.4 });
    expect(ACKNOWLEDGEMENT_PHRASES).toContain(selected);
  });

  it("falls back to default phrase when config list is empty", () => {
    const selected = selectClarificationAcknowledgement([], { random: () => 0.9 });
    expect(selected).toBe("Thank you for the clarification.");
  });

  it("prepends acknowledgement to message text", () => {
    const combined = prependClarificationAcknowledgement("Next question.", ["Understood"], { random: () => 0 });
    expect(combined).toBe("Understood Next question.");
  });
});
