export interface RuleContext {
  fieldPath: string;
  oldValue: unknown;
  newValue: unknown;
}

export type Verdict = {
  classification: "safe" | "breaking" | "unknown";
  explanation: string;
};

export type SemanticRule = (
  oldField: unknown,
  newField: unknown,
  context: RuleContext,
) => Verdict;
