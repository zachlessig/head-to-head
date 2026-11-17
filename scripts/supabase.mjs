// Small Supabase Management API helper for Head to Head. Token from SUPA_TOKEN, never printed.
//   node supa.mjs query "<sql>"            run SQL, print rows
//   node supa.mjs sqlfile <path>           run a .sql file
//   node supa.mjs deploy <slug> <dir> <verify_jwt true|false>
//   node supa.mjs secrets NAME=ENVVAR ...  set function secrets from this process's env vars
//   node supa.mjs list-functions
import { readFileSync } from "node:fs";
const REF = "vqgbtssybgaqietjbqms";
const T = process.env.SUPA_TOKEN;
const base = "https://api.supabase.com/v1/projects/" + REF;
const H = { Authorization: "Bearer " + T, "User-Agent": "head-to-head-deploy" };

async function call(path, init) {
  const res = await fetch(base + path, {
    ...init,
    headers: { ...H, ...(init && init.headers) },
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(path + " -> " + res.status + " " + text.slice(0, 400));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const query = (sql) =>
  call("/database/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "query") console.log(JSON.stringify(await query(args[0])));
else if (cmd === "sqlfile")
  console.log(JSON.stringify(await query(readFileSync(args[0], "utf8"))));
else if (cmd === "deploy") {
  const [slug, dir, vj] = args;
  const fd = new FormData();
  fd.append(
    "metadata",
    JSON.stringify({
      entrypoint_path: "index.ts",
      name: slug,
      verify_jwt: vj === "true",
    }),
  );
  fd.append(
    "file",
    new Blob([readFileSync(dir + "/index.ts")], {
      type: "application/typescript",
    }),
    "index.ts",
  );
  const r = await call("/functions/deploy?slug=" + slug, {
    method: "POST",
    body: fd,
  });
  console.log(
    slug,
    "deployed:",
    r.status || "",
    "version",
    r.version,
    "verify_jwt",
    r.verify_jwt,
  );
} else if (cmd === "secrets") {
  const body = args.map((a) => {
    const [name, env] = a.split("=");
    if (!process.env[env]) throw new Error("missing env " + env);
    return { name, value: process.env[env] };
  });
  await call("/secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log("secrets set:", body.map((b) => b.name).join(", "));
} else if (cmd === "list-functions") {
  const r = await call("/functions");
  console.log(
    r
      .map(
        (f) =>
          f.slug + " v" + f.version + " " + f.status + " jwt=" + f.verify_jwt,
      )
      .join("\n") || "none",
  );
} else console.log("unknown command");
