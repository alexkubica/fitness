import {
  createNeonProfileRepository,
  type SqlQueryExecutor,
} from "@fitness/db/dist/profiles.js";

export async function getSelfProfileId(
  sql: SqlQueryExecutor,
  userId: string,
): Promise<string> {
  const row = await createNeonProfileRepository(sql).ensureSelfProfile({
    userId,
  });

  return row.profile.id;
}
