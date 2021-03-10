import { fromMasterSeed } from "hdkey/lib/hdkey"
import { generateMnemonic, mnemonicToSeed } from "bip39"

import { hashToPath, nameHash } from "./derive"

/**
 * HD derive path for account handle
 */
export const ACCOUNT_DERIVE_PATH = "m/43'/60'/1775'/0'/" + hashToPath(nameHash("opacity.io"))

export const createMnemonic = async (): Promise<string[]> => {
	return generateMnemonic().split(" ")
}

export const mnemonicToHandle = async (mnemonic: string[]): Promise<Uint8Array> => {
	const seed = await mnemonicToSeed(mnemonic.join(" "))
	const hd = fromMasterSeed(seed).derive(ACCOUNT_DERIVE_PATH)

	return new Uint8Array(Array.from(hd.privateKey).concat(Array.from(hd.chainCode)))
}
