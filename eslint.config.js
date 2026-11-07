import js from "@eslint/js";
import tseslint from "typescript-eslint";

const NO_IO = {
  group: ["node:*", "fs", "path", "os", "child_process"],
  message: "Core does no I/O.",
};
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
      "no-restricted-imports": ["error", { patterns: [NO_IO] }],
      "no-restricted-globals": ["error", "process", "Buffer"],
    },
  },
  // Layers of the data core (docs/architecture.md, "Source layout"): a lower layer never imports
  // a higher one.
  ...Object.entries(DATA_LAYERS).map(([layer, higher]) => ({
    files: [`srcs/data/${layer}/**/*.ts`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            NO_IO,
            {
              group: ["../../*", ...higher.map((h) => `../${h}/*`)],
              message: `srcs/data/${layer}/ imports only lower layers of the data core.`,
            },
          ],
        },
      ],
    },
  })),
);
