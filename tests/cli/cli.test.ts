// docs/cli.md
import { describe, expect, it } from "vitest";
import { run } from "../../srcs/cli/run.js";

const MAIN = `option timezone Asia/Taipei
account-root Bank asset
commodity NTD
    precision 0

2026-10-01 "Opening"
    Bank:Checking     12300 NTD
    Equity:Opening   -12300 NTD

2026-10-03 "Bookstore"
    Expenses:Other     500 NTD
    Bank:Checking     -500 NTD

2026-10-12 "Supermarket"
    Expenses:Groceries     2700 NTD
    Bank:Checking         -2700 NTD
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
    const files = { "/books/2026/main.hueke": '2026-10-01 "x"\n    Assets:Cash 1 NTD\n' };
    const r = hueke("check --root /books --file 2026/main.hueke --format csv", files, "/books");
    expect(hueke("check --root /books --file /books/2026/main.hueke --format csv", files)).toEqual(
      r,
    );
    expect(r.status).toBe(1);
    expect(r.stdout.split("\n").map((line) => line.split(",").slice(0, 5).join(","))).toEqual([
      "source,line,column,severity,code",
      "2026/main.hueke,,,warning,option.missing-timezone",
      "2026/main.hueke,1,1,error,txn.unbalanced",
      "",
    ]);
  });
  it("reads a file under a relative --root", () => {
    const files = { "/work/ledger/main.hueke": MAIN };
    expect(
      hueke("balance --root ledger --file ledger/main.hueke --at 2026-10-31", files, "/work"),
    ).toEqual(hueke("balance --file main.hueke --at 2026-10-31"));
    const broken = { "/work/ledger/main.hueke": `${MAIN}\n2026-10-30 "x"\n    Bank:Other 1 NTD\n` };
    expect(hueke("check --root ledger --file ledger/main.hueke", broken, "/work").stdout).toMatch(
      /^main\.hueke:18:1: error txn\.unbalanced: /,
    );
  });
  it("refuses a file outside --root and a file it cannot read", () => {
    const files = { "/work/ledger/main.hueke": MAIN, "/work/main.hueke": MAIN };
    const outside = hueke("balance --root ledger --file main.hueke", files, "/work");
    expect(outside).toMatchObject({ status: 2, stdout: "" });
    expect(outside.stderr).toMatch(/^hueke: main\.hueke is outside --root/);
    expect(hueke("check --file ../main.hueke").stderr).toMatch(
      /^hueke: \.\.\/main\.hueke is outside --root/,
    );
    expect(hueke("check --file other.hueke")).toMatchObject({
      status: 2,
      stderr: "hueke: cannot read /ledger/other.hueke\n",
    });
  });
  it("prints warnings and errors on standard error outside check and still runs", () => {
    const files = { "/ledger/main.hueke": `${MAIN}\n2026-10-30 "x"\n    Bank:Other 1 NTD\n` };
    const r = hueke("balance Bank:Other --file main.hueke", files);
    expect(r).toMatchObject({ status: 0, stdout: "1 NTD  Bank (total)\n1 NTD    Bank:Other\n" });
    expect(r.stderr).toMatch(/^main\.hueke:18:1: error txn\.unbalanced: .*\n$/);
    expect(r.stderr).toBe(hueke("check --file main.hueke", files).stdout);
  });
  it("prints warnings on standard error", () => {
    const files = { "/ledger/main.hueke": MAIN.replace("option timezone Asia/Taipei\n", "") };
    const r = hueke("query Bank:Checking --file main.hueke --period 2026-10-01", files);
    expect(r.stderr).toMatch(/^main\.hueke: warning option\.missing-timezone: /);
    expect(r.stderr).toBe(hueke("check --file main.hueke", files).stdout);
  });
  it("prints the ledger's problems after its result", () => {
    const files = { "/ledger/main.hueke": `${MAIN}\n2026-10-30 "x"\n    Bank:Other 1 NTD\n` };
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
  it("prints only the usage message when it stops with a usage error", () => {
    const files = { "/ledger/main.hueke": `${MAIN}\n2026-10-30 "x"\n    Bank:Other 1 NTD\n` };
    expect(hueke("register --file main.hueke --format csv", files)).toEqual({
      status: 2,
      stdout: "",
      stderr: "hueke: register has no csv output\n",
    });
  });
});

describe("check", () => {
  it("prints nothing for a clean ledger", () => {
    expect(hueke("check --file main.hueke")).toEqual({ status: 0, stdout: "", stderr: "" });
  });
  it("prints one line per diagnostic with its position", () => {
    const files = { "/ledger/main.hueke": `${MAIN}\n2026-10-30 "x"\n    Bank:Other 1 NTD\n` };
    const r = hueke("check --file main.hueke", files);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^main\.hueke:18:1: error txn\.unbalanced: /);
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
    expect(hueke("balance Bank --file main.hueke --at 2026-10-05").stdout).toBe(
      "11800 NTD  Bank (total)\n11800 NTD    Bank:Checking\n",
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
  it("pads amounts to the commodity's precision", () => {
    const files = {
      "/ledger/main.hueke":
        'commodity USD\n    precision 2\n\n2026-10-01 "x"\n    Assets:Cash  12.5 USD\n    Equity:Opening\n',
    };
    expect(hueke("balance Assets --file main.hueke", files).stdout).toBe(
      "12.50 USD  Assets (total)\n12.50 USD    Assets:Cash\n",
    );
  });
});

describe("query", () => {
  it("lists matched postings with the transaction's time", () => {
    expect(hueke("query Bank --file main.hueke --period 2026-10-02..2026-10-20").stdout).toBe(
      "2026-10-03  Bank:Checking   -500 NTD  Bookstore\n" +
        "2026-10-12  Bank:Checking  -2700 NTD  Supermarket\n",
    );
  });
  it("csv", () => {
    expect(hueke("query Expenses:Other --file main.hueke --format csv").stdout).toBe(
      "date,transaction,posting,account,value,commodity,description\n" +
        "2026-10-03,~2,~2.1,Expenses:Other,500,NTD,Bookstore\n",
    );
  });
});

describe("register", () => {
  it("prints the account tree, each row followed by its postings", () => {
    expect(hueke("register Bank --file main.hueke --period 2026-10-02..2026-10-20")).toEqual({
      status: 0,
      stdout:
        "-3200 NTD  Bank (total)\n" +
        "-3200 NTD    Bank:Checking\n" +
        "2026-10-03  Bank:Checking   -500 NTD  Bookstore\n" +
        "2026-10-12  Bank:Checking  -2700 NTD  Supermarket\n",
      stderr: "",
    });
  });
  it("has only table output", () => {
    expect(hueke("register --file main.hueke --format csv")).toMatchObject({
      status: 2,
      stderr: "hueke: register has no csv output\n",
    });
  });
});

describe("usage errors", () => {
  it("unknown commands, options and formats", () => {
    expect(hueke("reconcile Bank:Checking --file main.hueke --at 2026-10-31")).toMatchObject({
      status: 2,
      stderr: 'hueke: unknown command "reconcile"\n',
    });
    expect(hueke("balance --file main.hueke --format xml").stderr).toBe(
      'hueke: unknown format "xml"\n',
    );
    expect(hueke("query --file main.hueke --depth 2").stderr).toBe(
      "hueke: --depth does not apply to query\n",
    );
    expect(hueke("check extra --file main.hueke").stderr).toBe("hueke: check takes no arguments\n");
    expect(hueke("balance --file main.hueke --axis accounting").status).toBe(2);
  });
  it("has no JSON output", () => {
    expect(hueke("balance --file main.hueke --format json")).toMatchObject({
      status: 2,
      stderr: 'hueke: unknown format "json"\n',
    });
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
