package dev.una.fitsync;

import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.content.Context;
import android.os.Build;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.CRC32;

final class FtsProbe {
    interface Listener {
        void log(String message);
        void files(List<FitFile> names);
        void progress(String message);
        void imported(FitFile file, byte[] bytes);
    }

    private static final UUID SERVICE = UUID.fromString("0000febb-0000-1000-8000-00805f9b34fb");
    private static final UUID VERSION = UUID.fromString("adaf0001-4669-6c65-5472-616e73666572");
    private static final UUID RAW = UUID.fromString("adaf0002-4669-6c65-5472-616e73666572");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final int READ_WINDOW = 4096;
    private static final int MAX_FIT_BYTES = 4 * 1024 * 1024;

    private final Context context;
    private final Listener listener;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic transfer;
    private CompletableFuture<Void> connected;
    private CompletableFuture<Void> discovered;
    private CompletableFuture<Integer> negotiatedMtu;
    private CompletableFuture<Void> notifications;
    private CompletableFuture<Integer> version;
    private CompletableFuture<List<Entry>> listing;
    private CompletableFuture<long[]> digest;
    private volatile ReadTransfer reading;
    private List<Entry> entries;
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private final java.util.concurrent.atomic.AtomicInteger cancellationGeneration = new java.util.concurrent.atomic.AtomicInteger();
    private final List<FitFile> available = new ArrayList<>();
    private int protocol;
    private volatile boolean ready;

    FtsProbe(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
    }

    boolean isReady() {
        return ready;
    }

    void connect(BluetoothDevice device) {
        worker.execute(() -> {
            closeGatt();
            cancelled.set(false);
            try {
                if (context.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED)
                    throw new SecurityException("Nearby devices permission is required");
                log("Connecting to bonded " + device.getName() + " (BLE)...");
                connected = new CompletableFuture<>();
                gatt = device.connectGatt(context, false, callbacks, BluetoothDevice.TRANSPORT_LE);
                if (gatt == null) throw new IllegalStateException("connectGatt returned null");
                await(connected, 20, "GATT connection");

                log("Discovering FTS service...");
                discovered = new CompletableFuture<>();
                if (!gatt.discoverServices()) throw new IllegalStateException("discoverServices returned false");
                await(discovered, 15, "service discovery");
                BluetoothGattService service = gatt.getService(SERVICE);
                if (service == null) throw new IllegalStateException("FTS service is missing");
                BluetoothGattCharacteristic raw = service.getCharacteristic(RAW);
                BluetoothGattCharacteristic ver = service.getCharacteristic(VERSION);
                if (raw == null || ver == null) throw new IllegalStateException("FTS characteristics are missing");
                if ((raw.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) == 0
                        || (raw.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) == 0) {
                    throw new IllegalStateException("FTS transfer properties do not match the protocol");
                }
                transfer = raw;

                log("Negotiating an MTU for FTS paths...");
                negotiatedMtu = new CompletableFuture<>();
                if (!gatt.requestMtu(220)) throw new IllegalStateException("MTU request could not start");
                int mtu = await(negotiatedMtu, 10, "MTU negotiation");
                log("Negotiated MTU " + mtu);

                log("Enabling FTS notifications...");
                if (!gatt.setCharacteristicNotification(raw, true)) {
                    throw new IllegalStateException("setCharacteristicNotification returned false");
                }
                BluetoothGattDescriptor cccd = raw.getDescriptor(CCCD);
                if (cccd == null) throw new IllegalStateException("FTS notification descriptor is missing");
                notifications = new CompletableFuture<>();
                writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                await(notifications, 10, "notification setup");

                log("Reading FTS version...");
                version = new CompletableFuture<>();
                if (!gatt.readCharacteristic(ver)) throw new IllegalStateException("version read could not start");
                protocol = await(version, 10, "version read");
                if (protocol < 5) throw new IllegalStateException("Verified downloads require FTS v5");
                ready = true;
                log("Connected and encrypted: FTS protocol v" + protocol);
            } catch (Exception error) {
                log("Connection failed: " + error.getMessage());
                closeGatt();
            }
        });
    }

