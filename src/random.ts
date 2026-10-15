export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function bootstrapCI(values: readonly number[], seed = 1, resamples = 2000): { low: number; high: number } {
  if (values.length === 0) throw new Error("bootstrapCI needs at least one value.");
  if (!Number.isInteger(resamples) || resamples < 1) throw new Error("resamples must be a positive integer.");
  const random = mulberry32(seed); const means: number[] = [];
  for (let sample = 0; sample < resamples; sample++) {
    let sum = 0;
    for (let index = 0; index < values.length; index++) sum += values[Math.floor(random() * values.length)]!;
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return { low: means[Math.floor(resamples * 0.025)]!, high: means[Math.min(resamples - 1, Math.floor(resamples * 0.975))]! };
}
