import type { CfsStepName, OverlayName } from "../state.js";

// ── CFS graph step constants ────────────────────────────────────────
export const CFS_GRAPH_ID = "cfs";

export const CFS_STEPS = {
  STEP1_KNOW_YOUR_CUSTOMER: "STEP1_KNOW_YOUR_CUSTOMER" as const,
  STEP2_NARROW_DOWN_USE_CASES: "STEP2_NARROW_DOWN_USE_CASES" as const,
  STEP3_PERFORM_DISCOVERY: "STEP3_PERFORM_DISCOVERY" as const,
  STEP4_BUILD_READOUT: "STEP4_BUILD_READOUT" as const,
  STEP5_READOUT_SUMMARY_NEXT_STEPS: "STEP5_READOUT_SUMMARY_NEXT_STEPS" as const,
} satisfies Record<string, CfsStepName>;

export const CFS_STEP_LABELS: Record<CfsStepName, string> = {
  STEP1_KNOW_YOUR_CUSTOMER: "step1-Know_Your_Customer",
  STEP2_NARROW_DOWN_USE_CASES: "step2-Narrow_Down_Use_Cases",
  STEP3_PERFORM_DISCOVERY: "step3-Perform_Discovery",
  STEP4_BUILD_READOUT: "step4-Build_Readout",
  STEP5_READOUT_SUMMARY_NEXT_STEPS: "step5-Readout_Summary_Next_Steps",
};

export const STEP2_MAX_QUESTIONS = 2;
export const S3_DISCOVERY_QUESTION_KEY = "S3_DISCOVERY_QUESTION";

type Step2QuestionKey = "S2_CONFIRM_PLAN" | "S2_OBSTACLE";

export const STEP2_QUESTIONS: Record<number, { key: Step2QuestionKey; question: string }> = {
  0: {
    key: "S2_CONFIRM_PLAN",
    question: `[Step 2 – What We Will Accomplish Today – Question 1 of ${STEP2_MAX_QUESTIONS}]\nTo make the best use of our time, we'll focus on uncovering which processes most need alignment and what barriers may slow that progress.\n\n{{name}}, could you share which specific operational areas (for example, {{examples}}) are currently most inconsistent or fragmented as you pursue this goal?`,
  },
  1: {
    key: "S2_OBSTACLE",
    question: `[Step 2 – What We Will Accomplish Today – Question 2 of ${STEP2_MAX_QUESTIONS}]\nTo ensure we explore the right depth, what would you say is the biggest obstacle slowing improvement in those areas — technology limitations, process gaps, or staff adoption?`,
  },
};

export function overlayPrefix(overlay?: OverlayName): string {
  switch (overlay) {
    case "Mentor_Supportive":
      return "To keep this supportive, ";
    case "CTO_Consultative":
      return "To keep this focused, ";
    case "SeniorSE_Challenging":
      return "To stress-test this, ";
    case "Coach_Affirmative":
      return "To build on your momentum, ";
    default:
      return "To stay aligned, ";
  }
}

export function exampleGenerator(params: { industry?: string | null; role?: string | null; topic: "role" | "industry" | "goal" | "timeframe" }): string[] {
  const industry = params.industry ?? "your industry";
  switch (params.topic) {
    case "role":
      return [
        `Example (as a user): "You lead the team that owns your analytics workflow and reporting cadence."`,
        `Example (as a user): "You're accountable for the platform operations process and weekly release governance."`,
      ];
    case "industry":
      return [
        `Example (as a user): "Your organization is in ${industry}, supporting regulated workflows and recurring reporting cycles."`,
        `Example (as a user): "You operate in ${industry}, with multiple teams depending on shared data processes."`,
      ];
    case "goal":
      return [
        `Example: "Reduce manual handoffs in the workflow so the process runs consistently every week."`,
        `Example: "Improve data availability for reporting so leadership decisions aren't delayed each month."`,
      ];
    case "timeframe":
      return [
        `Example: "We need this operating reliably by end of this quarter, with weekly governance checks."`,
        `Example: "Within 90 days, we need a repeatable process across teams, reviewed monthly."`,
      ];
  }
}


