/**
 * Query-key conventions for admin data, so invalidation is predictable:
 *   ["admin", <resource>, "list", <params>]    one page of a list for given filters
 *   ["admin", <resource>, "detail", <id>]      one record
 * Invalidating `["admin", "orders"]` refreshes every order list and detail; `adminKeys.badges` holds the nav counts.
 * Everything starts with "admin" so signing out can drop it all at once.
 */
export const adminKeys = {
  all: ["admin"] as const,
  me: ["admin", "me"] as const,
  badges: ["admin", "badges"] as const,
  ordersToAction: ["admin", "orders", "to-action"] as const,
  resource: (resource: string) => ["admin", resource] as const,
  list: (resource: string, params: Record<string, unknown> = {}) => ["admin", resource, "list", params] as const,
  detail: (resource: string, id: string) => ["admin", resource, "detail", id] as const,
};
