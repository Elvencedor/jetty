import { describe, expect, it } from "vitest";
import { prepSentence } from "./PrepNotice";

describe("prepSentence", () => {
  it("says when deliveries start and how long they then take", () => {
    expect(prepSentence({ startsOn: "2099-12-01", days: 10 }, { minDays: 2, maxDays: 4 })).toBe("We're preparing orders. Deliveries start on Tue 1 Dec, then take 2 to 4 days.");
  });
  it("leaves out the days when there is no zone yet", () => {
    expect(prepSentence({ startsOn: "2099-12-01", days: null }, null)).toBe("We're preparing orders. Deliveries start on Tue 1 Dec.");
  });
});
