#!/usr/bin/env node
// SEC-5 client query inventory: every Supabase query the app issues against the tables whose organizer columns
// phase 2 closes (and the views that replace them), for an OLD client (a git ref) and the NEW client (the working
// tree), extracted with the TypeScript compiler API rather than by hand.
//
//   node scripts/sec5-client-query-inventory.mjs                       old = origin/staging/priv-rehearsal-r4, new = working tree
//   node scripts/sec5-client-query-inventory.mjs --old <ref> --new <ref|WORKTREE> --out <file>
//   node scripts/sec5-client-query-inventory.mjs --check               exit 1 if the committed JSON is stale
//
// What it finds, in src/ (tests excluded):
//   * every `<client>.from(<table>)` chain (string literal, or a const resolved in the file or imported from
//     src/lib/organizer-access.ts), with its select columns, count/head options, filters, modifiers, the write
//     (insert/upsert/update/delete) payload keys, on_conflict and the returning select;
//   * generic loops (`.from(q.table)`) driven by config objects `{ table: "<tracked>", ... }` (data export,
//     superadmin counts, image moderation), attributed to the client the loop uses;
//   * every `.on("postgres_changes", { table, filter, event })` with its channel name.
// Each entry gets the API role it runs as (browser session, server function with the user's session, service
// role) and a predicted phase-2 outcome from the closed-column list below. The predictions are checked against
// the database in supabase/tests/511_sec5_phase2_compat_matrix.test.sql.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const OLD_REF = opt("--old", "origin/staging/priv-rehearsal-r4");
const NEW_REF = opt("--new", "WORKTREE");
const OUT = opt("--out", "docs/privacy/sec5-client-query-inventory.json");
const CHECK = args.includes("--check");

// Columns closed to anon/authenticated: phase 1 (20261108110000) closes the first group, phase 2 the second.
const CLOSED_PHASE1 = { user_reports: ["reported_id"], game_position_waitlist: ["reviewed_by"] };
const CLOSED_PHASE2 = {
  hosted_games: ["host_id", "image", "host_snapshot"],
  join_requests: ["host_id"],
  game_payment_settings: ["host_id"],
};
const VIEWS = ["hosted_games_public", "join_requests_visible", "game_payment_settings_visible"];
const TRACKED = new Set([
  "hosted_games",
  "join_requests",
  "game_payment_settings",
  "game_position_waitlist",
  "user_reports",
  ...VIEWS,
]);
const FILTER_OPS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
  "containedBy",
  "overlaps",
  "match",
  "not",
  "or",
  "filter",
  "textSearch",
  "rangeGt",
  "rangeLt",
  "rangeGte",
  "rangeLte",
  "rangeAdjacent",
]);
const MODIFIERS = new Set([
  "order",
  "limit",
  "range",
  "single",
  "maybeSingle",
  "abortSignal",
  "csv",
  "returns",
  "throwOnError",
]);
const WRITES = new Set(["insert", "upsert", "update", "delete"]);

// ---------------------------------------------------------------------------------------------- source access
function git(...a) {
  return execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}
function listFiles(ref) {
  const keep = (p) =>
    /\.(ts|tsx)$/.test(p) &&
    !/\.test\.(ts|tsx)$/.test(p) &&
    !p.endsWith("routeTree.gen.ts") &&
    !p.includes("/integrations/supabase/types");
  if (ref === "WORKTREE") {
    const out = [];
    const walk = (d) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(relative(root, p));
      }
    };
    walk(join(root, "src"));
    return out.filter(keep).sort();
  }
  return git("ls-tree", "-r", "--name-only", ref, "src")
    .split("\n")
    .filter(Boolean)
    .filter(keep)
    .sort();
}
function readSource(ref, path) {
  return ref === "WORKTREE"
    ? readFileSync(join(root, path), "utf8")
    : git("show", `${ref}:${path}`);
}
function refSha(ref) {
  if (ref === "WORKTREE")
    return `${git("rev-parse", "HEAD").trim()}+worktree${git("status", "--porcelain", "src").trim() ? "(dirty)" : ""}`;
  return git("rev-parse", ref).trim();
}