    void inspectActivities() {
        int generation = cancellationGeneration.get();
        worker.execute(() -> {
            if (generation != cancellationGeneration.get()) return;
            if (!ready) {
                log("Connect to the watch first");
                return;
            }
            cancelled.set(false);
            try {
                List<FitFile> found = new ArrayList<>();
                for (Entry app : listDirectory("/Apps")) {
                    checkCancelled();
                    if (!app.directory || app.name.startsWith(".") || app.name.contains("/")) continue;
                    String activity = "/Apps/" + app.name + "/Activity";
                    List<Entry> months;
                    try {
                        months = listDirectory(activity);
                    } catch (Exception missing) {
                        checkCancelled();
                        continue; // Most watch apps don't have an Activity directory.
                    }
                    for (Entry month : months) {
                        checkCancelled();
                        if (!month.directory || !month.name.matches("20[0-9]{4}")) continue;
                        String folder = activity + "/" + month.name;
                        for (Entry entry : listDirectory(folder)) {
                            if (!entry.directory && entry.name.toLowerCase(java.util.Locale.ROOT).endsWith(".fit")
                                    && entry.size > 0 && entry.size <= MAX_FIT_BYTES) {
                                found.add(new FitFile(folder + "/" + entry.name, entry.size));
                            }
                        }
                    }
                }
                synchronized (available) {
                    available.clear();
                    available.addAll(found);
                }
                log("Found " + found.size() + " completed activity FIT files");
                listener.files(found);
            } catch (Exception error) {
                log("Activity listing failed: " + error.getMessage());
                listener.progress("Watch scan failed: " + error.getMessage());
            }
        });
    }

    void inspectDailyHealth() {
        int generation = cancellationGeneration.get();
        worker.execute(() -> {
            if (generation != cancellationGeneration.get()) return;
            if (!ready) { log("Connect to the watch first"); return; }
            cancelled.set(false);
            try {
                List<FitFile> found = new ArrayList<>();
                for (Entry month : listDirectory("/DailyHealth")) {
                    checkCancelled();
                    if (!month.directory || !month.name.matches("20[2-9][0-9][01][0-9]")) continue;
                    String folder = "/DailyHealth/" + month.name;
                    for (Entry entry : listDirectory(folder)) {
                        if (!entry.directory && entry.name.matches("dh_20[0-9]{6}\\.json")
                                && entry.size > 0 && entry.size <= 65536)
                            found.add(new FitFile(folder + "/" + entry.name, entry.size));
                    }
                }
                synchronized (available) { available.clear(); available.addAll(found); }
                log("Found " + found.size() + " daily heart-rate files");
                listener.files(found);
            } catch (Exception error) {
                log("Daily health scan failed: " + error.getMessage());
            }
        });
    }

    void disconnect() {
        cancel();
        worker.execute(() -> {
            closeGatt();
            log("Disconnected");
        });
    }

    void shutdown() {
        cancel();
        closeGatt();
        worker.shutdownNow();
    }

    void cancel() {
        cancelled.set(true);
        cancellationGeneration.incrementAndGet();
        ReadTransfer current = reading;
        if (current != null) current.fail(new IllegalStateException("Transfer cancelled"));
        if (listing != null) listing.completeExceptionally(new IllegalStateException("Cancelled"));
        if (digest != null) digest.completeExceptionally(new IllegalStateException("Cancelled"));
    }

    void importFit(FitFile file) {
        int generation = cancellationGeneration.get();
        worker.execute(() -> {
            if (generation != cancellationGeneration.get()) return;
            if (!ready) { log("Connect to the watch first"); return; }
            synchronized (available) {
                if (!available.contains(file)) { log("Refresh the watch list before importing"); return; }
            }
            cancelled.set(false);
            try {
                listener.progress("Reading " + file.name() + "…");
                byte[] bytes = readFile(file);
                checkCancelled();
                reading = null;
                long[] expected = digestFile(file.path);
                checkCancelled();
                CRC32 crc = new CRC32();
                crc.update(bytes);
                if (expected[0] != bytes.length || expected[1] != crc.getValue()) {
                    throw new IllegalStateException("Watch digest CRC-32/size mismatch; file not imported");
                }
                listener.progress("Verified " + file.name() + " · " + bytes.length + " bytes");
                listener.imported(file, bytes);
            } catch (Exception error) {
                log("Import failed: " + error.getMessage());
                listener.progress("Import failed: " + error.getMessage());
            } finally {
                reading = null;
            }
        });
    }

