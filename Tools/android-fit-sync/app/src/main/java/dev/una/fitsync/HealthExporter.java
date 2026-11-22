package dev.una.fitsync;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.InsertRecordsResponse;
import android.health.connect.datatypes.*;
import android.health.connect.datatypes.Record;
import android.health.connect.datatypes.units.Length;
import android.os.OutcomeReceiver;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** Android 14+ on-device, explicitly requested exports. No health read permissions. */
@androidx.annotation.RequiresApi(34)
@androidx.annotation.RequiresExtension(extension = android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE, version = 7)
final class HealthExporter {
    static final int REQUEST = 40;
    private final Activity activity;
    private final Consumer<String> report;
    private final Consumer<JSONObject> completion;
    private JSONObject pending;
    private boolean busy;

    HealthExporter(Activity activity, Consumer<String> report, Consumer<JSONObject> completion) {
        this.activity = activity;
        this.report = report;
        this.completion = completion;
    }

    void offer(JSONObject data) {
        if (busy) { report.accept("A Health Connect export is already in progress"); return; }
        busy = true;
        pending = data;
        if (data.optBoolean("confirmed", false)) { permissions(); return; }
        new AlertDialog.Builder(activity).setTitle("Share with Health Connect?")
                .setMessage("Share this recording's session, recorded heart rate, and "
                        + ("sleep".equals(data.optString("kind")) ? "sleep stages." : "distance when available.")
                        + "\n\nGoogle Fit can read these after you enable “Sync Fit with Health Connect” "
                        + "in its settings. Other apps with your permission can also read them. "
                        + "Sharing the same FIT again will not add another copy."
                        + "\n\nDeleting a recording here does not delete its Health Connect copy.")
                .setNegativeButton("Cancel", (d, w) -> finish(false, "Health Connect sharing cancelled"))
                .setOnCancelListener(d -> finish(false, "Health Connect sharing cancelled"))
                .setPositiveButton("Share", (d, w) -> permissions()).show();
    }

    private void reset() { pending = null; busy = false; }

    private void finish(boolean success, String message) {
        JSONObject result = new JSONObject();
        try {
            result.put("id", pending.getString("id"));
            result.put("version", pending.optLong("version", 1));
            result.put("success", success);
            result.put("message", message);
        } catch (Exception ignored) { }
        reset();
        report.accept(message);
        completion.accept(result);
    }

    private List<String> required() {
        List<String> permissions = new ArrayList<>();
        if (!"heart-rate".equals(pending.optString("kind"))) permissions.add("android.permission.health.WRITE_" +
                ("sleep".equals(pending.optString("kind")) ? "SLEEP" : "EXERCISE"));
        if (!"sleep".equals(pending.optString("kind")) && pending.optDouble("distanceMeters", 0) > 0)
            permissions.add("android.permission.health.WRITE_DISTANCE");
        if (pending.optJSONArray("heartRate") != null && pending.optJSONArray("heartRate").length() > 0)
            permissions.add("android.permission.health.WRITE_HEART_RATE");
        if (pending.optInt("restingHeartRate", 0) > 0)
            permissions.add("android.permission.health.WRITE_RESTING_HEART_RATE");
        return permissions;
    }