// ---------------------------------------------------------------------------------------------- helpers
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const strip = (e) => {
  while (
    e &&
    (ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression?.(e) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)))
  )
    e = e.expression;
  return e;
};
function literal(e) {
  e = strip(e);
  if (!e) return undefined;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  return undefined;
}
function text(sf, e) {
  return e.getText(sf).replace(/\s+/g, " ");
}
function objectProps(sf, e, consts) {
  e = strip(e);
  if (!e || !ts.isObjectLiteralExpression(e)) return null;
  const out = {};
  for (const p of e.properties) {
    if (ts.isPropertyAssignment(p)) {
      const k = p.name.getText(sf).replace(/^["']|["']$/g, "");
      const lit =
        literal(p.initializer) ??
        (ts.isIdentifier(strip(p.initializer)) ? consts.get(strip(p.initializer).text) : undefined);
      out[k] = lit !== undefined ? lit : text(sf, p.initializer);
    } else if (ts.isShorthandPropertyAssignment(p)) {
      out[p.name.text] = `<${p.name.text}>`;
    } else if (ts.isSpreadAssignment(p)) {
      out[`...${text(sf, p.expression)}`] = "<spread>";
    }
  }
  return out;
}
// "a, b:c, d->>e, rel(x, y), *" -> top-level column names (embedded resources reported separately)
function parseSelect(s) {
  const cols = [];
  const embeds = [];
  let depth = 0;
  let cur = "";
  for (const ch of s + ",") {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      const t = cur.trim();
      if (t) {
        if (t.includes("(")) embeds.push(t);
        else {
          const noAlias = t.includes(":") && !t.includes("::") ? t.split(":").pop() : t;
          cols.push(noAlias.split("::")[0].split("->")[0].trim());
        }
      }
      cur = "";
    } else cur += ch;
  }
  return { columns: cols, star: cols.includes("*"), embeds };
}
function filterColumn(op, argsLit) {
  if (op === "or" || (op === "not" && argsLit[0] === undefined)) return null;
  return argsLit[0] ?? null;
}
function orColumns(expr) {
  // or("a.eq.1,b.is.null") -> [a, b]
  return expr
    .split(/,(?![^(]*\))/)
    .map((p) =>
      p
        .trim()
        .split(".")[0]
        .replace(/^and\(|^or\(/, ""),
    )
    .filter(Boolean);
}

// Module-level string constants in a file, plus GAMES_READ / JOIN_REQUESTS_READ / ... from organizer-access.ts.
function collectConsts(sf, imported) {
  const m = new Map(imported);
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const v = literal(n.initializer);
      if (v !== undefined) m.set(n.name.text, v);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return m;
}

// Receivers passed in as a parameter: the caller decides the role. Each override names the caller line that must
// still exist in the scanned tree (checked below), so a refactor that changes the client fails the scan instead of
// silently keeping a stale answer.
const PARAM_OVERRIDES = {
  "src/lib/support/assistant.server.ts": {
    receiver: "supabase",
    role: "server_user_session",
    caller: ["src/lib/support/support.functions.ts", /supabase:\s*context\.supabase/],
  },
};

// A receiver that is a parameter typed as the admin client (`admin: AdminClient`, `typeof supabaseAdmin`).
function paramTypedAdmin(node, name) {
  for (let n = node; n; n = n.parent) {
    if (ts.isFunctionLike(n) && n.parameters) {
      for (const p of n.parameters) {
        if (
          ts.isIdentifier(p.name) &&
          p.name.text === name &&
          p.type &&
          /Admin|supabaseAdmin|client\.server/.test(p.type.getText())
        )
          return true;
      }
    }
  }
  return false;
}

// Which API role a receiver expression runs as.
function classifyReceiver(sf, recv, fileText, node) {
  if (node && /^[A-Za-z_$][\w$]*$/.test(recv) && paramTypedAdmin(node, recv)) return "service_role";
  const t = recv.replace(/\s+/g, "");
  const ov = PARAM_OVERRIDES[sf.fileName];
  if (ov && ov.receiver === t) return ov.role;
  // a client the file builds itself with the publishable key: the user's bearer token when it forwards one, else anon
  if (
    /\bcreateClient\b/.test(fileText) &&
    /SUPABASE_PUBLISHABLE_KEY/.test(fileText) &&
    !/^context\.|^supabaseAdmin$/.test(t)
  )
    return /Authorization:\s*`Bearer/.test(fileText) ? "server_user_session" : "server_anon";
  if (/(^|\.)supabaseAdmin$|^admin$|^adminClient$|^serviceClient$/.test(t)) return "service_role";
  if (/^context\.supabase$|^ctx\.supabase$/.test(t)) return "server_user_session";
  if (t === "supabase") {
    if (/from\s+["']@\/integrations\/supabase\/client["']/.test(fileText)) return "browser_session";
    if (/from\s+["']@\/integrations\/supabase\/client\.server["']/.test(fileText))
      return "service_role";
    return "unresolved";
  }
  return "unresolved";
}

function enclosingName(node) {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name)
      return n.name.getText();
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    if (ts.isPropertyAssignment(n) && n.name) return n.name.getText();
  }
  return "<module>";
}

// ---------------------------------------------------------------------------------------------- scan one file
function scanFile(path, src, imported) {
  const sf = ts.createSourceFile(
    path,
    src,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const consts = collectConsts(sf, imported);
  const out = [];
  const genericFroms = [];

  // Walk the method chain upwards from a call: x.from(t).select(..).eq(..)...
  function chainUp(call) {
    const steps = [];
    let cur = call;
    for (;;) {
      const pa = cur.parent;
      if (!pa || !ts.isPropertyAccessExpression(pa) || pa.expression !== cur) break;
      const c = pa.parent;
      if (!c || !ts.isCallExpression(c) || c.expression !== pa) break;
      steps.push({ m: pa.name.text, args: c.arguments, node: c });
      cur = c;
    }
    return { steps, top: cur };
  }
  // A chain assigned to a variable and continued conditionally: `let q = ...; if (x) q = q.eq(...)`.
  function continuation(top) {
    let p = top.parent;
    while (
      p &&
      (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p))
    )
      p = p.parent;
    let name = null;
    if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) name = p.name.text;
    if (
      p &&
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(p.left)
    )
      name = p.left.text;
    if (!name) return [];
    let fn = p;
    while (fn && !ts.isFunctionLike(fn) && !ts.isSourceFile(fn)) fn = fn.parent;
    const extra = [];
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(strip(n.expression.expression)) &&
        strip(n.expression.expression).text === name &&
        n.pos > top.end
      ) {
        const { steps } = chainUp(n);
        extra.push(
          { m: n.expression.name.text, args: n.arguments, node: n, conditional: true },
          ...steps.map((s) => ({ ...s, conditional: true })),
        );
      }
      ts.forEachChild(n, visit);
    };
    if (fn) visit(fn);
    return extra;
  }

  function describe(call, relation, receiverText, generic) {
    const { steps, top } = chainUp(call);
    const all = [...steps, ...continuation(top)];
    const e = {
      file: path,
      line: lineOf(sf, call),
      function: enclosingName(call),
      receiver: receiverText,
      role: classifyReceiver(sf, receiverText, src, call),
      relation,
      kind: "read",
      select: null,
      count: null,
      filters: [],
      modifiers: [],
      write: null,
      returning: null,
    };
    if (generic) e.generic = generic;
    let sawWrite = false;
    for (const s of all) {
      const argLits = s.args.map(
        (a) =>
          literal(a) ??
          (ts.isIdentifier(strip(a)) ? consts.get(strip(a).text) : undefined) ??
          expandTemplate(a),
      );
      const argTexts = s.args.map((a) => text(sf, a));
      if (s.m === "select") {
        const raw = argLits[0] ?? (s.args.length ? `<${argTexts[0]}>` : "*");
        const parsed = raw.startsWith("<")
          ? { columns: [raw], star: false, embeds: [] }
          : parseSelect(raw);
        const opts = s.args[1]
          ? (objectProps(sf, s.args[1], consts) ??
            objectProps(sf, objectVar(s.args[1], s.node), consts))
          : null;
        const target = sawWrite ? "returning" : "select";
        e[target] = { raw, ...parsed, conditional: !!s.conditional };
        if (opts && (opts.count || opts.head))
          e.count = { count: opts.count ?? null, head: opts.head === "true" || opts.head === true };
      } else if (WRITES.has(s.m)) {
        sawWrite = true;
        e.kind = s.m;
        const payload = s.args[0] ? strip(s.args[0]) : null;
        let keys = null;
        let raw = null;
        if (payload && ts.isObjectLiteralExpression(payload))
          keys = Object.keys(objectProps(sf, payload, consts));
        else if (
          payload &&
          ts.isArrayLiteralExpression(payload) &&
          payload.elements[0] &&
          ts.isObjectLiteralExpression(strip(payload.elements[0]))
        )
          keys = Object.keys(objectProps(sf, payload.elements[0], consts));
        else if (payload) {
          raw = text(sf, payload).slice(0, 160);
          keys = resolvePayloadKeys(payload, s.node);
          if (keys) raw += " (keys resolved from its definition)";
        }
        const opts = s.args[1] ? objectProps(sf, s.args[1], consts) : null;
        e.write = { payloadKeys: keys, payloadExpr: raw, options: opts };
        if (s.m === "upsert") e.write.onConflict = opts?.onConflict ?? "<primary key>";
      } else if (FILTER_OPS.has(s.m)) {
        const f = {
          op: s.m,
          column: s.m === "or" ? null : (argLits[0] ?? `<${argTexts[0] ?? ""}>`),
          value: argTexts.slice(1).join(", ") || null,
          conditional: !!s.conditional,
        };
        if (s.m === "or") f.columns = argLits[0] ? orColumns(argLits[0]) : [`<${argTexts[0]}>`];
        if (s.m === "match") f.columns = Object.keys(objectProps(sf, s.args[0], consts) ?? {});
        e.filters.push(f);
      } else if (MODIFIERS.has(s.m)) {
        e.modifiers.push(s.m === "order" ? `order(${argLits[0] ?? argTexts[0]})` : s.m);
      }
    }
    if (e.kind === "read" && !e.select) e.select = null; // a bare .from() handed elsewhere
    return e;
  }

  // Keys of a payload passed as a variable or a builder call: `row` (const row = build(...); row.x = ...) or `build(g)`.
  function functionReturnKeys(fname) {
    let keys = null;
    const visit = (n) => {
      const isNamed =
        (ts.isFunctionDeclaration(n) && n.name?.text === fname) ||
        (ts.isVariableDeclaration(n) &&
          ts.isIdentifier(n.name) &&
          n.name.text === fname &&
          n.initializer &&
          ts.isArrowFunction(strip(n.initializer)));
      if (isNamed) {
        const body = ts.isFunctionDeclaration(n) ? n.body : strip(n.initializer).body;
        const scan = (m) => {
          if (
            ts.isReturnStatement(m) &&
            m.expression &&
            ts.isObjectLiteralExpression(strip(m.expression))
          )
            keys = Object.keys(objectProps(sf, m.expression, consts));
          else if (!ts.isFunctionLike(m)) ts.forEachChild(m, scan);
        };
        if (body && ts.isObjectLiteralExpression(strip(body)))
          keys = Object.keys(objectProps(sf, body, consts));
        else if (body) ts.forEachChild(body, scan);
      }
      if (!keys) ts.forEachChild(n, visit);
    };
    visit(sf);
    return keys;
  }
  function resolvePayloadKeys(payload, at) {
    payload = strip(payload);
    if (ts.isCallExpression(payload) && ts.isIdentifier(payload.expression))
      return functionReturnKeys(payload.expression.text);
    if (!ts.isIdentifier(payload)) return null;
    const name = payload.text;
    let fn = at;
    while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
    if (!fn) return null;
    let keys = null;
    const extra = new Set();
    const visit = (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === name &&
        n.initializer
      ) {
        const init = strip(n.initializer);
        if (ts.isObjectLiteralExpression(init)) keys = Object.keys(objectProps(sf, init, consts));
        else if (ts.isCallExpression(init) && ts.isIdentifier(init.expression))
          keys = functionReturnKeys(init.expression.text);
        else keys = keys ?? [];
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const l = strip(n.left);
        if (
          ts.isPropertyAccessExpression(l) &&
          ts.isIdentifier(strip(l.expression)) &&
          strip(l.expression).text === name
        )
          extra.add(l.name.text);
        if (
          ts.isElementAccessExpression(l) &&
          ts.isIdentifier(strip(l.expression)) &&
          strip(l.expression).text === name &&
          literal(l.argumentExpression)
        )
          extra.add(literal(l.argumentExpression));
      }
      ts.forEachChild(n, visit);
    };
    visit(fn);
    if (keys === null && !extra.size) return null;
    return [...new Set([...(keys ?? []), ...extra])];
  }

  // `${CONST},more` with every substitution a known string constant -> the expanded string
  function expandTemplate(a) {
    a = strip(a);
    if (!a || !ts.isTemplateExpression(a)) return undefined;
    let out = a.head.text;
    for (const span of a.templateSpans) {
      const e = strip(span.expression);
      const v = ts.isIdentifier(e) ? consts.get(e.text) : undefined;
      if (v === undefined) return undefined;
      out += v + span.literal.text;
    }
    return out;
  }
  // an options object passed by name: `const head = { count: "exact", head: true }` in an enclosing scope
  function objectVar(a, at) {
    a = strip(a);
    if (!ts.isIdentifier(a)) return null;
    let found = null;
    for (let scope = at; scope && !found; scope = scope.parent) {
      if (!(ts.isFunctionLike(scope) || ts.isSourceFile(scope))) continue;
      const visit = (n) => {
        if (found) return;
        if (
          ts.isVariableDeclaration(n) &&
          ts.isIdentifier(n.name) &&
          n.name.text === a.text &&
          n.initializer &&
          ts.isObjectLiteralExpression(strip(n.initializer))
        )
          found = n.initializer;
        else ts.forEachChild(n, visit);
      };
      visit(scope);
    }
    return found;
  }

  const realtime = [];
  const configs = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const name = n.expression.name.text;
      const recvExpr = strip(n.expression.expression);
      // .from(<table>) on a Supabase client, not storage.from(bucket)
      if (
        name === "from" &&
        n.arguments.length === 1 &&
        !/\.storage$/.test(text(sf, recvExpr)) &&
        !/^(Array|Buffer|Object|Uint8Array)$/.test(text(sf, recvExpr))
      ) {
        const a = strip(n.arguments[0]);
        let rel = literal(a);
        if (rel === undefined && ts.isIdentifier(a)) rel = consts.get(a.text);
        if (rel !== undefined) {
          if (TRACKED.has(rel)) out.push(describe(n, rel, text(sf, recvExpr)));
        } else if (ts.isPropertyAccessExpression(a) || ts.isIdentifier(a)) {
          genericFroms.push({ call: n, recv: text(sf, recvExpr), arg: text(sf, a) });
        }
      }
      if (name === "on" && literal(n.arguments[0]) === "postgres_changes") {
        const props = objectProps(sf, n.arguments[1], consts) ?? {};
        const tbl = props.table;
        if (tbl && TRACKED.has(tbl)) {
          // find .channel(name) further down the receiver chain
          let ch = null;
          let r = recvExpr;
          for (let i = 0; i < 20 && r; i++) {
            r = strip(r);
            if (ts.isCallExpression(r) && ts.isPropertyAccessExpression(r.expression)) {
              if (r.expression.name.text === "channel") {
                ch = r.arguments[0] ? text(sf, r.arguments[0]) : null;
                break;
              }
              r = r.expression.expression;
            } else if (ts.isIdentifier(r)) {
              ch = `<variable ${r.text}>`;
              break;
            } else break;
          }
          realtime.push({
            file: path,
            line: lineOf(sf, n),
            function: enclosingName(n),
            role: /from\s+["']@\/integrations\/supabase\/client["']/.test(src)
              ? "browser_session"
              : "unresolved",
            relation: tbl,
            kind: "realtime",
            channel: ch,
            event: props.event ?? null,
            schema: props.schema ?? null,
            filter: props.filter ?? null,
          });
        }
      }
    }
    // config objects { table: "<tracked>", ... } consumed by a generic .from(q.table) loop in the same file
    if (ts.isObjectLiteralExpression(n)) {
      const props = objectProps(sf, n, consts);
      if (
        props &&
        typeof props.table === "string" &&
        TRACKED.has(props.table) &&
        !("schema" in props && "event" in props) &&
        !("event" in props)
      ) {
        configs.push({ node: n, props });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  for (const { node, props } of configs) {
    const g = genericFroms[0];
    const e = {
      file: path,
      line: lineOf(sf, node),
      function: enclosingName(node),
      receiver: g ? g.recv : null,
      role: g ? classifyReceiver(sf, g.recv, src, g.call) : "unresolved",
      relation: props.table,
      kind: "read",
      select: null,
      count: null,
      filters: [],
      modifiers: [],
      write: null,
      returning: null,
      generic: { loop: g ? `${path}:${lineOf(sf, g.call)} .from(${g.arg})` : null, config: props },
    };
    if (g) {
      // the generic loop's own chain decides the shape; the config supplies the literals
      const d = describe(g.call, props.table, g.recv, null);
      e.kind = d.kind;
      e.count = d.count;
      e.modifiers = d.modifiers;
      if (d.select) {
        const fromConfig =
          /columns/.test(d.select.raw) && typeof props.columns === "string" ? props.columns : null;
        const raw = fromConfig ?? (Array.isArray(props.columns) ? "id" : d.select.raw);
        e.select = {
          raw,
          ...parseSelect(raw.startsWith("<") ? "id" : raw),
          conditional: false,
          from: fromConfig ? "config.columns" : "loop",
        };
      }
      e.filters = d.filters.map((f) =>
        f.column && f.column.startsWith("<") && /column/.test(f.column) && props.column
          ? { ...f, column: props.column, from: "config.column" }
          : f,
      );
      if (
        Array.isArray(props.columns) ||
        (typeof props.columns === "string" && props.columns.startsWith("["))
      )
        e.generic.note = "per-column loop (service role)";
    }
    out.push(e);
  }
  return [...out, ...realtime];
}

// ---------------------------------------------------------------------------------------------- phase-2 prediction
function closedFor(rel, phase) {
  const base = rel;
  const c = [...(CLOSED_PHASE1[base] ?? [])];
  if (phase >= 2) c.push(...(CLOSED_PHASE2[base] ?? []));
  return c;
}
function predict(e, phase) {
  if (e.role === "service_role")
    return { outcome: "unaffected", reason: "service role (grants unchanged)" };
  if (VIEWS.includes(e.relation))
    return { outcome: "ok", reason: "view reads closed columns through a definer function" };
  const closed = closedFor(e.relation, phase);
  if (e.kind === "realtime") {
    const fcol = e.filter
      ? String(e.filter)
          .replace(/^[`"']/, "")
          .split("=")[0]
      : null;
    if (fcol && closed.includes(fcol))
      return {
        outcome: "sandbox",
        reason: `filter on closed column ${fcol}: Realtime drops the column from the subscriber's view; filter likely never matches (verify in sandbox)`,
      };
    if (closed.length)
      return { outcome: "ok-stripped", reason: `payload loses ${closed.join(", ")}` };
    return { outcome: "ok", reason: "no closed column" };
  }
  if (!closed.length) return { outcome: "ok", reason: "no closed column on this table" };
  const problems = [];
  const sel = e.select;
  if (sel) {
    if (sel.star) problems.push("select=* (permission denied for table)");
    for (const c of sel.columns) if (closed.includes(c)) problems.push(`selects ${c}`);
  }
  if (e.returning) {
    if (e.returning.star) problems.push("RETURNING * (return=representation)");
    for (const c of e.returning.columns) if (closed.includes(c)) problems.push(`returns ${c}`);
  }
  for (const f of e.filters) {
    const cols = f.columns ?? [f.column];
    for (const c of cols) if (c && closed.includes(c)) problems.push(`filter ${f.op}(${c})`);
  }
  for (const m of e.modifiers) {
    const mm = /^order\((.*)\)$/.exec(m);
    if (mm && closed.includes(mm[1])) problems.push(`order by ${mm[1]}`);
  }
  if (e.kind === "upsert") {
    const conflict = String(e.write.onConflict ?? "")
      .split(",")
      .map((s) => s.trim());
    const keys = e.write.payloadKeys ?? [];
    for (const c of closed)
      if (conflict.includes(c) || keys.includes(c))
        problems.push(`upsert reads EXCLUDED/arbiter ${c}`);
  }
  if (problems.length) return { outcome: "breaks", reason: problems.join("; ") };
  return { outcome: "ok", reason: "touches no closed column" };
}

// A coarse key for "the same query shape as far as the closed columns go"; 511 runs one probe per key.
function shapeKey(e) {
  if (e.role === "service_role") return "service_role";
  if (e.kind === "realtime")
    return `realtime:${e.relation}${
      e.filter
        ? `:filter=${
            String(e.filter)
              .replace(/^[`"']/, "")
              .split("=")[0]
          }`
        : ""
    }`;
  const closed = [...new Set([...closedFor(e.relation, 2)])];
  const bits = [e.relation, e.kind];
  if (e.select?.star) bits.push("select=*");
  const selClosed = (e.select?.columns ?? []).filter((c) => closed.includes(c));
  if (selClosed.length) bits.push(`select:${selClosed.join("+")}`);
  const fClosed = e.filters
    .flatMap((f) => f.columns ?? [f.column])
    .filter((c) => c && closed.includes(c));
  if (fClosed.length) bits.push(`filter:${[...new Set(fClosed)].join("+")}`);
  if (e.returning) bits.push(e.returning.star ? "returning=*" : "returning=cols");
  if (e.kind === "upsert") bits.push(`on_conflict=${e.write.onConflict}`);
  if (e.count?.head) bits.push("head");
  if (bits.length === 2 && closed.length) bits.push("open-columns");
  return bits.join("|");
}

// ---------------------------------------------------------------------------------------------- run
function importedConsts(ref, files) {
  const m = new Map();
  const p = "src/lib/organizer-access.ts";
  if (files.includes(p)) {
    const sf = ts.createSourceFile(p, readSource(ref, p), ts.ScriptTarget.Latest, true);
    for (const [k, v] of collectConsts(sf, new Map())) m.set(k, v);
  }
  return m;
}
function inventory(ref) {
  const files = listFiles(ref);
  for (const [file, ov] of Object.entries(PARAM_OVERRIDES)) {
    if (!files.includes(file)) continue;
    const [callerFile, re] = ov.caller;
    if (!files.includes(callerFile) || !re.test(readSource(ref, callerFile)))
      throw new Error(
        `${ref}: ${file} receiver override is stale (${callerFile} no longer matches ${re})`,
      );
  }
  const imported = importedConsts(ref, files);
  const entries = [];
  for (const f of files) {
    const src = readSource(ref, f);
    if (
      !/(hosted_games|join_requests|game_payment_settings|game_position_waitlist|user_reports|GAMES_READ|JOIN_REQUESTS_READ|PAYMENT_SETTINGS_READ)/.test(
        src,
      )
    )
      continue;
    entries.push(...scanFile(f, src, imported));
  }
  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  entries.forEach((e, i) => {
    e.id = `${e.file.replace(/^src\//, "")}:${e.line}:${e.relation}:${e.kind}`;
    e.phase1 = predict(e, 1);
    e.phase2 = predict(e, 2);
    e.shape = shapeKey(e);
  });
  return entries;
}
function summarize(entries) {
  const by = (k) => entries.reduce((m, e) => ((m[e[k]] = (m[e[k]] ?? 0) + 1), m), {});
  const api = entries.filter((e) => e.role !== "service_role");
  return {
    total: entries.length,
    byRelation: by("relation"),
    byKind: by("kind"),
    byRole: by("role"),
    apiRole: api.length,
    phase2Breaks: api
      .filter((e) => e.phase2.outcome === "breaks")
      .map((e) => `${e.id} — ${e.phase2.reason}`),
    phase2Sandbox: api
      .filter((e) => e.phase2.outcome === "sandbox")
      .map((e) => `${e.id} — ${e.phase2.reason}`),
    unresolvedRole: entries.filter((e) => e.role === "unresolved").map((e) => e.id),
    shapes: entries.reduce((m, e) => ((m[e.shape] = (m[e.shape] ?? 0) + 1), m), {}),
  };
}

const old = inventory(OLD_REF);
const neu = inventory(NEW_REF);
const result = {
  generatedBy: "scripts/sec5-client-query-inventory.mjs",
  closedColumns: { phase1: CLOSED_PHASE1, phase2: CLOSED_PHASE2 },
  views: VIEWS,
  old: { ref: OLD_REF, sha: refSha(OLD_REF), summary: summarize(old), entries: old },
  new: {
    ref: NEW_REF === "WORKTREE" ? "claude/sec5-public-organizer-ref (working tree)" : NEW_REF,
    sha: NEW_REF === "WORKTREE" ? "see git log" : refSha(NEW_REF),
    summary: summarize(neu),
    entries: neu,
  },
};
// Formatted as the repository's prettier formats it, so `--check` and `format:check:changed` agree.
const prettier = await import("prettier");
const json = await prettier.format(JSON.stringify(result, null, 2), {
  ...((await prettier.resolveConfig(join(root, OUT))) ?? {}),
  parser: "json",
});
const outPath = join(root, OUT);
if (CHECK) {
  const cur = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (cur !== json) {
    console.error(`${OUT} is stale: re-run node scripts/sec5-client-query-inventory.mjs`);
    process.exit(1);
  }
  console.log(`${OUT} is current`);
} else {
  writeFileSync(outPath, json);
  for (const [k, v] of [
    ["old", result.old],
    ["new", result.new],
  ]) {
    const s = v.summary;
    console.log(
      `${k} (${v.ref}): ${s.total} entries, ${s.apiRole} as API roles; phase 2 breaks ${s.phase2Breaks.length}, sandbox ${s.phase2Sandbox.length}, unresolved role ${s.unresolvedRole.length}`,
    );
  }
}