    private byte[] readFile(FitFile file) throws Exception {
        byte[] path = file.path.getBytes(StandardCharsets.UTF_8);
        ByteBuffer packet = ByteBuffer.allocate(12 + path.length).order(ByteOrder.LITTLE_ENDIAN);
        packet.put((byte) 0x10).put((byte) 0).putShort((short) path.length)
                .putInt(0).putInt(READ_WINDOW).put(path);
        ReadTransfer transferState = new ReadTransfer(file.size);
        reading = transferState;
        writeCommand(packet.array());
        int retries = 0;
        while (!transferState.done()) {
            checkCancelled();
            int next;
            try {
                next = transferState.awaitWindow(12);
                retries = 0;
            } catch (java.util.concurrent.TimeoutException timeout) {
                if (++retries > 3) throw new IllegalStateException("READ stalled after 3 retries", timeout);
                next = transferState.position();
            }
            if (transferState.done()) break;
            checkCancelled();
            ByteBuffer pace = ByteBuffer.allocate(12).order(ByteOrder.LITTLE_ENDIAN);
            pace.put((byte) 0x12).put((byte) 1).putShort((short) 0)
                    .putInt(next).putInt(READ_WINDOW);
            transferState.nextWindow(next);
            writeCommand(pace.array());
        }
        return transferState.result();
    }

    private long[] digestFile(String path) throws Exception {
        byte[] name = path.getBytes(StandardCharsets.UTF_8);
        ByteBuffer packet = ByteBuffer.allocate(4 + name.length).order(ByteOrder.LITTLE_ENDIAN);
        packet.put((byte) 0x70).put((byte) 0).putShort((short) name.length).put(name);
        digest = new CompletableFuture<>();
        writeCommand(packet.array());
        return await(digest, 20, "DIGEST");
    }

    private void checkCancelled() {
        if (cancelled.get() || !ready) throw new IllegalStateException("Disconnected or cancelled");
    }

    private List<Entry> listDirectory(String path) throws Exception {
        byte[] name = path.getBytes(StandardCharsets.UTF_8);
        ByteBuffer packet = ByteBuffer.allocate(4 + name.length).order(ByteOrder.LITTLE_ENDIAN);
        packet.put((byte) 0x50).put((byte) 0).putShort((short) name.length).put(name);
        entries = new ArrayList<>();
        listing = new CompletableFuture<>();
        log("Sending LISTDIR (" + packet.capacity() + " bytes)");
        writeCommand(packet.array());
        return await(listing, 15, "LISTDIR " + path);
    }