    private void permissions() {
        List<String> missing = new ArrayList<>();
        for (String permission : required())
            if (activity.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
        if (missing.isEmpty()) write();
        else activity.requestPermissions(missing.toArray(new String[0]), REQUEST);
    }

    void permissionResult() {
        if (pending == null) return;
        for (String permission : required()) {
            if (activity.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
                finish(false, "Health Connect permission declined · nothing shared; tap Share to retry");
                return;
            }
        }
        write();
    }

    private Metadata metadata(String id, String suffix, boolean sleep) {
        return new Metadata.Builder().setClientRecordId("una-fit:" + id + ":" + suffix)
                .setClientRecordVersion(Math.max(1, pending.optLong("version", 1)))
                .setRecordingMethod(sleep ? Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED
                        : Metadata.RECORDING_METHOD_ACTIVELY_RECORDED).build();
    }

    private int sport(String sport, String subSport) {
        if ("strength_training".equals(subSport)) return 45;
        if ("yoga".equals(subSport)) return 57;
        return switch (sport) {
            case "running" -> "treadmill".equals(subSport) ? 34 : 33;
            case "walking" -> 53;
            case "hiking" -> 21;
            case "cycling" -> "indoor_cycling".equals(subSport) ? 5 : 4;
            case "swimming" -> "open_water".equals(subSport) ? 48 : 49;
            case "rowing" -> "indoor_rowing".equals(subSport) ? 61 : 31;
            case "yoga" -> 57;
            case "strength_training" -> 45;
            default -> 58; // Other workout; do not label unknown/multisport as running.
        };
    }

    private void write() {
        try {
            JSONObject data = pending;
            String id = data.getString("id");
            if (!id.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid FIT identity");
            String kind = data.getString("kind");
            if (!kind.equals("sleep") && !kind.equals("workout") && !kind.equals("heart-rate"))
                throw new IllegalArgumentException("Invalid recording kind");
            boolean sleep = kind.equals("sleep");
            Instant start = Instant.ofEpochMilli(data.getLong("start"));
            Instant end = Instant.ofEpochMilli(data.getLong("end"));
            if (!end.isAfter(start) || end.isAfter(Instant.now())) throw new IllegalArgumentException("Invalid recording dates");
            var zone = kind.equals("heart-rate") ? ZoneId.of(data.getString("timeZone")) : ZoneId.systemDefault();
            var startZone = zone.getRules().getOffset(start);
            var endZone = zone.getRules().getOffset(end);
            List<Record> records = new ArrayList<>();
            if (sleep) {
                List<SleepSessionRecord.Stage> stages = new ArrayList<>();
                JSONArray source = data.getJSONArray("stages");
                for (int i = 0; i < source.length(); i++) {
                    JSONObject stage = source.getJSONObject(i);
                    int type = switch (stage.getInt("stage")) {
                        case 0 -> 1; case 1 -> 4; case 2 -> 5;
                        default -> throw new IllegalArgumentException("Invalid sleep stage");
                    };
                    stages.add(new SleepSessionRecord.Stage(Instant.ofEpochMilli(stage.getLong("start")),
                            Instant.ofEpochMilli(stage.getLong("end")), type));
                }
                records.add(new SleepSessionRecord.Builder(metadata(id, "sleep", true), start, end)
                        .setTitle("SleepVue sleep").setStages(stages)
                        .setStartZoneOffset(startZone).setEndZoneOffset(endZone).build());
            } else if (kind.equals("workout")) {
                records.add(new ExerciseSessionRecord.Builder(metadata(id, "exercise", false), start, end,
                        sport(data.optString("sport"), data.optString("subSport")))
                        .setTitle("UNA · " + data.optString("sport", "workout"))
                        .setStartZoneOffset(startZone).setEndZoneOffset(endZone).build());
                double distance = data.optDouble("distanceMeters", 0);
                if (Double.isFinite(distance) && distance > 0)
                    records.add(new DistanceRecord.Builder(metadata(id, "distance", false), start, end,
                            Length.fromMeters(distance)).setStartZoneOffset(startZone).setEndZoneOffset(endZone).build());
            }
            JSONArray heart = data.getJSONArray("heartRate");
            int resting = data.optInt("restingHeartRate", 0);
            if (kind.equals("heart-rate") && resting > 0) {
                if (resting > 300) throw new IllegalArgumentException("Invalid resting heart rate");
                Instant measured = Instant.ofEpochMilli(data.getLong("restingHeartRateTime"));
                if (measured.isBefore(start) || !measured.isBefore(end))
                    throw new IllegalArgumentException("Resting heart rate outside daily interval");
                records.add(new RestingHeartRateRecord.Builder(metadata(id, "resting-heart-rate", true),
                        measured, resting).setZoneOffset(zone.getRules().getOffset(measured)).build());
            }
            if (heart.length() > 0) {
                List<HeartRateRecord.HeartRateSample> samples = new ArrayList<>();
                for (int i = 0; i < heart.length(); i++) {
                    JSONObject sample = heart.getJSONObject(i);
                    samples.add(new HeartRateRecord.HeartRateSample(sample.getLong("bpm"),
                            Instant.ofEpochMilli(sample.getLong("time"))));
                }
                records.add(new HeartRateRecord.Builder(metadata(id, "heart-rate", sleep || kind.equals("heart-rate")), start, end, samples)
                        .setStartZoneOffset(startZone).setEndZoneOffset(endZone).build());
            }
            HealthConnectManager manager = activity.getSystemService(HealthConnectManager.class);
            if (manager == null) throw new IllegalStateException("Health Connect unavailable");
            report.accept("Sharing with Health Connect…");
            manager.insertRecords(records, activity.getMainExecutor(),
                    new OutcomeReceiver<InsertRecordsResponse, HealthConnectException>() {
                        @Override public void onResult(InsertRecordsResponse response) {
                            finish(true, "Shared with Health Connect · repeat exports do not add copies");
                        }
                        @Override public void onError(HealthConnectException error) {
                            finish(false, "Health Connect export failed: " + error.getMessage() + " · tap Share to retry");
                        }
                    });
        } catch (Exception error) {
            finish(false, "Health Connect export failed: " + error.getMessage());
        }
    }
}
