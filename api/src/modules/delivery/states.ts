/** Nigeria's 36 states and the Federal Capital Territory, spelled as delivery zones and checkout name them. */
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const;

const byKey = new Map<string, string>(NIGERIAN_STATES.map((s) => [s.toLowerCase(), s]));

/** The canonical spelling of a state however it was typed (case and spacing aside), or undefined if it is not one. */
export const canonicalState = (name: string): string | undefined => byKey.get(name.trim().replace(/\s+/g, ' ').toLowerCase());
