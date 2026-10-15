const esbuild = require('esbuild');

const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  outdir: 'dist',
  format: 'cjs',
};

esbuild.buildSync({
  ...sharedConfig,
  entryPoints: ['scripts/process-queue.ts'],
});
console.log('Built dist/process-queue.js');

esbuild.buildSync({
  ...sharedConfig,
  entryPoints: ['scripts/fix-embeddings.ts'],
});
console.log('Built dist/fix-embeddings.js');
