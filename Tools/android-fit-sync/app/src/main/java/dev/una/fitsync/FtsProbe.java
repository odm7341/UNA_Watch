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
import java.util.ArrayDeque;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

final class FtsProbe {
    interface Listener {
        void log(String message);
        void files(List<String> names);
    }

    private static final UUID SERVICE = UUID.fromString("0000febb-0000-1000-8000-00805f9b34fb");
    private static final UUID VERSION = UUID.fromString("adaf0001-4669-6c65-5472-616e73666572");
    private static final UUID RAW = UUID.fromString("adaf0002-4669-6c65-5472-616e73666572");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final String SLEEPVUE = "/Apps/SleepVue";

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
    private List<Entry> entries;
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
            try {
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
                int protocol = await(version, 10, "version read");
                ready = true;
                log("Connected and encrypted: FTS protocol v" + protocol);
            } catch (Exception error) {
                log("Connection failed: " + error.getMessage());
                closeGatt();
            }
        });
    }

    void inspectSleepVue() {
        worker.execute(() -> {
            if (!ready) {
                log("Connect to the watch first");
                return;
            }
            try {
                List<String> fitPaths = new ArrayList<>();
                List<String> csvPaths = new ArrayList<>();
                ArrayDeque<Directory> queue = new ArrayDeque<>();
                queue.add(new Directory(SLEEPVUE, 0));
                int visited = 0;
                while (!queue.isEmpty()) {
                    if (++visited > 64) throw new IllegalStateException("Directory safety limit reached");
                    Directory directory = queue.removeFirst();
                    log("Listing " + directory.path);
                    List<Entry> children = listDirectory(directory.path);
                    List<String> folders = new ArrayList<>();
                    int otherFiles = 0;
                    for (Entry child : children) {
                        if (child.directory) {
                            folders.add(child.name);
                            if (directory.depth < 5) {
                                queue.add(new Directory(directory.path + "/" + child.name, directory.depth + 1));
                            }
                        } else if (child.name.toLowerCase().endsWith(".fit")) {
                            fitPaths.add(directory.path + "/" + child.name);
                        } else if (child.name.toLowerCase().endsWith(".csv")) {
                            csvPaths.add(directory.path + "/" + child.name);
                        } else {
                            otherFiles++;
                        }
                    }
                    log(directory.path + ": " + folders.size() + " folders "
                            + folders + ", " + otherFiles + " other files");
                }
                log("Found " + fitPaths.size() + " FIT and " + csvPaths.size()
                        + " CSV files (names only; no download)");
                List<String> found = new ArrayList<>();
                for (String path : fitPaths) found.add("FIT · " + path);
                for (String path : csvPaths) found.add("CSV · " + path);
                listener.files(found);
            } catch (Exception error) {
                log("SleepVue listing failed: " + error.getMessage());
            }
        });
    }

    void disconnect() {
        worker.execute(() -> {
            closeGatt();
            log("Disconnected");
        });
    }

    void shutdown() {
        closeGatt();
        worker.shutdownNow();
    }

    private List<Entry> listDirectory(String path) throws Exception {
        byte[] name = path.getBytes(StandardCharsets.UTF_8);
        ByteBuffer packet = ByteBuffer.allocate(4 + name.length).order(ByteOrder.LITTLE_ENDIAN);
        packet.put((byte) 0x50).put((byte) 0).putShort((short) name.length).put(name);
        entries = new ArrayList<>();
        listing = new CompletableFuture<>();
        log("Sending LISTDIR (" + packet.capacity() + " bytes)");
        writeCommand(packet.array());
        return await(listing, 8, "LISTDIR " + path);
    }

    private void writeCommand(byte[] bytes) {
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
            throw new IllegalStateException("LISTDIR write start status " + status);
        }
    }

    private void writeDescriptor(BluetoothGattDescriptor descriptor, byte[] value) {
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
        CompletableFuture<List<Entry>> pending = listing;
        if (pending == null || pending.isDone() || value.length == 0) return;
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
                entries.add(new Entry(name, (data.getInt(12) & 1) != 0));
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
            if (status != BluetoothGatt.GATT_SUCCESS && listing != null) {
                listing.completeExceptionally(new IllegalStateException("LISTDIR GATT write status " + status));
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
        transfer = null;
        listing = null;
        entries = null;
        if (gatt != null) {
            gatt.disconnect();
            gatt.close();
            gatt = null;
        }
    }

    private void log(String message) {
        listener.log(message);
    }

    private static final class Entry {
        final String name;
        final boolean directory;

        Entry(String name, boolean directory) {
            this.name = name;
            this.directory = directory;
        }
    }

    private static final class Directory {
        final String path;
        final int depth;

        Directory(String path, int depth) {
            this.path = path;
            this.depth = depth;
        }
    }
}
