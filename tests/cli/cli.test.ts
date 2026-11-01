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
      "9,000 NTD  Bank (total)",
    );
  });
  it("leaves out an included file it cannot read", () => {
    const files = { "/ledger/main.hueke": `${MAIN}include missing.hueke\n` };
    const r = hueke("balance Bank --file main.hueke --at 2026-10-31", files);
    expect(r).toMatchObject({
      status: 0,
      stdout: "9,100 NTD  Bank (total)\n9,100 NTD    Bank:Checking\n",
      stderr: "main.hueke:19:1: error module.missing: missing.hueke is not loaded\n",
    });
    expect(hueke("check --file main.hueke", files)).toMatchObject({
      status: 1,
      stdout: "main.hueke:19:1: error module.missing: missing.hueke is not loaded\n",
    });
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
  it("exits 0 when the ledger has warnings but no error", () => {
    const files = { "/ledger/main.hueke": MAIN.replace("option timezone Asia/Taipei\n", "") };
    const r = hueke("check --file main.hueke", files);
    expect(r).toMatchObject({ status: 0, stderr: "" });
    expect(r.stdout).toMatch(/^main\.hueke: warning option\.missing-timezone: /);
  });
  it("takes no arguments", () => {
    expect(hueke("check Bank --file main.hueke")).toMatchObject({ status: 2, stdout: "" });
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
      "  9,100 NTD  Bank (total)\n" +
        "  9,100 NTD    Bank:Checking\n" +
        "-12,300 NTD  Equity (total)\n" +
        "-12,300 NTD    Equity:Opening\n" +
        "  3,200 NTD  Expenses (total)\n" +
        "  2,700 NTD    Expenses:Groceries\n" +
        "    500 NTD    Expenses:Other\n",
    );
  });
  it("follows the effective axis by default", () => {
    expect(hueke("balance Bank --file main.hueke --at 2026-10-12").stdout).toBe(
      "11,800 NTD  Bank (total)\n11,800 NTD    Bank:Checking\n",
    );
    expect(hueke("balance Bank --file main.hueke --at 2026-10-12 --axis accounting").stdout).toBe(
      "9,100 NTD  Bank (total)\n9,100 NTD    Bank:Checking\n",
    );
  });
  it("--depth hides deeper rows", () => {
    expect(hueke("balance Expenses --file main.hueke --period 2026-10 --depth 1").stdout).toBe(
      "3,200 NTD  Expenses (total)\n",
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
  it("writes amounts with the ledger's decimal mark and group mark", () => {
    const files = {
      "/ledger/main.hueke":
        'option decimal-mark ,\noption group-mark .\ncommodity EUR\n    precision 2\n\n2026-10-01 * "x"\n    Assets:Cash  12300,5 EUR\n    Equity:Opening\n',
    };
    expect(hueke("balance Assets --file main.hueke", files).stdout).toBe(
      "12.300,50 EUR  Assets (total)\n12.300,50 EUR    Assets:Cash\n",
    );
  });
  it("does not group digits with group mark none", () => {
    const files = {
      "/ledger/main.hueke": `option group-mark none\n${MAIN}`,
    };
    expect(hueke("balance Bank --file main.hueke --at 2026-10-31", files).stdout).toBe(
      "9100 NTD  Bank (total)\n9100 NTD    Bank:Checking\n",
    );
  });
  it("groups a fraction's numerator and denominator without padding", () => {
    const files = {
      "/ledger/main.hueke":
        'commodity USD\n    precision 2\n\n2026-10-01 * "x"\n    Assets:Cash  (28300/3) USD\n    Equity:Opening\n',
    };
    expect(hueke("balance Assets --file main.hueke", files).stdout).toBe(
      "28,300/3 USD  Assets (total)\n28,300/3 USD    Assets:Cash\n",
    );
  });
  it("writes CSV values without a group mark or padding", () => {
    const files = {
      "/ledger/main.hueke":
        'option decimal-mark ,\noption group-mark .\ncommodity EUR\n    precision 2\n\n2026-10-01 * "x"\n    Assets:Cash  12300,5 EUR\n    Equity:Opening\n',
    };
    expect(hueke("balance Assets --file main.hueke --format csv", files).stdout).toBe(
      "account,subtotal,depth,value,commodity\nAssets,true,1,12300.5,EUR\nAssets:Cash,false,2,12300.5,EUR\n",
    );
    expect(hueke("balance Bank --file main.hueke --at 2026-10-31 --format csv").stdout).toBe(
      "account,subtotal,depth,value,commodity\nBank,true,1,9100,NTD\nBank:Checking,false,2,9100,NTD\n",
    );
  });
});

describe("query", () => {
  it("lists matched postings with the time on the axis", () => {
    expect(
      hueke("query Bank --file main.hueke --axis effective --period 2026-10-10..2026-10-20").stdout,
    ).toBe("2026-10-14  *  Bank:Checking  -2,700 NTD  Supermarket\n");
    expect(
      hueke("query Bank --file main.hueke --axis accounting --period 2026-10-10..2026-10-20")
        .stdout,
    ).toBe("2026-10-12  *  Bank:Checking  -2,700 NTD  Supermarket\n");
  });
  it("follows the effective axis by default", () => {
    expect(hueke("query Bank --file main.hueke --period 2026-10-10..2026-10-20").stdout).toBe(
      "2026-10-14  *  Bank:Checking  -2,700 NTD  Supermarket\n",
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
  it("applies --overlaps, --covers, --involves, --cancelled and --axis txn-effective", () => {
    const files = {
      "/ledger/main.hueke": `${MAIN}
2026-10-05=2026-10-01..2026-10-10 "Course"
    Expenses:Other     300 USD
    Bank:Checking     -300 USD

2026-10-06 # "Cancelled by mistake"
    Expenses:Other     100 NTD
    Bank:Checking     -100 NTD
`,
    };
    const csvDescriptions = (args: string) =>
      hueke(`${args} --file main.hueke --format csv`, files)
        .stdout.split("\n")
        .slice(1, -1)
        .map((line) => line.split(",").at(-1));
    expect(csvDescriptions("query Expenses --axis accounting --overlaps 2026-10-02")).toEqual([
      "Course",
    ]);
    expect(csvDescriptions("query Expenses --axis accounting --covers 2026-10-02")).toEqual([
      "Course",
    ]);
    expect(csvDescriptions("query Expenses --axis accounting --covers 2026-10")).toEqual([]);
    expect(csvDescriptions("query Expenses --involves USD")).toEqual(["Course"]);
    expect(csvDescriptions("query Expenses --cancelled")).toEqual(["Cancelled by mistake"]);
    expect(csvDescriptions("query Bank --axis txn-effective --period 2026-10-12")).toEqual([
      "Supermarket",
    ]);
  });
  it("quotes a CSV field with a comma or a quote", () => {
    const files = {
      "/ledger/main.hueke": `${MAIN}
2026-10-30 "Pens, \\"blue\\""
    Expenses:Other  10 NTD
    Bank:Checking
`,
    };
    expect(
      hueke("query Expenses --file main.hueke --period 2026-10-30 --format csv", files).stdout,
    ).toBe(
      "date,transaction,posting,occurrence,status,account,value,commodity,description\n" +
        '2026-10-30,~4,~4.1,occurred,none,Expenses:Other,10,NTD,"Pens, ""blue"""\n',
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
        "-2,700 NTD  Bank (total)\n" +
        "-2,700 NTD    Bank:Checking\n" +
        "2026-10-14  *  Bank:Checking  -2,700 NTD  Supermarket\n",
      stderr: "",
    });
  });
  it("lists every posting of a row in query order", () => {
    expect(hueke("register Expenses --file main.hueke --period 2026-10").stdout).toBe(
      "3,200 NTD  Expenses (total)\n" +
        "2,700 NTD    Expenses:Groceries\n" +
        "2026-10-12  *  Expenses:Groceries  2,700 NTD  Supermarket\n" +
        "  500 NTD    Expenses:Other\n" +
        "2026-10-03    Expenses:Other  500 NTD  Bookstore\n",
    );
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
        "opening             0 NTD\n" +
        "2026-10-01  *  12,300 NTD  Opening\n" +
        "2026-10-03       -500 NTD  Bookstore\n" +
        "2026-10-14  *  -2,700 NTD  Supermarket\n" +
        "closing         9,100 NTD\n" +
        "asserted        9,100 NTD\n" +
        "difference          0 NTD\n" +
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
        "opening                         0 NTD\n" +
        "2026-10-01  *  12,300 NTD  12,300 NTD  Opening\n" +
        "2026-10-03       -500 NTD  11,800 NTD  Bookstore\n" +
        "2026-10-14  *  -2,700 NTD   9,100 NTD  Supermarket\n" +
        "closing                     9,100 NTD\n" +
        "asserted        9,100 NTD\n" +
        "difference          0 NTD\n" +
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
    expect(out).toContain("28,300/3 NTD  A\n");
    expect(out).toContain("29,300/3 NTD  B\n");
    expect(out).toContain("10,100 NTD  C\n");
  });
  it("prints the difference of a failed Balance", () => {
    const files = { "/ledger/main.hueke": MAIN.replace("9100 NTD\n", "9000 NTD\n") };
    const r = hueke("reconcile Bank:Checking --file main.hueke --at 2026-10-25", files);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "closing         9,100 NTD\nasserted        9,000 NTD\ndifference        100 NTD\n",
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
    expect(out).toContain("\n\nBank:Checking  USD");
    expect(out).toContain("opening    9,100 NTD\nclosing    9,100 NTD\n");
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
    expect(hueke("forecast --file main.hueke")).toMatchObject({
      status: 2,
      stderr: 'hueke: unknown command "forecast"\n',
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
    const r = hueke("balance --file main.hueke --at 2026-10-31T12:00");
    expect(r).toMatchObject({ status: 2, stdout: "" });
    expect(r.stderr).toMatch(/^hueke: query\.time-of-day: /);
  });
  it("an option that does not exist", () => {
    expect(hueke("balance --file main.hueke --colour")).toMatchObject({ status: 2, stdout: "" });
  });
  it("prints usage without a command", () => {
    const r = hueke("");
    expect(r).toMatchObject({ status: 2, stdout: "" });
    expect(r.stderr).toMatch(/^Usage: hueke <command>/);
    expect(hueke("balance --help").stdout).toMatch(/^Usage: hueke balance/);
  });
  it.each(["--help", "-h", "check --help", "check -h"])("%s prints usage and exits 0", (args) => {
    const r = hueke(args);
    expect(r).toMatchObject({ status: 0, stderr: "" });
    expect(r.stdout).toMatch(/^Usage: hueke /);
  });
});

const OBLIGATIONS = `${MAIN}
account Assets:Receivable
    obligation receivable
    pad-account Expenses:WriteOff

entity NAT
    display-name Nat Chen

2026-10-11 * %t_lunch "Lunch"
    Expenses:Food                   600 NTD
    Assets:Receivable:lunch-1011    400 NTD @NAT
    Assets:Cash                   -1000 NTD

2026-10-20 * "NAT pays back part" #t_lunch
    Assets:Cash                     250 NTD
    Assets:Receivable:lunch-1011   -250 NTD
`;
const withObligations = (extra = "") => ({ "/ledger/main.hueke": `${OBLIGATIONS}${extra}` });

describe("obligations", () => {
  const files = withObligations();
  it("prints one row per obligation and commodity, with display names", () => {
    expect(hueke("obligations --file main.hueke --at 2026-10-31 --name", files)).toEqual({
      status: 0,
      stdout: "Assets:Receivable:lunch-1011  NTD  Nat Chen  400  250  150  open  2026-10-20\n",
      stderr: "",
    });
  });
  it("counts the whole ledger without --at, and shows IDs without --name", () => {
    expect(hueke("obligations --file main.hueke", files).stdout).toBe(
      "Assets:Receivable:lunch-1011  NTD  NAT  400  250  150  open  2026-10-20\n",
    );
  });
  it("prints CSV with settled as true or false", () => {
    expect(hueke("obligations --file main.hueke --format csv", files).stdout).toBe(
      "account,commodity,entities,original,repaid,remaining,settled,last_repaid\n" +
        "Assets:Receivable:lunch-1011,NTD,NAT,400,250,150,false,2026-10-20\n",
    );
  });
  it("leaves last_repaid empty when nothing is repaid", () => {
    const r = hueke("obligations --file main.hueke --at 2026-10-15 --format csv", files);
    expect(r.stdout.split("\n")[1]).toBe("Assets:Receivable:lunch-1011,NTD,NAT,400,0,400,false,");
    expect(hueke("obligations --file main.hueke --at 2026-10-15", files).stdout).toBe(
      "Assets:Receivable:lunch-1011  NTD  NAT  400  0  400  open\n",
    );
  });
  it("separates several entities with a comma, quoted in CSV", () => {
    const more = withObligations(`
2026-10-21 * "Dinner"
    Assets:Receivable:dinner-1021   300 NTD @AMY @BOB
    Assets:Cash                    -300 NTD
`);
    const r = hueke(
      "obligations Assets:Receivable:dinner-1021 --file main.hueke --format csv",
      more,
    );
    expect(r.stdout.split("\n")[1]).toBe(
      'Assets:Receivable:dinner-1021,NTD,"AMY,BOB",300,0,300,false,',
    );
  });
  it("hides settled obligations unless --all", () => {
    const paid = withObligations(`
2026-10-25 * "NAT pays the rest"
    Assets:Cash                     150 NTD
    Assets:Receivable:lunch-1011   -150 NTD
`);
    expect(hueke("obligations --file main.hueke", paid).stdout).toBe("");
    expect(hueke("obligations --file main.hueke --all", paid).stdout).toBe(
      "Assets:Receivable:lunch-1011  NTD  NAT  400  400  0  settled  2026-10-25\n",
    );
    expect(hueke("obligations --file main.hueke --all --format csv", paid).stdout).toContain(
      ",true,2026-10-25\n",
    );
  });
  it("takes one entity with --who", () => {
    expect(hueke("obligations --file main.hueke --who NAT", files).stdout).toBe(
      hueke("obligations --file main.hueke", files).stdout,
    );
    expect(hueke("obligations --file main.hueke --who KEN", files).stdout).toBe("");
    const r = hueke("obligations --file main.hueke --who NAT,KEN", files);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^hueke: /);
  });
  it("takes obligation accounts or obligations; another account matches nothing", () => {
    expect(hueke("obligations Assets:Receivable:lunch-1011 --file main.hueke", files).stdout).toBe(
      hueke("obligations --file main.hueke", files).stdout,
    );
    expect(hueke("obligations Bank --file main.hueke", files).stdout).toBe("");
  });
  it("groups the values of a table but not of CSV", () => {
    const large = withObligations(`
2026-10-21 * "Rent advance"
    Assets:Receivable:rent-1021   12000 NTD @NAT
    Assets:Cash                  -12000 NTD

2026-10-22 * "NAT pays back part"
    Assets:Cash                    1500 NTD
    Assets:Receivable:rent-1021   -1500 NTD
`);
    expect(hueke("obligations Assets:Receivable:rent-1021 --file main.hueke", large).stdout).toBe(
      "Assets:Receivable:rent-1021  NTD  NAT  12,000  1,500  10,500  open  2026-10-22\n",
    );
    expect(
      hueke("obligations Assets:Receivable:rent-1021 --file main.hueke --format csv", large).stdout,
    ).toContain(",12000,1500,10500,false,");
  });
});

describe("group", () => {
  const files = withObligations();
  it("lists the anchor's record, then the members, in CSV", () => {
    expect(hueke("group #tag:t_lunch --file main.hueke --format csv", files)).toEqual({
      status: 0,
      stdout:
        "role,date,kind,id,description\n" +
        "anchor,2026-10-11,transaction,t_lunch,Lunch\n" +
        "member,2026-10-20,transaction,~4,NAT pays back part\n",
      stderr: "",
    });
  });
  it("prints the same columns as a table, without a header", () => {
    expect(hueke("group #tag:t_lunch --file main.hueke", files).stdout).toBe(
      "anchor  2026-10-11  transaction  t_lunch  Lunch\n" +
        "member  2026-10-20  transaction  ~4       NAT pays back part\n",
    );
  });
  it("lists nothing for a tag no record defines or carries", () => {
    expect(hueke("group #tag:travel --file main.hueke", files)).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  });
  it("lists a member of a plain tag, without an anchor row", () => {
    const tagged = withObligations(`
2026-10-22 * "Train" #travel
    Expenses:Transport     300 NTD
    Assets:Cash           -300 NTD
`);
    expect(hueke("group #tag:travel --file main.hueke --format csv", tagged).stdout).toBe(
      "role,date,kind,id,description\nmember,2026-10-22,transaction,~5,Train\n",
    );
  });
  it("lists the members of a primary tag", () => {
    const trip = withObligations(`
2026-10-18 %trip "Trip"

2026-10-19 * "Hotel" ^trip
    Expenses:Lodging     8000 NTD
    Bank:Checking       -8000 NTD
`);
    expect(hueke("group ^trip --file main.hueke --format csv", trip).stdout).toBe(
      "role,date,kind,id,description\n" +
        "anchor,2026-10-18,transaction,trip,Trip\n" +
        "member,2026-10-19,transaction,~5,Hotel\n",
    );
  });
  it("shows a posting anchor with the posting's time and its transaction's description", () => {
    const deposit = withObligations(`
2026-10-21 * "Hotel deposit"
    Assets:Deposit     1000 NTD [2026-10-22] %deposit
    Assets:Cash       -1000 NTD

2026-10-23 * "Hotel" #deposit
    Expenses:Lodging     3000 NTD
    Assets:Cash         -3000 NTD
`);
    expect(hueke("group #tag:deposit --file main.hueke --format csv", deposit)).toEqual({
      status: 0,
      stdout:
        "role,date,kind,id,description\n" +
        "anchor,2026-10-22,posting,deposit,Hotel deposit\n" +
        "member,2026-10-23,transaction,~6,Hotel\n",
      stderr: "",
    });
  });
  it("shows an account anchor with its full name, no date and no description", () => {
    const bank = withObligations(`
account Bank:Checking %main-bank

2026-10-23 * "Transfer" #main-bank
    Bank:Checking     100 NTD
    Assets:Cash      -100 NTD
`);
    expect(hueke("group #tag:main-bank --file main.hueke --format csv", bank).stdout).toBe(
      "role,date,kind,id,description\n" +
        "anchor,,account,Bank:Checking,\n" +
        "member,2026-10-23,transaction,~5,Transfer\n",
    );
  });
  it("looks the anchor's record up among planned and cancelled ones when no occurred one has it", () => {
    const planned = withObligations(`
2026-11-01 ! %t_plan "Planned trip"

2026-10-23 * "Booking" #t_plan
    Expenses:Travel     100 NTD
    Assets:Cash        -100 NTD
`);
    expect(hueke("group #tag:t_plan --file main.hueke --format csv", planned).stdout).toBe(
      "role,date,kind,id,description\n" +
        "anchor,2026-11-01,transaction,t_plan,Planned trip\n" +
        "member,2026-10-23,transaction,~5,Booking\n",
    );
  });
  it("takes a refund tag", () => {
    const refund = withObligations(`
2026-10-24 * "Lunch partly refunded" #refund:t_lunch
    Assets:Cash        100 NTD
    Expenses:Food     -100 NTD
`);
    expect(hueke("group #refund:t_lunch --file main.hueke --format csv", refund).stdout).toBe(
      "role,date,kind,id,description\n" +
        "anchor,2026-10-11,transaction,t_lunch,Lunch\n" +
        "member,2026-10-24,transaction,~5,Lunch partly refunded\n",
    );
  });
  it("a tag without a scope is a usage error", () => {
    const r = hueke("group #travel --file main.hueke", files);
    expect(r).toMatchObject({ status: 2, stdout: "" });
    expect(r.stderr).toMatch(/^hueke: /);
  });
  it("takes exactly one tag, and no filters", () => {
    expect(hueke("group --file main.hueke", files).status).toBe(2);
    expect(hueke("group #tag:a #tag:b --file main.hueke", files).status).toBe(2);
    expect(hueke("group #tag:t_lunch --file main.hueke --at 2026-10-31", files).status).toBe(2);
  });
});

describe("ID, entity, tag and primary-tag filters", () => {
  const files = withObligations();
  it("--who matches the whole chain of an obligation", () => {
    expect(hueke("query --file main.hueke --who NAT", files).stdout).toBe(
      "2026-10-11  *  Assets:Receivable:lunch-1011   400 NTD  Lunch\n" +
        "2026-10-20  *  Assets:Receivable:lunch-1011  -250 NTD  NAT pays back part\n",
    );
  });
  it("--id takes anchors and generated IDs", () => {
    expect(hueke("query --file main.hueke --id t_lunch", files).stdout).toBe(
      "2026-10-11  *  Expenses:Food                    600 NTD  Lunch\n" +
        "2026-10-11  *  Assets:Receivable:lunch-1011     400 NTD  Lunch\n" +
        "2026-10-11  *  Assets:Cash                   -1,000 NTD  Lunch\n",
    );
    expect(hueke("query --file main.hueke --id ~2,~3 --format csv", files).stdout).toContain(
      "Bookstore",
    );
  });
  it("--tag takes tags in full, with or without #", () => {
    const expected =
      "2026-10-20  *  Assets:Cash                    250 NTD  NAT pays back part\n" +
      "2026-10-20  *  Assets:Receivable:lunch-1011  -250 NTD  NAT pays back part\n";
    expect(hueke("query --file main.hueke --tag tag:t_lunch", files).stdout).toBe(expected);
    expect(hueke("query --file main.hueke --tag #tag:t_lunch", files).stdout).toBe(expected);
  });
  it("--tag without a scope is a usage error naming query.tag-without-scope", () => {
    const r = hueke("query --file main.hueke --tag travel", files);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^hueke: query\.tag-without-scope/);
  });
  it("--primary filters by primary tag", () => {
    const trip = withObligations(`
2026-10-19 * "Hotel" ^trip
    Expenses:Lodging     8000 NTD
    Bank:Checking       -8000 NTD
`);
    expect(hueke("balance Expenses --file main.hueke --primary trip", trip).stdout).toBe(
      "8,000 NTD  Expenses (total)\n8,000 NTD    Expenses:Lodging\n",
    );
  });
  it("apply to balance, register and query, combined with other filters", () => {
    expect(
      hueke("balance Assets --file main.hueke --who NAT --period 2026-10-20", files).stdout,
    ).toBe(
      "-250 NTD  Assets (total)\n-250 NTD    Assets:Receivable (total)\n-250 NTD      Assets:Receivable:lunch-1011\n",
    );
    expect(hueke("register Assets --file main.hueke --id t_lunch", files).status).toBe(0);
  });
  it("do not apply to reconcile", () => {
    expect(
      hueke("reconcile Bank:Checking --file main.hueke --at 2026-10-25 --who NAT", files).status,
    ).toBe(2);
  });
});

describe("settled obligations and display names", () => {
  const paid = withObligations(`
account Bank:Checking
    display-name Main checking

2026-10-25 * "NAT pays the rest"
    Bank:Checking                   150 NTD
    Assets:Receivable:lunch-1011   -150 NTD
`);
  it("balance hides a settled obligation unless --all", () => {
    expect(hueke("balance Assets:Receivable --file main.hueke", paid).stdout).toBe(
      "0 NTD  Assets (total)\n0 NTD    Assets:Receivable (total)\n",
    );
    expect(hueke("balance Assets:Receivable --file main.hueke --all", paid).stdout).toBe(
      "0 NTD  Assets (total)\n0 NTD    Assets:Receivable (total)\n0 NTD      Assets:Receivable:lunch-1011\n",
    );
  });
  it("register hides it unless --all", () => {
    expect(hueke("register Assets:Receivable --file main.hueke", paid).stdout).not.toContain(
      "Lunch",
    );
    expect(hueke("register Assets:Receivable --file main.hueke --all", paid).stdout).toContain(
      "Lunch",
    );
  });
  it("--name shows an account's display name; arguments still take IDs", () => {
    expect(hueke("balance Bank --file main.hueke --at 2026-10-31 --name", paid).stdout).toBe(
      "9,250 NTD  Bank (total)\n9,250 NTD    Main checking\n",
    );
    expect(
      hueke("query Bank:Checking --file main.hueke --period 2026-10-25 --name", paid).stdout,
    ).toBe("2026-10-25  *  Main checking  150 NTD  NAT pays the rest\n");
  });
  it("--all and --name do not apply to every command", () => {
    expect(hueke("query --file main.hueke --all", paid).status).toBe(2);
    expect(hueke("check --file main.hueke --name", paid).status).toBe(2);
  });
});

describe("examples with an obligation", () => {
  const files = withObligations();
  it("obligations --at 2026-10-31 --name", () => {
    expect(hueke("obligations --file main.hueke --at 2026-10-31 --name", files).stdout).toBe(
      "Assets:Receivable:lunch-1011  NTD  Nat Chen  400  250  150  open  2026-10-20\n",
    );
  });
  it("obligations without --at gives the same row", () => {
    expect(hueke("obligations --file main.hueke --name", files).stdout).toBe(
      hueke("obligations --file main.hueke --at 2026-10-31 --name", files).stdout,
    );
  });
  it("group '#tag:t_lunch' --format csv", () => {
    const lines = hueke("group #tag:t_lunch --file main.hueke --format csv", files).stdout.split(
      "\n",
    );
    expect(lines[0]).toBe("role,date,kind,id,description");
    expect(lines[1]).toBe("anchor,2026-10-11,transaction,t_lunch,Lunch");
    expect(lines[2]).toMatch(/^member,2026-10-20,/);
  });
  it("group '#travel' is a usage error", () => {
    expect(hueke("group #travel --file main.hueke", files).status).toBe(2);
  });
  it("balance Assets:Receivable --at 2026-10-31", () => {
    expect(hueke("balance Assets:Receivable --file main.hueke --at 2026-10-31", files).stdout).toBe(
      "150 NTD  Assets (total)\n" +
        "150 NTD    Assets:Receivable (total)\n" +
        "150 NTD      Assets:Receivable:lunch-1011\n",
    );
  });
  it("balance Assets --who NAT gives the same rows", () => {
    expect(hueke("balance Assets --file main.hueke --who NAT", files).stdout).toBe(
      hueke("balance Assets:Receivable --file main.hueke --at 2026-10-31", files).stdout,
    );
  });
  it("balance and register --id t_lunch", () => {
    expect(hueke("balance --file main.hueke --id t_lunch", files).stdout).toBe(
      "  -600 NTD  Assets (total)\n" +
        "-1,000 NTD    Assets:Cash\n" +
        "   400 NTD    Assets:Receivable (total)\n" +
        "   400 NTD      Assets:Receivable:lunch-1011\n" +
        "   600 NTD  Expenses (total)\n" +
        "   600 NTD    Expenses:Food\n",
    );
    expect(hueke("register Assets --file main.hueke --id t_lunch", files).stdout).toBe(
      "  -600 NTD  Assets (total)\n" +
        "-1,000 NTD    Assets:Cash\n" +
        "2026-10-11  *  Assets:Cash  -1,000 NTD  Lunch\n" +
        "   400 NTD    Assets:Receivable (total)\n" +
        "   400 NTD      Assets:Receivable:lunch-1011\n" +
        "2026-10-11  *  Assets:Receivable:lunch-1011  400 NTD  Lunch\n",
    );
  });
  it("balance --tag tag:t_lunch", () => {
    expect(hueke("balance --file main.hueke --tag tag:t_lunch", files).stdout).toBe(
      "   0 NTD  Assets (total)\n" +
        " 250 NTD    Assets:Cash\n" +
        "-250 NTD    Assets:Receivable (total)\n" +
        "-250 NTD      Assets:Receivable:lunch-1011\n",
    );
  });
  it("balance --tag t_lunch is a usage error", () => {
    const r = hueke("balance --file main.hueke --tag t_lunch", files);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("query.tag-without-scope");
  });
  it("balance --primary t_lunch matches a primary tag only", () => {
    expect(hueke("balance --file main.hueke --primary t_lunch", files)).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
    const primary = {
      "/ledger/main.hueke": OBLIGATIONS.replace(
        '"NAT pays back part" #t_lunch',
        '"NAT pays back part" ^t_lunch',
      ),
    };
    expect(hueke("balance --file main.hueke --primary t_lunch", primary).stdout).toBe(
      hueke("balance --file main.hueke --tag tag:t_lunch", files).stdout,
    );
  });
  it("query --id t_lunch --format csv", () => {
    expect(hueke("query --file main.hueke --id t_lunch --format csv", files).stdout).toBe(
      "date,transaction,posting,occurrence,status,account,value,commodity,description\n" +
        "2026-10-11,t_lunch,t_lunch.1,occurred,cleared,Expenses:Food,600,NTD,Lunch\n" +
        "2026-10-11,t_lunch,t_lunch.2,occurred,cleared,Assets:Receivable:lunch-1011,400,NTD,Lunch\n" +
        "2026-10-11,t_lunch,t_lunch.3,occurred,cleared,Assets:Cash,-1000,NTD,Lunch\n",
    );
  });
  it("obligations --format csv --name", () => {
    expect(hueke("obligations --file main.hueke --format csv --name", files).stdout).toBe(
      "account,commodity,entities,original,repaid,remaining,settled,last_repaid\n" +
        "Assets:Receivable:lunch-1011,NTD,Nat Chen,400,250,150,false,2026-10-20\n",
    );
  });
});