    private void writeCommand(byte[] bytes) {
        if (context.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
                != android.content.pm.PackageManager.PERMISSION_GRANTED)
            throw new SecurityException("Nearby devices permission was revoked");
        int status;
        if (Build.VERSION.SDK_INT >= 33) {
            status = gatt.writeCharacteristic(
                    transfer, bytes, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
        } else {
            transfer.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
            transfer.setValue(bytes);
            status = gatt.writeCharacteristic(transfer) ? BluetoothStatusCodes.SUCCESS : -1;
        }
        if (status != BluetoothStatusCodes.SUCCESS) {
            throw new IllegalStateException("FTS write start status " + status);
        }
    }

    private void writeDescriptor(BluetoothGattDescriptor descriptor, byte[] value) {
        if (context.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
                != android.content.pm.PackageManager.PERMISSION_GRANTED)
            throw new SecurityException("Nearby devices permission was revoked");
        int status;
        if (Build.VERSION.SDK_INT >= 33) {
            status = gatt.writeDescriptor(descriptor, value);
        } else {
            descriptor.setValue(value);
            status = gatt.writeDescriptor(descriptor) ? BluetoothStatusCodes.SUCCESS : -1;
        }
        if (status != BluetoothStatusCodes.SUCCESS) {
            throw new IllegalStateException("notification descriptor write start status " + status);
        }
    }

    private static <T> T await(CompletableFuture<T> future, int seconds, String operation) throws Exception {
        try {
            return future.get(seconds, TimeUnit.SECONDS);
        } catch (java.util.concurrent.TimeoutException error) {
            throw new IllegalStateException(operation + " timed out after " + seconds + " seconds", error);
        }
    }

    private void onTransfer(byte[] value) {
        if (value.length == 0) return;
        int command = value[0] & 0xff;
        if (command == 0x11 && reading != null) {
            reading.accept(value);
            return;
        }
        if (command == 0x10 && reading != null && value.length >= 2) {
            reading.fail(new IllegalStateException("READ watch status " + (value[1] & 0xff)));
            return;
        }
        if (command == 0x71 && digest != null && !digest.isDone()) {
            if (value.length < 12 || (value[1] & 0xff) != 1) {
                digest.completeExceptionally(new IllegalStateException(
                        "DIGEST watch status " + (value.length > 1 ? value[1] & 0xff : -1)));
            } else {
                ByteBuffer packet = ByteBuffer.wrap(value).order(ByteOrder.LITTLE_ENDIAN);
                digest.complete(new long[]{Integer.toUnsignedLong(packet.getInt(4)),
                        Integer.toUnsignedLong(packet.getInt(8))});
            }
            return;
        }
        if (command == 0x70 && digest != null && value.length >= 2) {
            digest.completeExceptionally(new IllegalStateException("DIGEST watch status " + (value[1] & 0xff)));
            return;
        }
        CompletableFuture<List<Entry>> pending = listing;
        if (pending == null || pending.isDone()) return;
        // Firmware sends errors as two bytes with the original command (0x50),
        // not as a LISTDIR_ENTRY (0x51). A missing directory must not time out.
        if ((value[0] & 0xff) == 0x50 && value.length >= 2) {
            pending.completeExceptionally(new IllegalStateException(
                    "LISTDIR watch status " + (value[1] & 0xff)));
            return;
        }
        if ((value[0] & 0xff) != 0x51) return;
        try {
            if (value.length < 28) throw new IllegalStateException("short LISTDIR response");
            ByteBuffer data = ByteBuffer.wrap(value).order(ByteOrder.LITTLE_ENDIAN);
            int status = value[1] & 0xff;
            if (status != 1) throw new IllegalStateException("LISTDIR watch status " + status);
            int length = Short.toUnsignedInt(data.getShort(2));
            long index = Integer.toUnsignedLong(data.getInt(4));
            long count = Integer.toUnsignedLong(data.getInt(8));
            if (length == 0) {
                if (index != count) throw new IllegalStateException("invalid LISTDIR terminator");
                pending.complete(new ArrayList<>(entries));
                return;
            }
            if (value.length < 28 + length) throw new IllegalStateException("truncated LISTDIR name");
            String name = new String(value, 28, length, StandardCharsets.UTF_8);
            if (!name.equals(".") && !name.equals("..") && !name.contains("/")) {
                entries.add(new Entry(name, (data.getInt(12) & 1) != 0,
                        Integer.toUnsignedLong(data.getInt(24))));
            }
        } catch (RuntimeException error) {
            pending.completeExceptionally(error);
        }
    }

    private final BluetoothGattCallback callbacks = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt server, int status, int state) {
            if (server != gatt) return;
            if (state == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                if (connected != null) connected.complete(null);
            } else {
                ready = false;
                String reason = "GATT state " + state + ", status " + status;
                if (connected != null) connected.completeExceptionally(new IllegalStateException(reason));
                if (discovered != null) discovered.completeExceptionally(new IllegalStateException(reason));
                if (notifications != null) notifications.completeExceptionally(new IllegalStateException(reason));
                if (version != null) version.completeExceptionally(new IllegalStateException(reason));
                if (listing != null) listing.completeExceptionally(new IllegalStateException(reason));
                if (digest != null) digest.completeExceptionally(new IllegalStateException(reason));
                if (reading != null) reading.fail(new IllegalStateException(reason));
                log("Watch disconnected: " + reason);
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt server, int status) {
            if (server != gatt) return;
            finish(discovered, status, null, "service discovery");
        }

        @Override
        public void onMtuChanged(BluetoothGatt server, int mtu, int status) {
            if (server != gatt || negotiatedMtu == null) return;
            if (status == BluetoothGatt.GATT_SUCCESS) negotiatedMtu.complete(mtu);
            else negotiatedMtu.completeExceptionally(
                    new IllegalStateException("MTU negotiation GATT status " + status));
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt server, BluetoothGattDescriptor descriptor, int status) {
            if (server != gatt) return;
            finish(notifications, status, null, "notification descriptor write");
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt server, BluetoothGattCharacteristic characteristic,
                                         byte[] value, int status) {
            if (server != gatt) return;
            finishVersion(value, status);
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicRead(BluetoothGatt server, BluetoothGattCharacteristic characteristic, int status) {
            if (server == gatt && Build.VERSION.SDK_INT < 33) finishVersion(characteristic.getValue(), status);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt server, BluetoothGattCharacteristic characteristic,
                                            byte[] value) {
            if (server != gatt) return;
            if (RAW.equals(characteristic.getUuid())) onTransfer(value);
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt server, BluetoothGattCharacteristic characteristic) {
            if (server == gatt && Build.VERSION.SDK_INT < 33 && RAW.equals(characteristic.getUuid())) {
                onTransfer(characteristic.getValue());
            }
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt server, BluetoothGattCharacteristic characteristic, int status) {
            if (server != gatt) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                IllegalStateException error = new IllegalStateException("FTS GATT write status " + status);
                if (listing != null) listing.completeExceptionally(error);
                if (digest != null) digest.completeExceptionally(error);
                if (reading != null) reading.fail(error);
            }
        }
    };

