// FIT recordings live under /Apps/<app>/Activity/<month> in the UNA filesystem.
export async function listWatchFits(client) {
  const files = [];
  const apps = await client.listDir("/Apps");
  for (const app of apps.filter((entry) => entry.isDirectory && !entry.name.includes("/"))) {
    const activityPath = `/Apps/${app.name}/Activity`;
    let entries;
    try {
      entries = await client.listDir(activityPath);
    } catch {
      // Most installed apps do not record activities.
      continue;
    }
    const visit = async (directory, children, depth) => {
      for (const entry of children) {
        if (entry.name === "." || entry.name === ".." || entry.name.includes("/")) continue;
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory && depth < 2) {
          await visit(path, await client.listDir(path), depth + 1);
        } else if (!entry.isDirectory && entry.name.toLowerCase().endsWith(".fit")) {
          files.push({ path, name: entry.name, size: entry.fileSize, app: app.name });
        }
      }
    };
    await visit(activityPath, entries, 0);
  }
  return files.sort((left, right) => right.path.localeCompare(left.path));
}
