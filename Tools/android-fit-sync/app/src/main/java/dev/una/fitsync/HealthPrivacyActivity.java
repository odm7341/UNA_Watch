package dev.una.fitsync;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;

public final class HealthPrivacyActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        new AlertDialog.Builder(this).setTitle("Health data & privacy")
                .setMessage("UNA Activity stores imported FIT recordings and daily heart-rate history on this phone. "
                        + "Health Connect sharing happens when you choose Share or Sync, or enable automatic FIT sharing, "
                        + "and grant Android permission. It writes sleep sessions and stages, exercise "
                        + "sessions, recorded heart rate, daily resting heart rate, and workout distance when present. "
                        + "It does not read other apps' health data or upload recordings to a server.\n\n"
                        + "Google Fit and other apps can read Health Connect data only with your permission; "
                        + "their own sync settings govern any further sharing.\n\n"
                        + "Manage access and delete shared data in Android Settings → Health Connect. "
                        + "Deleting a local FIT does not delete its Health Connect copy, and revoking "
                        + "permission does not remove previously shared data.")
                .setPositiveButton("Done", (d, w) -> finish())
                .setOnCancelListener(d -> finish()).show();
    }
}
