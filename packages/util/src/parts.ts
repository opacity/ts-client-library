import { blockSizeOnFS, blockSize } from "./blocks"

export const blocksPerPart = 80
export const partSize = blocksPerPart * blockSize
export const partSizeOnFS = blocksPerPart * blockSizeOnFS

export const numberOfPartsOnFS = (sizeOnFS: number) => {
	return Math.ceil(sizeOnFS / partSizeOnFS)
}
