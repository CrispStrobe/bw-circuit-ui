/** Reviewed logical-device to exact purchasable-package bindings. */

const DEFINITIONS = Object.freeze([
  { id: 'lt1001-cn8', logicalKind: 'lt1001', physicalKind: 'lt1001', orderCode: 'LT1001CN8', package: 'PDIP-8' },
  { id: 'op07-cpz', logicalKind: 'op07', physicalKind: 'op07', orderCode: 'OP07CPZ', package: 'PDIP-8' },
  { id: 'op27-epz', logicalKind: 'op27', physicalKind: 'op27', orderCode: 'OP27EPZ', package: 'PDIP-8' },
  { id: 'lt1007-cn8', logicalKind: 'lt1007_channel', physicalKind: 'lt1007', orderCode: 'LT1007CN8#PBF', package: 'PDIP-8' },
  { id: 'ad711-jnz', logicalKind: 'ad711_channel', physicalKind: 'ad711', orderCode: 'AD711JNZ', package: 'PDIP-8' },
  { id: 'ad8541-arz', logicalKind: 'ad8541_channel', physicalKind: 'ad8541', orderCode: 'AD8541ARZ', package: 'SOIC-8' },
  { id: 'ada4522-1-arz', logicalKind: 'ada4522_1_channel', physicalKind: 'ada4522_1', orderCode: 'ADA4522-1ARZ', package: 'SOIC-8' },
  { id: 'adp151-aujz-3v3', logicalKind: 'adp151', physicalKind: 'adp151', orderCode: 'ADP151AUJZ-3.3-R7', package: 'TSOT-5', vOut: 3.3 },
  { id: 'adp7118-ardz-5v0', logicalKind: 'adp7118', physicalKind: 'adp7118', orderCode: 'ADP7118ARDZ-5.0-R7', package: 'SOIC-8', vOut: 5 },
  { id: 'lt1763-cs8-5', logicalKind: 'lt1763', physicalKind: 'lt1763', orderCode: 'LT1763CS8-5#PBF', package: 'SOIC-8', vOut: 5 },
]);

const publicBinding = binding => ({
  id: binding.id,
  logicalKind: binding.logicalKind,
  physicalKind: binding.physicalKind,
  orderCode: binding.orderCode,
  package: binding.package,
});

function logicalView(part) {
  const recorded = part?.physicalBinding;
  const authority = recorded && DEFINITIONS.find(binding => binding.id === recorded.id);
  if (authority && part.kind === authority.physicalKind
      && part.sourcePackage === authority.package
      && recorded.logicalKind === authority.logicalKind
      && recorded.orderCode === authority.orderCode
      && recorded.package === authority.package
      && recorded.selectedBy === 'user') {
    return { ...part, kind: authority.logicalKind, sourcePackage: 'unspecified' };
  }
  return part;
}

function eligible(binding, part) {
  if (!part || part.sourcePackage !== 'unspecified' || part.kind !== binding.logicalKind) return false;
  if ('vOut' in binding && Number(part.params?.vOut) !== binding.vOut) return false;
  return true;
}

export function physicalPackageBindingsForPart(part) {
  const source = logicalView(part);
  if (!source || source.sourcePackage !== 'unspecified') return [];
  return DEFINITIONS.filter(binding => eligible(binding, source)).map(publicBinding);
}

export function physicalPackageBindingForPart(part, id) {
  return physicalPackageBindingsForPart(part).find(binding => binding.id === id) || null;
}

export const REVIEWED_PHYSICAL_PACKAGE_BINDINGS = DEFINITIONS.map(publicBinding);
