export interface FulfillmentBoxBarcodeParts {
  accountShortId: number
  batchShortId: number
  supplyNumber: number
  boxNumber: number
}

export const buildFulfillmentBoxBarcode = ({
  accountShortId,
  batchShortId,
  supplyNumber,
  boxNumber,
}: FulfillmentBoxBarcodeParts) =>
  `EL_C${accountShortId}_P${batchShortId}_S${supplyNumber}_B${boxNumber}`