    private void finishVersion(byte[] value, int status) {
        if (version == null) return;
        if (status != BluetoothGatt.GATT_SUCCESS) {
            version.completeExceptionally(new IllegalStateException("version read GATT status " + status));
        } else if (value == null || value.length < 4) {
            version.completeExceptionally(new IllegalStateException("invalid FTS version"));
        } else {
            version.complete(ByteBuffer.wrap(value).order(ByteOrder.LITTLE_ENDIAN).getInt());
        }
    }

    private static <T> void finish(CompletableFuture<T> future, int status, T result, String operation) {
        if (future == null) return;
        if (status == BluetoothGatt.GATT_SUCCESS) future.complete(result);
        else future.completeExceptionally(new IllegalStateException(operation + " GATT status " + status));
    }

    private void closeGatt() {
        ready = false;
        cancel();
        synchronized (available) { available.clear(); }
        transfer = null;
        listing = null;
        entries = null;
        if (gatt != null) {
            try { gatt.disconnect(); }
            catch (SecurityException denied) { log("Bluetooth permission revoked during disconnect"); }
            try { gatt.close(); }
            catch (SecurityException denied) { log("Bluetooth permission revoked during close"); }
            gatt = null;
        }
    }

    private void log(String message) {
        listener.log(message);
    }

    private static final class Entry {
        final String name;
        final boolean directory;
        final long size;

        Entry(String name, boolean directory, long size) {
            this.name = name;
            this.directory = directory;
            this.size = size;
        }
    }

    static final class FitFile {
        final String path;
        final long size;
        FitFile(String path, long size) { this.path = path; this.size = size; }
        String name() { return path.substring(path.lastIndexOf('/') + 1); }
    }

    private final class ReadTransfer {
        private final byte[] bytes;
        private final Map<Integer, byte[]> chunks = new HashMap<>();
        private int end;
        private int windowEnd = READ_WINDOW;
        private CompletableFuture<Integer> window = new CompletableFuture<>();
        ReadTransfer(long size) { bytes = new byte[(int) size]; }
        synchronized boolean done() { return end == bytes.length; }
        synchronized int position() { return end; }
        synchronized void nextWindow(int offset) {
            windowEnd = Math.min(bytes.length, offset + READ_WINDOW);
            window = new CompletableFuture<>();
        }
        int awaitWindow(int seconds) throws Exception {
            try { return window.get(seconds, TimeUnit.SECONDS); }
            catch (java.util.concurrent.ExecutionException e) { throw new IllegalStateException(e.getCause()); }
        }
        synchronized void fail(Exception e) { window.completeExceptionally(e); }
        synchronized byte[] result() { return bytes; }
        synchronized void accept(byte[] packet) {
            if (window.isCompletedExceptionally()) return;
            try {
                if (packet.length < 16 || packet[1] != 1) {
                    throw new IllegalStateException("READ watch status " + (packet.length > 1 ? packet[1] & 0xff : -1));
                }
                ByteBuffer data = ByteBuffer.wrap(packet).order(ByteOrder.LITTLE_ENDIAN);
                long offset = Integer.toUnsignedLong(data.getInt(4));
                long total = Integer.toUnsignedLong(data.getInt(8));
                long length = Integer.toUnsignedLong(data.getInt(12));
                if (total != bytes.length || offset > bytes.length || length == 0
                        || length > packet.length - 16 || offset + length > bytes.length) {
                    throw new IllegalStateException("Malformed or changed READ_DATA");
                }
                int start = (int) offset;
                if (start < end) {
                    if (start + length <= end) return;
                    throw new IllegalStateException("Overlapping READ_DATA");
                }
                if (start >= windowEnd || start + length > windowEnd) {
                    throw new IllegalStateException("READ_DATA outside requested window");
                }
                chunks.putIfAbsent(start, java.util.Arrays.copyOfRange(packet, 16, 16 + (int) length));
                while (chunks.containsKey(end)) {
                    byte[] piece = chunks.remove(end);
                    System.arraycopy(piece, 0, bytes, end, piece.length);
                    end += piece.length;
                }
                listener.progress("Reading " + end + " / " + bytes.length + " bytes");
                if (end >= windowEnd || end == bytes.length) window.complete(end);
            } catch (RuntimeException e) { window.completeExceptionally(e); }
        }
    }
}
