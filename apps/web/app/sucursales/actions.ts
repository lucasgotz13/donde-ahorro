"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BRANCHES_COOKIE, parseBranchIds } from "../../lib/branches.ts";

/** Saves the checked branches on this device (S20); none checked clears the selection. */
export async function saveBranches(formData: FormData) {
  const ids = parseBranchIds(formData.getAll("branch").join(","));
  const store = await cookies();
  if (ids.length) {
    store.set(BRANCHES_COOKIE, ids.join(","), { maxAge: 365 * 24 * 3600, sameSite: "lax", path: "/", httpOnly: true });
  } else {
    store.delete(BRANCHES_COOKIE);
  }
  redirect(`/sucursales?guardadas=${ids.length}`);
}
