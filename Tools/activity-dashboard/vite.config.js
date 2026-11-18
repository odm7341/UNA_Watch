import { defineConfig } from "vite";

export default defineConfig({
  plugins: [{
    name: "local-watch-diagnostics",
    configureServer(server) {
      server.middlewares.use("/__watch-diagnostics", (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405).end();
          return;
        }
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1024) request.destroy();
        });
        request.on("end", () => {
          try {
            const { message } = JSON.parse(body);
            if (typeof message !== "string" || message.length > 300) throw new Error("Invalid diagnostic");
            console.log(`[watch diagnostics] ${message.replaceAll(/[\r\n]/g, " ")}`);
            response.writeHead(204).end();
          } catch {
            response.writeHead(400).end();
          }
        });
      });
    },
  }],
});
