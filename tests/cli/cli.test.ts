// docs/cli.md
import { describe, expect, it } from "vitest";
import { run } from "../../srcs/cli/run.js";

const MAIN = `option timezone Asia/Taipei
account-root Bank asset
commodity NTD
    precision 0

2026-10-01 * "Opening"
    Bank:Checking     12300 NTD
    Equity:Opening   -12300 NTD

2026-10-03 "Bookstore"
    Expenses:Other     500 NTD
    Bank:Checking     -500 NTD

2026-10-12 * "Supermarket"
    Expenses:Groceries     2700 NTD
    Bank:Checking         -2700 NTD [2026-10-14]

2026-10-25 balance Bank:Checking 9100 NTD
`;

interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `hueke` with the files given, under /ledger as the current directory unless given. */
function hueke(
  args: string,
  files: Record<string, string> = { "/ledger/main.hueke": MAIN },
  cwd = "/ledger",
): Result {
  let stdout = "";
  let stderr = "";
  const status = run(args.split(" ").filter(Boolean), {
    cwd,
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { status, stdout, stderr };
}

describe("loading", () => {
  it("needs --file", () => {
    expect(hueke("check")).toMatchObject({ status: 2, stderr: "hueke: --file is required\n" });
  });
  it("reads --file from the current directory and keys it by its path under --root", () => {
    const files = { "/books/2026/main.hueke": '2026-10-01 * "x"\n    Assets:Cash 1 NTD\n' };
    const r = hueke("check --root /books --file 2026/main.hueke --format csv", files, "/books");
    expect(hueke("check --root /books --file /books/2026/main.hueke --format csv", files)).toEqual(
      r,
    );
    expect(r.status).toBe(1);
    expect(r.stdout.split("\n").map((line) => line.split(",").slice(0, 5).join(","))).toEqual([
      "source,line,column,severity,code",
      "2026/main.hueke,,,warning,option.missing-timezone",
      "2026/main.hueke,2,5,info,name.inferred-commodity",
      "2026/main.hueke,1,1,error,txn.unbalanced",
      "",
    ]);
  });
  it("reads a file under a relative --root", () => {
    const files = { "/work/ledger/main.hueke": MAIN };
    expect(
      hueke("balance --root ledger --file ledger/main.hueke --at 2026-10-31", files, "/work"),
    ).toEqual(hueke("balance --file main.hueke --at 2026-10-31"));
    const broken = { "/work/ledger/main.hueke": MAIN.replace("9100 NTD\n", "9000 NTD\n") };
    expect(hueke("check --root ledger --file ledger/main.hueke", broken, "/work").stdout).toMatch(
      /^main\.hueke:18:1: error balance\.mismatch: /,
    );
  });
  it("refuses a file outside --root and a root file it cannot read", () => {
    const files = { "/work/ledger/main.hueke": MAIN, "/work/main.hueke": MAIN };
    const outside = hueke("balance --root ledger --file main.hueke", files, "/work");
    expect(outside).toMatchObject({ status: 2, stdout: "" });
    expect(outside.stderr).toMatch(/^hueke: main\.hueke is outside --root/);
    expect(hueke("check --file ../main.hueke")).toMatchObject({
      status: 2,
      stderr: expect.stringMatching(/^hueke: \.\.\/main\.hueke is outside --root/) as unknown,
    });
    expect(hueke("check --file other.hueke")).toMatchObject({
      status: 2,
      stderr: "hueke: cannot read /ledger/other.hueke\n",
    });
  });
  it("refuses an absolute --file outside --root", () => {
    const files = { "/ledger/main.hueke": MAIN, "/other/main.hueke": MAIN };
    const r = hueke("check --file /other/main.hueke", files);
    expect(r).toMatchObject({ status: 2, stdout: "" });
    expect(r.stderr).toMatch(/^hueke: \/other\/main\.hueke is outside --root/);
  });
  it("reads the files the ledger includes", () => {
    const files = {
      "/ledger/main.hueke": `${MAIN}include 2026/10.hueke\ninclude 2026/11.hueke\n`,
      "/ledger/2026/10.hueke":
        'include ../accounts.hueke\n2026-10-30 * "Late"\n    Expenses:Other  100 NTD\n    Bank:Checking\n',
      "/ledger/accounts.hueke": "account Bank:Checking\n",
    };
    const r = hueke("check --file main.hueke", files);
    expect(r).toMatchObject({ status: 1 });
    expect(r.stdout).toBe(
      "main.hueke:20:1: error module.missing: 2026/11.hueke is not loaded\n" +
        "accounts.hueke:1:1: warning module.ignored-declaration: account Bank:Checking is ignored: only the root module's declarations take effect\n",
    );
    expect(hueke("balance Bank --file main.hueke --at 2026-10-31", files).stdout).toContain(
      "9000 NTD  Bank (total)",
    );
  });
  it("leaves out an included file it cannot read", () => {
    const files = { "/ledger/main.hueke": `${MAIN}include missing.hueke\n` };
    const r = hueke("balance Bank --file main.hueke --at 2026-10-31", files);
    expect(r).toMatchObject({
      status: 0,
      stdout: "9100 NTD  Bank (total)\n9100 NTD    Bank:Checking\n",
      stderr: "main.hueke:19:1: error module.missing: missing.hueke is not loaded\n",
    });
    expect(hueke("check --file main.hueke", files)).toMatchObject({
      status: 1,
      stdout: "main.hueke:19:1: error module.missing: missing.hueke is not loaded\n",
    });
  });
  it("ignores the declarations of an included file", () => {
    const files = {
      "/ledger/main.hueke": `${MAIN}include extra.hueke\n`,
      "/ledger/extra.hueke":
        "option timezone UTC\ncommodity NTD\n    precision 2\naccount-root Bank liability\n",
    };
    const ignored = (line: number, what: string) =>
      `extra.hueke:${String(line)}:1: warning module.ignored-declaration: ${what} is ignored: only the root module's declarations take effect\n`;
    expect(hueke("check --file main.hueke", files)).toEqual({
      status: 0,
      stdout:
        ignored(1, "option timezone") +
        ignored(2, "commodity NTD") +
        ignored(4, "account-root Bank"),
      stderr: "",
    });
    expect(hueke("balance Bank --file main.hueke", files).stdout).toBe(
      "9100 NTD  Bank (total)\n9100 NTD    Bank:Checking\n",
    );
  });
  it("prints warnings and errors on standard error outside check and still runs", () => {
    const files = { "/ledger/main.hueke": `${MAIN}\n2026-10-30 * "x"\n    Assets:Cash 1 NTD\n` };
    const r = hueke("balance Assets --file main.hueke", files);
    expect(r).toMatchObject({ status: 0, stdout: "1 NTD  Assets (total)\n1 NTD    Assets:Cash\n" });
    expect(r.stderr).toMatch(/^main\.hueke:20:1: error txn\.unbalanced: .*\n$/);
  });
  it("prints a failed Balance on standard error and the result on standard output", () => {
    const files = { "/ledger/main.hueke": MAIN.replace("9100 NTD\n", "9000 NTD\n") };
    const r = hueke("balance --file main.hueke --at 2026-10-31", files);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(hueke("balance --file main.hueke --at 2026-10-31").stdout);
    expect(r.stderr).toMatch(/^main\.hueke:18:1: error balance\.mismatch: .*\n$/);
  });
  it("prints warnings but not info diagnostics on standard error", () => {
    const files = { "/ledger/main.hueke": MAIN.replace("option timezone Asia/Taipei\n", "") };
    const r = hueke("query Bank:Checking --file main.hueke --period 2026-10-01", files);
    expect(r.stderr).toMatch(/^main\.hueke: warning option\.missing-timezone: /);
    expect(r.stderr).toBe(hueke("check --file main.hueke", files).stdout);
    const info = {
      "/ledger/main.hueke": `${MAIN}\n2026-10-30 * "x"\n    Spending:Food 1 NTD\n    Bank:Checking\n`,
    };
    expect(hueke("check --file main.hueke", info).stdout).toContain("info name.unknown-root");
    expect(hueke("balance --file main.hueke", info).stderr).toBe("");
  });
  it("--strict turns on strict mode for every kind", () => {
    const r = hueke("check --file main.hueke --strict --format csv");
    expect(r.status).toBe(1);
    expect(r.stdout.split("\n")[0]).toBe("source,line,column,severity,code,message");
    expect(r.stdout).toContain("strict.undeclared");
  });
});

describe("check", () => {
  it("prints nothing for a clean ledger", () => {
    expect(hueke("check --file main.hueke")).toEqual({ status: 0, stdout: "", stderr: "" });
  });
  it("prints one line per diagnostic with its position", () => {
    const files = { "/ledger/main.hueke": `${MAIN}\n2026-10-25 balance Bank:Checking 1 NTD\n` };
    const r = hueke("check --file main.hueke", files);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(
      /^main\.hueke:20:1: error balance\.mismatch: Bank:Checking: asserted 1 NTD/,
    );
  });
});

describe("balance", () => {
  it("prints the account tree at a point", () => {
    expect(hueke("balance --file main.hueke --at 2026-10-31").stdout).toBe(
      "  9100 NTD  Bank (total)\n" +
        "  9100 NTD    Bank:Checking\n" +
        "-12300 NTD  Equity (total)\n" +
        "-12300 NTD    Equity:Opening\n" +
        "  3200 NTD  Expenses (total)\n" +
        "  2700 NTD    Expenses:Groceries\n" +
        "   500 NTD    Expenses:Other\n",
    );
  });
  it("follows the effective axis by default", () => {
    expect(hueke("balance Bank --file main.hueke --at 2026-10-12").stdout).toBe(
      "11800 NTD  Bank (total)\n11800 NTD    Bank:Checking\n",
    );
    expect(hueke("balance Bank --file main.hueke --at 2026-10-12 --axis accounting").stdout).toBe(
      "9100 NTD  Bank (total)\n9100 NTD    Bank:Checking\n",
    );
  });
  it("--depth hides deeper rows", () => {
    expect(hueke("balance Expenses --file main.hueke --period 2026-10 --depth 1").stdout).toBe(
      "3200 NTD  Expenses (total)\n",
    );
    expect(hueke("balance --file main.hueke --depth 0").stderr).toBe(
      'hueke: --depth must be a whole number from 1, not "0"\n',
    );
  });
  it("csv", () => {
    expect(hueke("balance Expenses:Other --file main.hueke --format csv").stdout).toBe(
      "account,subtotal,depth,value,commodity\nExpenses,true,1,500,NTD\nExpenses:Other,false,2,500,NTD\n",
    );
  });
  it("has no JSON output", () => {
    expect(hueke("balance --file main.hueke --format json")).toMatchObject({
      status: 2,
      stderr: 'hueke: unknown format "json"\n',
    });
  });
  it("pads amounts to the commodity's precision", () => {
    const files = {
      "/ledger/main.hueke":
        'commodity USD\n    precision 2\n\n2026-10-01 * "x"\n    Assets:Cash  12.5 USD\n    Equity:Opening\n',
    };
    expect(hueke("balance Assets --file main.hueke", files).stdout).toBe(
      "12.50 USD  Assets (total)\n12.50 USD    Assets:Cash\n",
    );
  });
});

describe("query", () => {
  it("lists matched postings with the time on the axis", () => {
    expect(
      hueke("query Bank --file main.hueke --axis effective --period 2026-10-10..2026-10-20").stdout,
    ).toBe("2026-10-14  *  Bank:Checking  -2700 NTD  Supermarket\n");
    expect(
      hueke("query Bank --file main.hueke --axis accounting --period 2026-10-10..2026-10-20")
        .stdout,
    ).toBe("2026-10-12  *  Bank:Checking  -2700 NTD  Supermarket\n");
  });
  it("follows the effective axis by default", () => {
    expect(hueke("query Bank --file main.hueke --period 2026-10-10..2026-10-20").stdout).toBe(
      "2026-10-14  *  Bank:Checking  -2700 NTD  Supermarket\n",
    );
    expect(hueke("query Bank --file main.hueke --period 2026-10-13").stdout).toBe("");
  });
  it("filters by status and occurrence", () => {
    expect(hueke("query --file main.hueke --status none --format csv").stdout).toBe(
      "date,transaction,posting,occurrence,status,account,value,commodity,description\n" +
        "2026-10-03,~2,~2.1,occurred,none,Expenses:Other,500,NTD,Bookstore\n" +
        "2026-10-03,~2,~2.2,occurred,none,Bank:Checking,-500,NTD,Bookstore\n",
    );
    const files = {
      "/ledger/main.hueke": `${MAIN}\n2026-11-20 ! "Book to buy"\n    Expenses:Other 100 NTD\n    Bank:Checking\n`,
    };
    expect(hueke("query Expenses --file main.hueke --planned", files).stdout).toBe(
      "2026-11-20  !  Expenses:Other  100 NTD  Book to buy\n",
    );
  });
  it("rejects unknown values", () => {
    expect(hueke("query --file main.hueke --axis posted").stderr).toBe(
      'hueke: unknown axis "posted"\n',
    );
    expect(hueke("query --file main.hueke --status pending").stderr).toBe(
      'hueke: unknown status "pending"\n',
    );
  });
});

describe("register", () => {
  it("prints the account tree, each row followed by its postings", () => {
    expect(
      hueke("register Bank --file main.hueke --axis effective --period 2026-10-10..2026-10-20"),
    ).toEqual({
      status: 0,
      stdout:
        "-2700 NTD  Bank (total)\n" +
        "-2700 NTD    Bank:Checking\n" +
        "2026-10-14  *  Bank:Checking  -2700 NTD  Supermarket\n",
      stderr: "",
    });
  });
  it("lists every posting of a row in query order", () => {
    expect(hueke("register Expenses --file main.hueke --period 2026-10").stdout).toBe(
      "3200 NTD  Expenses (total)\n" +
        "2700 NTD    Expenses:Groceries\n" +
        "2026-10-12  *  Expenses:Groceries  2700 NTD  Supermarket\n" +
        " 500 NTD    Expenses:Other\n" +
        "2026-10-03    Expenses:Other  500 NTD  Bookstore\n",
    );
  });
  it("has only table output", () => {
    expect(hueke("register --file main.hueke --format csv")).toMatchObject({
      status: 2,
      stderr: "hueke: register has no csv output\n",
    });
  });
  it("prints only the usage message when it stops with a usage error", () => {
    const files = { "/ledger/main.hueke": MAIN.replace("9100 NTD\n", "9000 NTD\n") };
    expect(hueke("register --file main.hueke --format csv", files)).toEqual({
      status: 2,
      stdout: "",
      stderr: "hueke: register has no csv output\n",
    });
    expect(hueke("reconcile --file main.hueke --at 2026-10-25", files)).toEqual({
      status: 2,
      stdout: "",
      stderr: "hueke: reconcile takes exactly one account\n",
    });
  });
  it("prints the ledger's problems after its result", () => {
    const files = { "/ledger/main.hueke": MAIN.replace("9100 NTD\n", "9000 NTD\n") };
    const order: string[] = [];
    run(["balance", "Bank", "--file", "main.hueke"], {
      cwd: "/ledger",
      readFile: (path) => files[path as keyof typeof files],
      stdout: () => order.push("stdout"),
      stderr: () => order.push("stderr"),
    });
    expect(order.at(-1)).toBe("stderr");
    expect(order.indexOf("stderr")).toBeGreaterThan(order.lastIndexOf("stdout"));
  });
});

describe("reconcile", () => {
  it("prints the view", () => {
    expect(hueke("reconcile Bank:Checking --file main.hueke --at 2026-10-25").stdout).toBe(
      "Bank:Checking  NTD  start .. 2026-10-25\n" +
        "opening            0 NTD\n" +
        "2026-10-01  *  12300 NTD  Opening\n" +
        "2026-10-03      -500 NTD  Bookstore\n" +
        "2026-10-14  *  -2700 NTD  Supermarket\n" +
        "closing         9100 NTD\n" +
        "asserted        9100 NTD\n" +
        "difference         0 NTD\n" +
        "\n" +
        "uncleared\n" +
        "2026-10-03    Bank:Checking  -500 NTD  Bookstore\n",
    );
  });
  it("shows the balance after each posting with --balance", () => {
    expect(
      hueke("reconcile Bank:Checking --file main.hueke --at 2026-10-25 --balance").stdout,
    ).toBe(
      "Bank:Checking  NTD  start .. 2026-10-25\n" +
        "opening                       0 NTD\n" +
        "2026-10-01  *  12300 NTD  12300 NTD  Opening\n" +
        "2026-10-03      -500 NTD  11800 NTD  Bookstore\n" +
        "2026-10-14  *  -2700 NTD   9100 NTD  Supermarket\n" +
        "closing                    9100 NTD\n" +
        "asserted        9100 NTD\n" +
        "difference         0 NTD\n" +
        "\n" +
        "uncleared\n" +
        "2026-10-03    Bank:Checking  -500 NTD  Bookstore\n",
    );
  });
  it("adds decimals exactly in the running balance", () => {
    const files = {
      "/ledger/main.hueke": `${MAIN}commodity USD\n    precision 2\n\n2026-10-20 * "Gift"\n    Bank:Checking  0.10 USD\n    Equity:Opening\n\n2026-10-21 * "Gift"\n    Bank:Checking  0.20 USD\n    Equity:Opening\n\n2026-10-22 "Fee"\n    Bank:Checking  -0.35 USD\n    Equity:Opening\n`,
    };
    const out = hueke(
      "reconcile Bank:Checking --file main.hueke --at 2026-10-31 --balance",
      files,
    ).stdout;
    expect(out).toContain(" 0.10 USD   0.10 USD  Gift\n");
    expect(out).toContain(" 0.20 USD   0.30 USD  Gift\n");
    expect(out).toContain("-0.35 USD  -0.05 USD  Fee\n");
  });
  it("adds fractions exactly in the running balance", () => {
    const third = `    Bank:Checking  (1000/3) NTD\n    Equity:Opening\n`;
    const files = {
      "/ledger/main.hueke": `${MAIN}\n2026-10-26 "A"\n${third}\n2026-10-27 "B"\n${third}\n2026-10-28 "C"\n${third}`,
    };
    const out = hueke(
      "reconcile Bank:Checking --file main.hueke --at 2026-10-31 --balance",
      files,
    ).stdout;
    expect(out).toContain("28300/3 NTD  A\n");
    expect(out).toContain("29300/3 NTD  B\n");
    expect(out).toContain("10100 NTD  C\n");
  });
  it("gives the difference as recorded minus asserted", () => {
    const files = { "/ledger/main.hueke": MAIN.replace("9100 NTD\n", "9000 NTD\n") };
    const r = hueke("reconcile Bank:Checking --file main.hueke --at 2026-10-25", files);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "closing         9100 NTD\nasserted        9000 NTD\ndifference       100 NTD\n",
    );
    expect(r.stderr).toMatch(/^main\.hueke:18:1: error balance\.mismatch: /);
  });
  it("prints one view per commodity", () => {
    const files = {
      "/ledger/main.hueke": `${MAIN}commodity USD\n    precision 2\n\n2026-10-20 * "Gift"\n    Bank:Checking  20 USD\n    Equity:Opening\n`,
    };
    const out = hueke("reconcile Bank:Checking --file main.hueke --at 2026-10-31", files).stdout;
    expect(out.split("\n").filter((l) => l.startsWith("Bank:Checking  "))).toEqual([
      "Bank:Checking  NTD  2026-10-25 .. 2026-10-31",
      "Bank:Checking  USD  start .. 2026-10-31",
    ]);
    expect(out).toContain("opening    9100 NTD\nclosing    9100 NTD\n");
    expect(out).toContain(
      "opening         0.00 USD\n2026-10-20  *  20.00 USD  Gift\nclosing        20.00 USD\n",
    );
  });
  it("needs one account and --at", () => {
    expect(hueke("reconcile --file main.hueke --at 2026-10-25").stderr).toBe(
      "hueke: reconcile takes exactly one account\n",
    );
    expect(hueke("reconcile Bank:Checking --file main.hueke").stderr).toBe(
      "hueke: reconcile needs --at\n",
    );
    expect(hueke("reconcile Bank --file main.hueke --at 2026-10-25 --format csv").stderr).toBe(
      "hueke: reconcile has no csv output\n",
    );
  });
});

describe("usage errors", () => {
  it("unknown commands, options and formats", () => {
    expect(hueke("obligations --file main.hueke")).toMatchObject({
      status: 2,
      stderr: 'hueke: unknown command "obligations"\n',
    });
    expect(hueke("balance --file main.hueke --format xml").stderr).toBe(
      'hueke: unknown format "xml"\n',
    );
    expect(hueke("query --file main.hueke --depth 2").stderr).toBe(
      "hueke: --depth does not apply to query\n",
    );
    expect(hueke("balance --file main.hueke --balance")).toMatchObject({
      status: 2,
      stderr: "hueke: --balance does not apply to balance\n",
    });
    expect(hueke("balance --file main.hueke --who NAT").status).toBe(2);
  });
  it("an option written twice", () => {
    expect(hueke("balance --file main.hueke --at 2026-10-31 --at 2026-11-30")).toMatchObject({
      status: 2,
      stderr: "hueke: --at is written twice\n",
    });
  });
  it("a time the API rejects", () => {
    const r = hueke("balance --file main.hueke --period 2026-13");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^hueke: parse\.invalid-time: /);
  });
  it("a query time with a time of day", () => {
    for (const args of [
      "balance --file main.hueke --at 2026-10-31T12:00",
      "balance --file main.hueke --period 2026-10-31T12:00..2026-11-01",
      "query --file main.hueke --overlaps 2026-10-31T12:00",
      "register --file main.hueke --covers 2026-10-31T12:00",
      "reconcile Bank:Checking --file main.hueke --at 2026-10-25T12:00",
    ]) {
      const r = hueke(args);
      expect(r).toMatchObject({ status: 2, stdout: "" });
      expect(r.stderr).toMatch(/^hueke: query\.time-of-day: /);
    }
  });
  it("prints usage without a command", () => {
    const r = hueke("");
    expect(r).toMatchObject({ status: 2, stdout: "" });
    expect(r.stderr).toMatch(/^Usage: hueke <command>/);
    expect(hueke("--help").stdout).toMatch(/^Usage: hueke <command>/);
    expect(hueke("balance --help").stdout).toMatch(/^Usage: hueke balance/);
  });
  it.each(["--help", "-h", "check --help", "check -h"])("%s prints usage and exits 0", (args) => {
    const r = hueke(args);
    expect(r).toMatchObject({ status: 0, stderr: "" });
    expect(r.stdout).toMatch(/^Usage: hueke /);
  });
  it("check --help prints the usage of check", () => {
    expect(hueke("check --help").stdout).toMatch(/^Usage: hueke check/);
  });
});
