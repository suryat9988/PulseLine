export interface SignedBarInput {
  id: string;
  label: string;
  value: number | null;
}

export interface SignedBarRow {
  id: string;
  label: string;
  value: number | null;
  available: boolean;
  sign: "positive" | "negative" | "zero" | "missing";
  signedLabel: string;
  leftPct: number;
  widthPct: number;
}

export interface SignedComparisonLayout {
  maxAbs: number;
  zeroPct: number;
  rows: SignedBarRow[];
}

function signOf(value: number | null): SignedBarRow["sign"] {
  if (value === null || !Number.isFinite(value)) return "missing";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "zero";
}

function signedLabel(value: number | null, format: (value: number) => string): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  if (value > 0) return `Positive ${format(value)}`;
  if (value < 0) return `Negative ${format(value)}`;
  return `Zero ${format(0)}`;
}

export function signedComparisonLayout(
  values: SignedBarInput[],
  format: (value: number) => string = (value) => String(value),
): SignedComparisonLayout {
  const present = values
    .map((item) => item.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const maxAbs = present.length > 0 ? Math.max(...present.map((value) => Math.abs(value)), 0) : 0;
  const zeroPct = 50;
  return {
    maxAbs,
    zeroPct,
    rows: values.map((item) => {
      const sign = signOf(item.value);
      if (sign === "missing" || item.value === null) {
        return {
          id: item.id,
          label: item.label,
          value: item.value,
          available: false,
          sign,
          signedLabel: signedLabel(item.value, format),
          leftPct: zeroPct,
          widthPct: 0,
        };
      }
      const magnitude = maxAbs === 0 ? 0 : (Math.abs(item.value) / maxAbs) * 50;
      return {
        id: item.id,
        label: item.label,
        value: item.value,
        available: true,
        sign,
        signedLabel: signedLabel(item.value, format),
        leftPct: item.value < 0 ? zeroPct - magnitude : zeroPct,
        widthPct: magnitude,
      };
    }),
  };
}
