import 'dotenv/config';
import { cleanupSavedLibrary } from '../shared/server/savedLibraryCleanup.ts';

interface CliOptions {
  apply: boolean;
  userId?: string;
  sampleLimit: number;
}

function readOptionValue(args: string[], index: number, name: string) {
  const current = args[index];
  const prefix = `${name}=`;
  if (current.startsWith(prefix)) {
    return { value: current.slice(prefix.length), consumed: 1 };
  }

  const next = args[index + 1];
  if (!next || next.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }

  return { value: next, consumed: 2 };
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    sampleLimit: 10,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      options.apply = false;
      index += 1;
      continue;
    }

    if (arg === '--apply') {
      options.apply = true;
      index += 1;
      continue;
    }

    if (arg === '--user-id' || arg.startsWith('--user-id=')) {
      const { value, consumed } = readOptionValue(argv, index, '--user-id');
      options.userId = value.trim() || undefined;
      index += consumed;
      continue;
    }

    if (arg === '--sample-limit' || arg.startsWith('--sample-limit=')) {
      const { value, consumed } = readOptionValue(argv, index, '--sample-limit');
      const sampleLimit = Number.parseInt(value, 10);
      if (!Number.isInteger(sampleLimit) || sampleLimit < 0) {
        throw new Error('--sample-limit must be a non-negative integer');
      }
      options.sampleLimit = sampleLimit;
      index += consumed;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await cleanupSavedLibrary({
    apply: options.apply,
    userId: options.userId,
    sampleLimit: options.sampleLimit,
  });

  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        targetUsers: result.usersInspected,
        affectedUsers: result.affectedUsers,
        savedWordsInspected: result.savedWordsInspected,
        createdReviewStates: result.createdReviewStates,
        removedSavedWords: result.removedSavedWords,
        deletedCustomGroups: result.deletedCustomGroups,
        missingReviewStateSavedWords: result.missingReviewStateSavedWords,
        nonNewSavedWords: result.nonNewSavedWords,
        userId: options.userId ?? null,
        samples: result.samples,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
