// Browser-created recommendations are intentionally disabled. A future caller
// must invoke a server-owned analyzer that derives the recommendation from
// canonical records; accepting text/score evidence from this helper would let a
// learner fabricate their own training history.
export async function trackRecommendation() {
  return null;
}
