// Always consume admission from the exact installed producer, never a copied installer.
const {admitOracle} = await import(new URL('./scripts/install-ngspice-oracle.mjs',
  import.meta.resolve('bw-board/package.json')).href);

export function literalPulseOracle(binary = process.env.NGSPICE_LITERAL_ORACLE) {
  if (!binary) throw new Error('NGSPICE_LITERAL_ORACLE must name the source-admitted47 oracle');
  return {binary, identity: admitOracle(binary)};
}
