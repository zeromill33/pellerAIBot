export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  let host = trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      host = new URL(trimmed).hostname;
    } catch {
      host = trimmed;
    }
  }
  let normalized = host.trim().toLowerCase();
  if (normalized.startsWith("www.")) {
    normalized = normalized.slice(4);
  }
  return normalized;
}

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateText(input: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  if (input.length <= maxChars) {
    return input;
  }
  return input.slice(0, maxChars).trim();
}

export function diceCoefficient(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (!a || !b) {
    return 0;
  }
  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const bigram = a.slice(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }

  let matches = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const bigram = b.slice(i, i + 2);
    const count = bigrams.get(bigram);
    if (!count) {
      continue;
    }
    matches += 1;
    if (count === 1) {
      bigrams.delete(bigram);
    } else {
      bigrams.set(bigram, count - 1);
    }
  }

  const total = (a.length - 1) + (b.length - 1);
  if (total <= 0) {
    return 0;
  }
  return (2 * matches) / total;
}
