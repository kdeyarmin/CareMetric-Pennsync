import { AlertTriangle, Info } from "lucide-react";
import {
  describeVerification,
  mayCarryResponseToEmr,
  officialItemNumber,
  responseSetCaveat,
} from "./specs/verification.js";

/**
 * The per-item caveat, rendered beside the answer choices themselves.
 *
 * WHY THIS IS AT THE ITEM AND NOT ONLY IN THE PAGE BANNER
 * A 2026-09-01 read of the CMS OASIS-E2 All Items instrument compared PennSync's
 * option list against the official response set item by item. Of the 24 items
 * with an official set to compare, 18 have at least one code that means
 * something DIFFERENT on the official assessment — and a matching code set is no
 * defence: M1340 offers {0,1,2} exactly as CMS does, and its code 2 is "Yes,
 * infected" where the CMS code 2 is "known but not observable".
 *
 * The hazard is a nurse reading a code off this screen and typing it into the
 * same-numbered item in the EMR. That happens at the item, while they are
 * looking at the options — not while they are reading a banner at the top of the
 * page — so the warning has to be here.
 *
 * Everything shown is a deterministic lookup in the verification registry. No
 * model judges an item, and the component states only what the read found.
 */
export default function OasisItemNotice({ itemId, className = "" }) {
  const caveat = responseSetCaveat(itemId);
  if (!caveat) return null;

  const badge = describeVerification(itemId);
  const blocked = !mayCarryResponseToEmr(itemId);
  const number = officialItemNumber(itemId);
  // `destructive` is reserved for a code that would be WRONG in the EMR; a
  // merely loose wording gets an amber note, so the strong styling keeps
  // meaning something.
  const severe = badge?.tone === "destructive";

  const Icon = severe ? AlertTriangle : Info;
  const tone = severe
    ? "border-red-200 bg-red-50 text-red-900"
    : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <p
      role={severe ? "alert" : "note"}
      className={`mt-2 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${tone} ${className}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {severe && number && blocked && (
          <strong className="block">
            PennSync&apos;s answer choices are not the {number} response set.
          </strong>
        )}
        {caveat}
      </span>
    </p>
  );
}
