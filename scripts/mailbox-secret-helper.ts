import { pathToFileURL } from "node:url";
import { getDecryptedAppPassword } from "../src/lib/mailboxes/credentials";

export interface SecretHelperDependencies {
  getPassword(mailboxId: string): Promise<string>;
  stdout(value: string): void;
  stderr(value: string): void;
}

const defaults: SecretHelperDependencies = {
  getPassword: getDecryptedAppPassword,
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export async function runSecretHelper(
  args: string[],
  dependencies: SecretHelperDependencies = defaults,
): Promise<number> {
  if (args.length !== 1 || !/^[a-z0-9_-]+$/i.test(args[0])) {
    dependencies.stderr("mailbox secret unavailable\n");
    return 1;
  }
  try {
    dependencies.stdout(`${await dependencies.getPassword(args[0])}\n`);
    return 0;
  } catch {
    dependencies.stderr("mailbox secret unavailable\n");
    return 1;
  }
}

async function runCli(): Promise<void> {
  process.exitCode = await runSecretHelper(process.argv.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
