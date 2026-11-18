export const WORKOUT_TYPES = {
  walking: ["walking", "generic", "Walk"],
  hiking: ["hiking", "generic", "Hike"],
  running: ["running", "generic", "Run"],
  treadmill: ["running", "treadmill", "Treadmill run"],
  cycling: ["cycling", "generic", "Ride"],
  indoor_cycling: ["cycling", "indoor_cycling", "Indoor cycling"],
  rowing: ["rowing", "generic", "Outdoor rowing"],
  indoor_rowing: ["rowing", "indoor_rowing", "Indoor rowing / rowing machine"],
  swimming: ["swimming", "lap_swimming", "Pool swimming"],
  open_water: ["swimming", "open_water", "Open-water swimming"],
  strength_training: ["training", "strength_training", "Strength training"],
  yoga: ["training", "yoga", "Yoga"],
  generic: ["generic", "generic", "Other workout"],
};

export function applyEdits(activity, stored) {
  const type = WORKOUT_TYPES[stored.typeOverride];
  if (activity.kind === "workout" && type) {
    activity.summary = { ...activity.summary, sport: type[0], subSport: type[1] };
    activity.sessions = activity.sessions.map(s => ({ ...s, sport: type[0], subSport: type[1] }));
    activity.sport = type[0];
  }
  activity.typeOverride = stored.typeOverride;
  activity.healthVersion = stored.healthVersion ?? 1;
  activity.healthSharedVersion = stored.healthSharedVersion ?? 0;
  activity.healthSharedAt = stored.healthSharedAt;
  return activity;
}

export function needsHealthShare(record) {
  return (record.healthSharedVersion ?? 0) < (record.healthVersion ?? 1);
}

export function healthShareLabel(record) {
  if (!record.healthSharedVersion) return "Not marked shared";
  return needsHealthShare(record) ? "Changes need sharing" : "Shared with Health Connect";
}
