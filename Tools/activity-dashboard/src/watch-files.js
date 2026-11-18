// FIT recordings live under /Apps/<app>/Activity/<month> in the UNA filesystem.
export async function listWatchFits(client, onProgress = () => {}) {
  const files = [];
  onProgress("Listing installed watch apps");
  const apps = await client.listDir("/Apps");
  const appDirectories = apps
    .filter((entry) => entry.isDirectory && !entry.name.includes("/"))
    .sort((left, right) => Number(right.name.toLowerCase() === "sleepvue") - Number(left.name.toLowerCase() === "sleepvue"));
  onProgress(`Found ${appDirectories.length} installed app directories`);
  for (const app of appDirectories) {
    const activityPath = `/Apps/${app.name}/Activity`;
    let entries;
    try {
      onProgress(`Checking ${app.name} Activity directory`);
      entries = await client.listDir(activityPath);
      onProgress(`${app.name} Activity directory: ${entries.length} entries`);
    } catch (error) {
      // Most installed apps do not record activities.
      onProgress(`Skipping ${app.name} Activity directory: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const visit = async (directory, children, depth) => {
      for (const entry of children) {
        if (entry.name === "." || entry.name === ".." || entry.name.includes("/")) continue;
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory && depth < 2) {
          onProgress(`Checking ${app.name} subdirectory (level ${depth + 1})`);
          const nested = await client.listDir(path);
          onProgress(`${app.name} subdirectory (level ${depth + 1}): ${nested.length} entries`);
          await visit(path, nested, depth + 1);
        } else if (!entry.isDirectory && entry.name.toLowerCase().endsWith(".fit")) {
          files.push({ path, name: entry.name, size: entry.fileSize, app: app.name });
          onProgress(`Found ${files.length} FIT file${files.length === 1 ? "" : "s"}`);
        }
      }
    };
    await visit(activityPath, entries, 0);
  }
  onProgress(`Scan complete: ${files.length} FIT file${files.length === 1 ? "" : "s"}`);
  return files.sort((left, right) => right.path.localeCompare(left.path));
}
