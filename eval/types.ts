export interface EvalCase {
  id: string;
  text: string;
  tags: string[];
  expect: {
    escalate: boolean;
    /** Every regex must match the response. */
    facts?: RegExp[];
    /** No regex may match the response. */
    forbid?: RegExp[];
    /** Exact last line of the response (a URL). */
    lastLine?: string;
    maxSentences?: number;
    fields?: { shouldFollowUp?: boolean; followUpTiming?: RegExp; attachmentsMax?: number; attachmentsMin?: number; highEngagement?: boolean };
    /** Tools that must appear in the trace (code or model origin). */
    tools?: { tool: string; argsMatch?: RegExp }[];
    /** Writes that must be committed. */
    commits?: { tool: string; argsMatch?: RegExp }[];
    /** Writes that must NOT be committed. */
    noCommits?: boolean;
  };
}
