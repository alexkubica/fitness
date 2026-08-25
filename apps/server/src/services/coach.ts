import type {
  CoachMealSlot,
  CoachProfile,
  CoachProfileInput,
  NeonCoachRepository,
} from "@fitness/db";

export type CoachService = Readonly<{
  getProfile(
    userId: string,
    profileId?: string | undefined,
  ): Promise<CoachProfile | undefined>;
  upsertProfile(input: CoachProfileInput): Promise<CoachProfile>;
}>;

export type CoachRepositoryPort = Pick<
  NeonCoachRepository,
  "getProfile" | "upsertProfile"
>;

export function createInMemoryCoachService(
  options: {
    initialProfiles?: readonly CoachProfile[] | undefined;
    now?: (() => Date) | undefined;
  } = {},
): CoachService {
  const profiles = new Map<string, CoachProfile>(
    (options.initialProfiles ?? []).map((profile) => [
      profileKey(profile.userId, profile.profileId),
      copyProfile(profile),
    ]),
  );
  const now = options.now ?? (() => new Date());

  return coachServiceFromStore({
    async getProfile(userId, profileId) {
      const profile = profiles.get(profileKey(userId, profileId));

      return profile === undefined ? undefined : copyProfile(profile);
    },
    async upsertProfile(input) {
      const key = profileKey(input.userId, input.profileId);
      const existing = profiles.get(key);
      const timestamp = now().toISOString();
      const profile: CoachProfile = {
        ...input,
        mealSlots: input.mealSlots.map(copyMealSlot),
        targets: { ...input.targets },
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };

      profiles.set(key, profile);

      return copyProfile(profile);
    },
  });
}

export function createRepositoryCoachService(
  repository: CoachRepositoryPort,
): CoachService {
  return coachServiceFromStore(repository);
}

function coachServiceFromStore(repository: CoachRepositoryPort): CoachService {
  return {
    getProfile(userId, profileId) {
      return repository.getProfile(userId, profileId);
    },
    upsertProfile(input) {
      return repository.upsertProfile(input);
    },
  };
}

function copyProfile(profile: CoachProfile): CoachProfile {
  return {
    ...profile,
    mealSlots: profile.mealSlots.map(copyMealSlot),
    targets: { ...profile.targets },
  };
}

function copyMealSlot(slot: CoachMealSlot): CoachMealSlot {
  return { ...slot };
}

function profileKey(userId: string, profileId: string | undefined): string {
  return `${profileId ?? `legacy:${userId}`}`;
}
