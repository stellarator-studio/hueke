import js from "@eslint/js";
import tseslint from "typescript-eslint";

const NO_IO = {
  group: ["node:*", "fs", "path", "os", "child_process"],
  message: "Core does no I/O.",
};
/** Temporal is only where a local time meets a time zone (CLAUDE.md, "Code conventions"). */
const NO_TEMPORAL = {
  group: ["temporal-polyfill"],
  message: "Only srcs/data/time/time.ts uses Temporal; work with dates by day numbers.",
};
const TIME_ZONES = "srcs/data/time/time.ts";
/** Each layer of the data core, with the layers it must not import. */
const DATA_LAYERS = {
  values: ["time", "source", "raw", "model"],
  time: ["values", "source", "raw", "model"],
  source: ["raw", "model"],
  raw: ["model"],
  model: [],
};

export default tseslint.config(
  { ignores: [".work/", "dist/", "srcs/io/parser/generated/"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true } },
  },
  { files: ["*.js"], extends: [tseslint.configs.disableTypeChecked] },
  {
    // Core does no I/O: only the CLI may use Node APIs (docs/architecture.md, "Runtime constraints").
    files: ["srcs/**/*.ts"],
    ignores: ["srcs/cli/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_IO, NO_TEMPORAL] }],
      "no-restricted-globals": ["error", "process", "Buffer"],
    },
  },
  // Layers of the data core (docs/architecture.md, "Source layout"): a lower layer never imports
  // a higher one.
  ...Object.entries(DATA_LAYERS).flatMap(([layer, higher]) => {
    const layers = {
      group: ["../../*", ...higher.map((h) => `../${h}/*`)],
      message: `srcs/data/${layer}/ imports only lower layers of the data core.`,
    };
    const files = [`srcs/data/${layer}/**/*.ts`];
    return [
      {
        files,
        ignores: [TIME_ZONES],
        rules: {
          "no-restricted-imports": ["error", { patterns: [NO_IO, NO_TEMPORAL, layers] }],
        },
      },
      ...(layer === "time"
        ? [
            {
              files: [TIME_ZONES],
              rules: { "no-restricted-imports": ["error", { patterns: [NO_IO, layers] }] },
            },
          ]
        : []),
    ];
  }),
);
