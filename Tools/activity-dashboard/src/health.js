// Export recorded intervals only; do not fill gaps or invent REM stages.
export function healthPayload(activity) {
  const { summary, records = [] } = activity;
  const start = Date.parse(summary.startTime);
  const end = Date.parse(summary.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("This recording has no valid start/end interval to share");
  }
  const stages = [];
  if (activity.kind === "sleep") {
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (![0, 1, 2].includes(record.sleepStage)) continue;
      const from = Math.max(start, Date.parse(record.timestamp));
      const next = i + 1 < records.length ? Date.parse(records[i + 1].timestamp) : end;
      const to = Math.min(end, next, from + 60_000);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
      const previous = stages.at(-1);
      if (previous?.stage === record.sleepStage && previous.end === from) previous.end = to;
      else stages.push({ start: from, end: to, stage: record.sleepStage });
    }
  }
  return {
    type: "health", id: activity.id, kind: activity.kind, version: activity.healthVersion ?? 1,
    start, end, sport: summary.sport, subSport: summary.subSport,
    distanceMeters: summary.distanceMeters, stages,
    heartRate: records.filter(r => Number.isFinite(r.heartRate) && r.heartRate > 0
      && r.heartRate <= 300 && Date.parse(r.timestamp) >= start && Date.parse(r.timestamp) < end)
      .map(r => ({ time: Date.parse(r.timestamp), bpm: Math.round(r.heartRate) })),
  };
}
