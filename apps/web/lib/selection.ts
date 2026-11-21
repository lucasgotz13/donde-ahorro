import { cookies } from "next/headers";
import { BRANCHES_COOKIE, parseBranchIds } from "./branches.ts";

/** The branches the user chose on this device (S3, S20); empty means all of CABA. */
export async function selectedBranchIds(): Promise<string[]> {
  return parseBranchIds((await cookies()).get(BRANCHES_COOKIE)?.value);
}
