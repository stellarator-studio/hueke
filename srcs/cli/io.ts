// What the CLI needs from its platform. main.ts gives it the real file system and streams; tests
// give it files in memory.

export interface CliIO {
  readonly cwd: string;
  readFile(path: string): string; // throws when the file cannot be read
  stdout(text: string): void;
  stderr(text: string): void;
}

/** A mistake on the command line; reported with exit status 2. */
export class UsageError extends Error {}
