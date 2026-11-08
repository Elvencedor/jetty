/** Options a wig shop usually sells by, with the values owners tend to offer. Suggestions only: anything can be typed instead. */
export type OptionPreset = { name: string; blurb: string; values: string[] };

export const OPTION_PRESETS: OptionPreset[] = [
  { name: "Length", blurb: "How long the hair is", values: ['10"', '12"', '14"', '16"', '18"', '20"', '22"', '24"', '26"', '28"', '30"'] },
  { name: "Lace", blurb: "The type of lace or cap", values: ["Closure", "13x4 Frontal", "HD Frontal", "Full lace"] },
  { name: "Density", blurb: "How full the hair is", values: ["130%", "150%", "180%", "200%", "250%"] },
  { name: "Texture", blurb: "Straight, wavy or curly", values: ["Straight", "Body wave", "Deep wave", "Curly"] },
  { name: "Colour", blurb: "Shades customers can pick", values: ["Natural black", "Burgundy", "Honey blonde", "Ginger"] },
  { name: "Cap size", blurb: "Fit of the cap", values: ["Small", "Medium", "Large"] },
];

/** Values typed as a list, separated by commas or new lines, without blanks or repeats (case aside). */
export function splitValues(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()));
}
