import { readFile, writeFile } from "node:fs/promises";

const patches = [
  {
    path: "node_modules/@tanstack/start-server-core/src/createStartHandler.ts",
    before: `      responseOwnsCleanup = response.serverSsrCleanup === 'stream'
      return response.response
    } finally {`,
    after: `      responseOwnsCleanup = response.serverSsrCleanup === 'stream'
      return response.response
    } catch (err) {
      if (request.signal.aborted && err === request.signal.reason) {
        return new Response(null, {
          status: 499,
          statusText: 'Client Closed Request',
        })
      }
      throw err
    } finally {`,
  },
  {
    path: "node_modules/@tanstack/start-server-core/dist/esm/createStartHandler.js",
    before: `\t\t\tresponseOwnsCleanup = response.serverSsrCleanup === "stream";
\t\t\treturn response.response;
\t\t} finally {`,
    after: `\t\t\tresponseOwnsCleanup = response.serverSsrCleanup === "stream";
\t\t\treturn response.response;
\t\t} catch (err) {
\t\t\tif (request.signal.aborted && err === request.signal.reason) return new Response(null, {
\t\t\t\tstatus: 499,
\t\t\t\tstatusText: "Client Closed Request"
\t\t\t});
\t\t\tthrow err;
\t\t} finally {`,
  },
];

for (const patch of patches) {
  const source = await readFile(patch.path, "utf8");
  if (source.includes("statusText: 'Client Closed Request'") || source.includes('statusText: "Client Closed Request"')) {
    continue;
  }
  if (!source.includes(patch.before)) {
    console.warn(`Skipping TanStack client-abort patch (pattern not found) for ${patch.path}`);
    continue;
  }
  await writeFile(patch.path, source.replace(patch.before, patch.after));
}