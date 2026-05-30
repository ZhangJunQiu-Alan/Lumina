import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { supabaseAdmin } from '../shared/server/supabase.ts';

const execFileAsync = promisify(execFile);
const FIGURE_BUCKET = 'ielts-reading-figures';
const DEFAULT_OUTPUT_DIR = 'output/ielts-reading/figures';
const DEFAULT_RAW_DIR = 'content/ielts-reading/raw';
const RENDER_DPI = 160;

interface CliArgs {
  book?: number;
  test?: number;
  pdf?: string;
  apply: boolean;
  out?: string;
}

interface FigureCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ReadingFigureSource {
  bookNumber: number;
  testNumber: number;
  passageNumber: number;
  figureKey: string;
  title: string;
  caption: string;
  pdfPage: number;
  anchorText: string;
  sortOrder: number;
  crop: FigureCrop;
  fallback?: {
    headers: [string, string];
    rows: [string, string][];
  };
}

const CAMBRIDGE_4_TEST_1_FIGURES: ReadingFigureSource[] = [
  {
    bookNumber: 4,
    testNumber: 1,
    passageNumber: 3,
    figureKey: 'fig-1',
    title: 'Fig. 1',
    caption: 'A blind subject drew a spinning wheel with a curved motion line inside the circle.',
    pdfPage: 28,
    anchorText: 'Wilhelm Busch',
    sortOrder: 1,
    crop: { x: 830, y: 515, width: 210, height: 225 },
  },
  {
    bookNumber: 4,
    testNumber: 1,
    passageNumber: 3,
    figureKey: 'fig-2',
    title: 'Fig. 2',
    caption:
      'Subjects were asked which word in each pair fits best with a circle and which with a square. These percentages show the level of consensus among sighted subjects.',
    pdfPage: 29,
    anchorText: '(See Fig. 2.)',
    sortOrder: 2,
    crop: { x: 585, y: 445, width: 380, height: 740 },
    fallback: {
      headers: ['Words associated with circle/square', 'Agreement among subjects (%)'],
      rows: [
        ['SOFT-HARD', '100'],
        ['MOTHER-FATHER', '94'],
        ['HAPPY-SAD', '94'],
        ['GOOD-EVIL', '89'],
        ['LOVE-HATE', '89'],
        ['ALIVE-DEAD', '87'],
        ['BRIGHT-DARK', '87'],
        ['LIGHT-HEAVY', '85'],
        ['WARM-COLD', '81'],
        ['SUMMER-WINTER', '81'],
        ['WEAK-STRONG', '79'],
        ['FAST-SLOW', '79'],
        ['CAT-DOG', '74'],
        ['SPRING-FALL', '74'],
        ['QUIET-LOUD', '62'],
        ['WALKING-STANDING', '62'],
        ['ODD-EVEN', '57'],
        ['FAR-NEAR', '53'],
        ['PLANT-ANIMAL', '53'],
        ['DEEP-SHALLOW', '51'],
      ],
    },
  },
];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];
    if (item === '--book' && next) {
      args.book = Number.parseInt(next, 10);
      index += 1;
    } else if (item === '--test' && next) {
      args.test = Number.parseInt(next, 10);
      index += 1;
    } else if (item === '--pdf' && next) {
      args.pdf = next;
      index += 1;
    } else if (item === '--out' && next) {
      args.out = next;
      index += 1;
    } else if (item === '--apply') {
      args.apply = true;
    } else if (item === '--dry-run') {
      args.apply = false;
    } else if (item === '--help' || item === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (!args.book || !Number.isFinite(args.book)) {
    throw new Error('请传 --book <number>。当前可导入 Cambridge 4 的阅读原图。');
  }
  if (!args.test || !Number.isFinite(args.test)) {
    throw new Error('请传 --test <number>。');
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  npm run import:ielts-reading-figures -- --book 4 --test 1 --pdf "${DEFAULT_RAW_DIR}/【4】剑桥雅思真题4.pdf" --dry-run
  npm run import:ielts-reading-figures -- --book 4 --test 1 --pdf "${DEFAULT_RAW_DIR}/【4】剑桥雅思真题4.pdf" --apply

Options:
  --book <number>   Cambridge book number
  --test <number>   Test number
  --pdf <path>      Local source PDF. Defaults to the known Cambridge 4 raw PDF.
  --out <dir>       Local generated image directory
  --dry-run         Crop images locally only
  --apply           Crop, upload to Supabase Storage, and upsert DB records`);
}

function getFigureSources(bookNumber: number, testNumber: number) {
  return CAMBRIDGE_4_TEST_1_FIGURES.filter(
    (figure) => figure.bookNumber === bookNumber && figure.testNumber === testNumber,
  );
}

function getPdfPath(args: CliArgs) {
  if (args.pdf) return args.pdf;
  if (args.book === 4) return path.join(DEFAULT_RAW_DIR, '【4】剑桥雅思真题4.pdf');
  throw new Error(`Book ${args.book} 没有默认 PDF 路径，请传 --pdf。`);
}

function pageImagePath(prefix: string, pdfPage: number) {
  return `${prefix}-${String(pdfPage).padStart(3, '0')}.jpg`;
}

async function renderPdfPage(pdfPath: string, pdfPage: number, outputDir: string) {
  const pageDir = path.join(outputDir, 'rendered-pages');
  await mkdir(pageDir, { recursive: true });
  const prefix = path.join(pageDir, `page-${String(pdfPage).padStart(3, '0')}`);
  await execFileAsync(
    'pdftoppm',
    ['-jpeg', '-r', String(RENDER_DPI), '-f', String(pdfPage), '-l', String(pdfPage), pdfPath, prefix],
    {
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  return pageImagePath(prefix, pdfPage);
}

async function cropFigure(renderedPagePath: string, figure: ReadingFigureSource, outputDir: string) {
  const cropDir = path.join(
    outputDir,
    `cambridge-${figure.bookNumber}`,
    `test-${figure.testNumber}`,
    `passage-${figure.passageNumber}`,
  );
  await mkdir(cropDir, { recursive: true });
  const outputPath = path.join(cropDir, `${figure.figureKey}.jpg`);
  await execFileAsync(
    'sips',
    [
      '--cropToHeightWidth',
      String(figure.crop.height),
      String(figure.crop.width),
      '--cropOffset',
      String(figure.crop.y),
      String(figure.crop.x),
      renderedPagePath,
      '--out',
      outputPath,
    ],
    {
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  return outputPath;
}

function storagePathFor(figure: ReadingFigureSource) {
  const cropHash = createHash('sha1')
    .update(
      JSON.stringify({
        pdfPage: figure.pdfPage,
        crop: figure.crop,
        dpi: RENDER_DPI,
      }),
    )
    .digest('hex')
    .slice(0, 10);
  return `cambridge-${figure.bookNumber}/test-${figure.testNumber}/passage-${figure.passageNumber}/${figure.figureKey}-${cropHash}.jpg`;
}

async function ensureFigureBucket() {
  const bucketOptions = {
    public: false,
    allowedMimeTypes: ['image/jpeg'],
  };

  const { data: existingBucket, error: getBucketError } = await supabaseAdmin.storage.getBucket(FIGURE_BUCKET);
  if (existingBucket) {
    const { error } = await supabaseAdmin.storage.updateBucket(FIGURE_BUCKET, bucketOptions);
    if (error) throw new Error(`Figure bucket update failed: ${error.message}`);
    return;
  }
  if (getBucketError && !getBucketError.message.toLowerCase().includes('not found')) {
    throw new Error(`Figure bucket lookup failed: ${getBucketError.message}`);
  }

  const { error } = await supabaseAdmin.storage.createBucket(FIGURE_BUCKET, bucketOptions);
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw new Error(`Figure bucket setup failed: ${error.message}`);
  }
}

async function findPassageId(figure: ReadingFigureSource) {
  const { data: bookRow, error: bookError } = await supabaseAdmin
    .from('ielts_reading_books')
    .select('id')
    .eq('book_number', figure.bookNumber)
    .maybeSingle();
  if (bookError || !bookRow)
    throw new Error(`Book ${figure.bookNumber} lookup failed: ${bookError?.message ?? 'not found'}`);

  const { data: testRow, error: testError } = await supabaseAdmin
    .from('ielts_reading_tests')
    .select('id')
    .eq('book_id', bookRow.id)
    .eq('test_number', figure.testNumber)
    .maybeSingle();
  if (testError || !testRow)
    throw new Error(`Test ${figure.testNumber} lookup failed: ${testError?.message ?? 'not found'}`);

  const { data: passageRow, error: passageError } = await supabaseAdmin
    .from('ielts_reading_passages')
    .select('id')
    .eq('test_id', testRow.id)
    .eq('passage_number', figure.passageNumber)
    .maybeSingle();
  if (passageError || !passageRow)
    throw new Error(`Passage ${figure.passageNumber} lookup failed: ${passageError?.message ?? 'not found'}`);

  return passageRow.id as string;
}

async function applyFigure(figure: ReadingFigureSource, imagePath: string) {
  await ensureFigureBucket();
  const passageId = await findPassageId(figure);
  const storagePath = storagePathFor(figure);
  const buffer = await readFile(imagePath);
  const { error: uploadError } = await supabaseAdmin.storage.from(FIGURE_BUCKET).upload(storagePath, buffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (uploadError) throw new Error(`Figure upload failed [${storagePath}]: ${uploadError.message}`);

  const { error: upsertError } = await supabaseAdmin.from('ielts_reading_passage_figures').upsert(
    {
      passage_id: passageId,
      figure_key: figure.figureKey,
      title: figure.title,
      caption: figure.caption,
      image_url: null,
      storage_path: storagePath,
      pdf_page: figure.pdfPage,
      crop_json: {
        ...figure.crop,
        renderDpi: RENDER_DPI,
      },
      anchor_text: figure.anchorText,
      fallback_json: figure.fallback ?? {},
      sort_order: figure.sortOrder,
    },
    { onConflict: 'passage_id,figure_key' },
  );
  if (upsertError) throw new Error(`Figure DB upsert failed [${figure.figureKey}]: ${upsertError.message}`);

  return { storagePath, passageId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bookNumber = args.book ?? 0;
  const testNumber = args.test ?? 0;
  const figures = getFigureSources(bookNumber, testNumber);
  if (figures.length === 0) {
    throw new Error(`Cambridge ${bookNumber} Test ${testNumber} 没有已配置的阅读 figure 裁切定义。`);
  }

  const pdfPath = getPdfPath(args);
  const outputDir = args.out ?? DEFAULT_OUTPUT_DIR;
  const renderedPageCache = new Map<number, string>();

  console.log(`Reading figures: Cambridge ${bookNumber} Test ${testNumber}`);
  console.log(`PDF: ${pdfPath}`);
  console.log(`Mode: ${args.apply ? 'apply' : 'dry-run'}`);

  for (const figure of figures) {
    let renderedPagePath = renderedPageCache.get(figure.pdfPage);
    if (!renderedPagePath) {
      renderedPagePath = await renderPdfPage(pdfPath, figure.pdfPage, outputDir);
      renderedPageCache.set(figure.pdfPage, renderedPagePath);
    }

    const imagePath = await cropFigure(renderedPagePath, figure, outputDir);
    if (!args.apply) {
      console.log(`Cropped ${figure.title}: ${imagePath}`);
      continue;
    }

    const applied = await applyFigure(figure, imagePath);
    console.log(`Applied ${figure.title}: ${applied.storagePath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
