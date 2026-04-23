import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVisiblePropertyResults,
  dedupePropertyResults,
  projectPropertyResult
} from "../components/map/property-results-helpers.ts";

const baseProperty = {
  propertyId: "prop-1",
  address: "12 Main St, Boston, MA",
  city: "Boston",
  state: "MA",
  postalCode: "02110",
  mapState: "not_home",
  visitCount: 2,
  notHomeCount: 2,
  priorityScore: 15,
  priorityBand: "high"
};

test("dedupePropertyResults keeps the strongest local property record for the same address", () => {
  const result = dedupePropertyResults([
    {
      ...projectPropertyResult(baseProperty as never),
      propertyId: "prop-low",
      priorityScore: 5
    },
    {
      ...projectPropertyResult(baseProperty as never),
      propertyId: "prop-high",
      priorityScore: 18
    }
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.propertyId, "prop-high");
});

test("buildVisiblePropertyResults merges remote search hits without duplicating local matches", () => {
  const result = buildVisiblePropertyResults({
    items: [
      baseProperty as never,
      {
        ...baseProperty,
        propertyId: "prop-2",
        address: "44 Oak Ave, Cambridge, MA",
        city: "Cambridge",
        postalCode: "02139",
        priorityScore: 9,
        priorityBand: "medium"
      } as never
    ],
    query: "main",
    remoteResults: [
      {
        propertyId: "prop-remote-dup",
        address: "12 Main St, Boston, MA",
        subtitle: "Remote duplicate"
      },
      {
        propertyId: "prop-remote-new",
        address: "99 River Rd, Somerville, MA",
        subtitle: "Remote only"
      }
    ]
  });

  assert.equal(result.length, 2);
  assert.equal(result[0]?.propertyId, "prop-1");
  assert.equal(result[1]?.propertyId, "prop-remote-new");
});
