// Keep the legacy database name so the v2 upgrade preserves existing browser data.
const DB_NAME = "sleepvue-web";
const DB_VERSION = 2;
const ACTIVITY_STORE = "activities";
const FILE_STORE = "activity-files";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other UNA Activity Dashboard tabs before upgrading local storage"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ACTIVITY_STORE)) {
        const activities = database.createObjectStore(ACTIVITY_STORE, { keyPath: "id" });
        activities.createIndex("startTime", "startTime");
        activities.createIndex("kind", "kind");
        activities.createIndex("sport", "sport");
      }
      if (!database.objectStoreNames.contains(FILE_STORE)) {
        database.createObjectStore(FILE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function storedBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  throw new TypeError("Activity bytes must be an ArrayBuffer or typed array");
}

export async function putActivity(activity) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([ACTIVITY_STORE, FILE_STORE], "readwrite");
    const activities = transaction.objectStore(ACTIVITY_STORE);
    const files = transaction.objectStore(FILE_STORE);
    const existing = await requestResult(activities.get(activity.id));
    if (existing) {
      await transactionDone(transaction);
      return { status: "duplicate", record: existing };
    }

    const { bytes, ...metadata } = activity;
    activities.add(metadata);
    files.add({ id: activity.id, bytes: storedBuffer(bytes) });
    await transactionDone(transaction);
    return { status: "imported", record: metadata };
  } finally {
    database.close();
  }
}

export async function getActivity(id) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([ACTIVITY_STORE, FILE_STORE]);
    const metadataPromise = requestResult(transaction.objectStore(ACTIVITY_STORE).get(id));
    const filePromise = requestResult(transaction.objectStore(FILE_STORE).get(id));
    const [metadata, file] = await Promise.all([metadataPromise, filePromise]);
    await transactionDone(transaction);
    return metadata && file ? { ...metadata, bytes: file.bytes } : null;
  } finally {
    database.close();
  }
}

export async function listActivities() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(ACTIVITY_STORE);
    const records = await requestResult(transaction.objectStore(ACTIVITY_STORE).getAll());
    await transactionDone(transaction);
    return records.sort((left, right) => {
      const startDifference = Date.parse(right.startTime ?? "") - Date.parse(left.startTime ?? "");
      if (Number.isFinite(startDifference) && startDifference !== 0) return startDifference;
      return Date.parse(right.importedAt) - Date.parse(left.importedAt);
    });
  } finally {
    database.close();
  }
}

export async function deleteActivity(id) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([ACTIVITY_STORE, FILE_STORE], "readwrite");
    transaction.objectStore(ACTIVITY_STORE).delete(id);
    transaction.objectStore(FILE_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
