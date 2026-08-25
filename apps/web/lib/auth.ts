import { cookies } from "next/headers";
import {
  FITNESS_WEB_SESSION_COOKIE,
  verifyFitnessWebSession,
  type FitnessWebSession,
} from "@fitness/auth";
import { webSessionSecret } from "@/lib/env";

export async function currentWebSession(): Promise<
  FitnessWebSession | undefined
> {
  const cookieStore = await cookies();
  const token = cookieStore.get(FITNESS_WEB_SESSION_COOKIE)?.value;

  return verifyFitnessWebSession({
    token,
    secret: webSessionSecret(),
  });
}
